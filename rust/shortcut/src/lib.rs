//! Desktop shortcut onboarding: the Rust-native replacement for `src/main/shortcut.ts`
//! (behavior contract: `specs/011-desktop-shortcut-onboarding`).
//!
//! Nothing here creates a shortcut on its own: creation runs only when the user
//! chooses it (FR-005). The Windows side is reached through [`ShortcutPlatform`]
//! and logging through [`ShortcutLog`], so tests use fakes and never touch the
//! real Desktop. This crate has no Tauri dependency.

use std::convert::Infallible;
use std::io;
use std::path::{Path, PathBuf};

/// Name an earlier build could have given the shortcut (`shortcut.ts` `LEGACY_SHORTCUT_NAME`).
pub const LEGACY_SHORTCUT_NAME: &str = "Credits Tracker.lnk";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

/// Diagnostic log sink. The app adapts this to the `logger` crate; tests record entries.
pub trait ShortcutLog {
    fn log(&self, level: LogLevel, message: &str);
}

/// Platform facts and filesystem access the shortcut logic depends on.
pub trait ShortcutPlatform {
    /// True for packaged Windows builds (`process.platform === 'win32' && app.isPackaged`).
    fn is_supported(&self) -> bool;
    /// Full path of the running executable (`process.execPath`).
    fn exe_path(&self) -> PathBuf;
    /// The user's Desktop folder (`app.getPath('desktop')`).
    fn desktop_dir(&self) -> PathBuf;
    fn path_exists(&self, path: &Path) -> bool;
    /// Writes a `.lnk` at `lnk` whose target is `target` (`IShellLinkW::SetPath` + `IPersistFile::Save`).
    /// Blocks the calling thread until COM returns.
    fn create_shell_link(&self, target: &Path, lnk: &Path) -> io::Result<()>;
}

/// `<exe basename without extension>.lnk`, the name Squirrel gives the shortcut.
pub fn shortcut_name_for_exe(exe_name: &str) -> String {
    let stem = Path::new(exe_name).file_stem().unwrap_or_default();
    format!("{}.lnk", stem.to_string_lossy())
}

fn exe_name(exe: &Path) -> String {
    exe.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

fn expected_shortcut_path(platform: &impl ShortcutPlatform, exe: &Path) -> PathBuf {
    platform
        .desktop_dir()
        .join(shortcut_name_for_exe(&exe_name(exe)))
}

/// Whether the launch-time Desktop prompt is due. Stateless: a dismissed prompt is simply offered again on the next launch.
pub fn should_prompt_for_desktop_shortcut(platform: &impl ShortcutPlatform) -> bool {
    if !platform.is_supported() {
        return false;
    }
    let exe = platform.exe_path();
    let legacy = platform.desktop_dir().join(LEGACY_SHORTCUT_NAME);
    !platform.path_exists(&expected_shortcut_path(platform, &exe)) && !platform.path_exists(&legacy)
}

/// Creates the Desktop `.lnk` pointing at the running executable through a Windows shell link, and reports success only when the expected `.lnk` exists.
/// Failures are logged and reported as `Ok(false)`. Blocks while COM writes the link, so the Tauri command must call it off the UI thread (e.g. `spawn_blocking`); the wiring is in Task 16.
pub fn create_desktop_shortcut(
    platform: &impl ShortcutPlatform,
    log: &impl ShortcutLog,
) -> Result<bool, Infallible> {
    if !platform.is_supported() {
        log.log(
            LogLevel::Warn,
            "Desktop shortcut creation is unsupported on this platform or build",
        );
        return Ok(false);
    }

    let exe = platform.exe_path();
    let expected = expected_shortcut_path(platform, &exe);
    if let Err(error) = platform.create_shell_link(&exe, &expected) {
        log.log(
            LogLevel::Error,
            &format!("Failed to create the desktop shortcut via a Windows shell link: {error}"),
        );
        return Ok(false);
    }

    // A successful call is not trusted on its own: the shortcut must exist on disk.
    if platform.path_exists(&expected) {
        log.log(
            LogLevel::Info,
            &format!(
                "Desktop shortcut created (shortcut: {}, target: {})",
                expected.display(),
                exe.display()
            ),
        );
        Ok(true)
    } else {
        log.log(
            LogLevel::Warn,
            &format!(
                "Shell link was written but the expected Desktop shortcut was not found (expectedPath: {})",
                expected.display()
            ),
        );
        Ok(false)
    }
}

/// Production [`ShortcutPlatform`]: real filesystem and the Windows shell link API.
pub struct SystemPlatform {
    exe_path: PathBuf,
    desktop_dir: PathBuf,
    packaged: bool,
}

impl SystemPlatform {
    pub fn new(exe_path: PathBuf, desktop_dir: PathBuf, packaged: bool) -> Self {
        Self {
            exe_path,
            desktop_dir,
            packaged,
        }
    }
}

impl ShortcutPlatform for SystemPlatform {
    fn is_supported(&self) -> bool {
        cfg!(windows) && self.packaged
    }

    fn exe_path(&self) -> PathBuf {
        self.exe_path.clone()
    }

    fn desktop_dir(&self) -> PathBuf {
        self.desktop_dir.clone()
    }

    fn path_exists(&self, path: &Path) -> bool {
        path.exists()
    }

    #[cfg(windows)]
    fn create_shell_link(&self, target: &Path, lnk: &Path) -> io::Result<()> {
        use windows::core::{Interface, HSTRING};
        use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED,
        };
        use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

        fn wide(path: &Path) -> HSTRING {
            use std::os::windows::ffi::OsStrExt;
            let units: Vec<u16> = path.as_os_str().encode_wide().collect();
            HSTRING::from_wide(&units)
        }

        // S_OK and S_FALSE both take a reference that must be released. RPC_E_CHANGED_MODE
        // means the thread already runs COM in another mode and holds no reference to release.
        let init = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        let owns_init = init.is_ok();
        if init.is_err() && init != RPC_E_CHANGED_MODE {
            return Err(io::Error::other(windows::core::Error::from(init)));
        }

        let result = (|| -> windows::core::Result<()> {
            let link: IShellLinkW =
                unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)? };
            unsafe { link.SetPath(&wide(target))? };
            let file: IPersistFile = link.cast()?;
            unsafe { file.Save(&wide(lnk), true)? };
            Ok(())
        })();

        if owns_init {
            unsafe { CoUninitialize() };
        }
        result.map_err(io::Error::other)
    }

    #[cfg(not(windows))]
    fn create_shell_link(&self, _target: &Path, _lnk: &Path) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Windows shell links are only available on Windows",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashSet;

    const EXE: &str = "root/app-1.0.0/credits-tracker.exe";
    const DESKTOP: &str = "desktop";
    const LNK: &str = "desktop/credits-tracker.lnk";

    /// What the fake shell-link call does.
    enum Link {
        /// Succeeds and leaves the `.lnk` behind.
        Writes,
        /// Succeeds but writes nothing.
        SucceedsWithoutWriting,
        /// Fails with an error.
        Fails,
    }

    struct FakeHost {
        supported: bool,
        files: RefCell<HashSet<PathBuf>>,
        link: Link,
        links: RefCell<Vec<(PathBuf, PathBuf)>>,
        logs: RefCell<Vec<(LogLevel, String)>>,
    }

    impl FakeHost {
        fn supported() -> Self {
            Self {
                supported: true,
                files: RefCell::new(HashSet::new()),
                link: Link::Writes,
                links: RefCell::new(Vec::new()),
                logs: RefCell::new(Vec::new()),
            }
        }

        fn with_file(self, path: &str) -> Self {
            self.files.borrow_mut().insert(PathBuf::from(path));
            self
        }

        fn logged(&self, level: LogLevel) -> usize {
            self.logs
                .borrow()
                .iter()
                .filter(|(l, _)| *l == level)
                .count()
        }
    }

    impl ShortcutLog for FakeHost {
        fn log(&self, level: LogLevel, message: &str) {
            self.logs.borrow_mut().push((level, message.to_string()));
        }
    }

    impl ShortcutPlatform for FakeHost {
        fn is_supported(&self) -> bool {
            self.supported
        }

        fn exe_path(&self) -> PathBuf {
            PathBuf::from(EXE)
        }

        fn desktop_dir(&self) -> PathBuf {
            PathBuf::from(DESKTOP)
        }

        fn path_exists(&self, path: &Path) -> bool {
            self.files.borrow().contains(path)
        }

        fn create_shell_link(&self, target: &Path, lnk: &Path) -> io::Result<()> {
            self.links
                .borrow_mut()
                .push((target.to_path_buf(), lnk.to_path_buf()));
            match self.link {
                Link::Writes => {
                    self.files.borrow_mut().insert(lnk.to_path_buf());
                    Ok(())
                }
                Link::SucceedsWithoutWriting => Ok(()),
                Link::Fails => Err(io::Error::new(io::ErrorKind::PermissionDenied, "no COM")),
            }
        }
    }

    fn create(host: &FakeHost) -> bool {
        create_desktop_shortcut(host, host).unwrap()
    }

    #[test]
    fn prompt_is_shown_when_no_shortcut_exists_without_any_update_exe() {
        assert!(should_prompt_for_desktop_shortcut(&FakeHost::supported()));
    }

    #[test]
    fn prompt_is_suppressed_once_expected_shortcut_exists() {
        let host = FakeHost::supported().with_file(LNK);
        assert!(!should_prompt_for_desktop_shortcut(&host));
    }

    #[test]
    fn prompt_is_suppressed_when_legacy_shortcut_exists() {
        let host = FakeHost::supported().with_file("desktop/Credits Tracker.lnk");
        assert!(!should_prompt_for_desktop_shortcut(&host));
    }

    #[test]
    fn prompt_is_not_shown_on_unsupported_builds() {
        let unsupported = FakeHost {
            supported: false,
            ..FakeHost::supported()
        };
        assert!(!should_prompt_for_desktop_shortcut(&unsupported));
    }

    #[test]
    fn prompt_stays_due_after_dismissal_because_eligibility_is_stateless() {
        let host = FakeHost::supported();
        assert!(should_prompt_for_desktop_shortcut(&host));
        assert!(should_prompt_for_desktop_shortcut(&host));
        assert!(host.links.borrow().is_empty());
    }

    #[test]
    fn shortcut_name_follows_exe_basename_not_product_name() {
        assert_eq!(
            shortcut_name_for_exe("credits-tracker.exe"),
            "credits-tracker.lnk"
        );
        assert_eq!(shortcut_name_for_exe("My.App.exe"), "My.App.lnk");
    }

    #[test]
    fn create_links_running_exe_to_desktop_lnk_and_reports_success() {
        let host = FakeHost::supported();
        assert!(create(&host));
        assert_eq!(
            host.links.borrow().as_slice(),
            &[(PathBuf::from(EXE), PathBuf::from(LNK))]
        );
        assert_eq!(host.logged(LogLevel::Info), 1);
    }

    #[test]
    fn create_returns_false_and_logs_error_when_shell_link_fails() {
        let host = FakeHost {
            link: Link::Fails,
            ..FakeHost::supported()
        };
        assert!(!create(&host));
        assert_eq!(host.logged(LogLevel::Error), 1);
    }

    #[test]
    fn create_returns_false_and_logs_warning_when_file_is_missing_after_the_call() {
        let host = FakeHost {
            link: Link::SucceedsWithoutWriting,
            ..FakeHost::supported()
        };
        assert!(!create(&host));
        assert_eq!(host.logged(LogLevel::Warn), 1);
    }

    #[test]
    fn create_does_not_write_a_link_on_unsupported_builds() {
        let unsupported = FakeHost {
            supported: false,
            ..FakeHost::supported()
        };
        assert!(!create(&unsupported));
        assert!(unsupported.links.borrow().is_empty());
        assert_eq!(unsupported.logged(LogLevel::Warn), 1);
    }
}
