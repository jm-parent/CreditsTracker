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

const UPDATE_EXE_NAME: &str = "Update.exe";

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
    /// Runs `Update.exe --createShortcut <exe_name>` and waits for it to exit.
    /// Returns the exit code, or `None` when the process was ended by a signal.
    fn run_create_shortcut(&self, update_exe: &Path, exe_name: &str) -> io::Result<Option<i32>>;
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

/// `Update.exe` sits two levels above the running exe (`<root>\app-x.y\app.exe` -> `<root>\Update.exe`).
fn update_exe_path(exe: &Path) -> Option<PathBuf> {
    Some(exe.parent()?.parent()?.join(UPDATE_EXE_NAME))
}

fn expected_shortcut_path(platform: &impl ShortcutPlatform, exe: &Path) -> PathBuf {
    platform
        .desktop_dir()
        .join(shortcut_name_for_exe(&exe_name(exe)))
}

fn squirrel_update_exe(platform: &impl ShortcutPlatform, exe: &Path) -> Option<PathBuf> {
    update_exe_path(exe).filter(|update| platform.path_exists(update))
}

/// Whether the launch-time Desktop prompt is due. Stateless: a dismissed prompt is simply offered again on the next launch.
pub fn should_prompt_for_desktop_shortcut(platform: &impl ShortcutPlatform) -> bool {
    if !platform.is_supported() {
        return false;
    }
    let exe = platform.exe_path();
    if squirrel_update_exe(platform, &exe).is_none() {
        return false;
    }
    let legacy = platform.desktop_dir().join(LEGACY_SHORTCUT_NAME);
    !platform.path_exists(&expected_shortcut_path(platform, &exe)) && !platform.path_exists(&legacy)
}

/// Creates the Desktop shortcut through Squirrel's `Update.exe` and reports success only when the expected `.lnk` exists.
/// Failures are logged and reported as `Ok(false)`. Blocks until Update.exe exits, so call it off the UI thread.
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
    let Some(update) = squirrel_update_exe(platform, &exe) else {
        log.log(
            LogLevel::Warn,
            &format!(
                "Desktop shortcut creation requires a Squirrel-managed installation (execPath: {})",
                exe.display()
            ),
        );
        return Ok(false);
    };

    let name = exe_name(&exe);
    let status = match platform.run_create_shortcut(&update, &name) {
        Ok(status) => status,
        Err(error) => {
            log.log(
                LogLevel::Error,
                &format!(
                    "Failed to start the desktop shortcut creation process via Update.exe: {error}"
                ),
            );
            return Ok(false);
        }
    };

    if status != Some(0) {
        log.log(
            LogLevel::Warn,
            &format!("Desktop shortcut creation reported failure via Update.exe (exeName: {name}, status: {status:?})"),
        );
        return Ok(false);
    }

    // A zero exit is not trusted on its own: the shortcut must exist on disk.
    let expected = expected_shortcut_path(platform, &exe);
    if platform.path_exists(&expected) {
        log.log(
            LogLevel::Info,
            &format!(
                "Desktop shortcut created via {} (exeName: {name})",
                update.display()
            ),
        );
        Ok(true)
    } else {
        log.log(
            LogLevel::Warn,
            &format!(
                "Update.exe exited successfully but the expected Desktop shortcut was not found (expectedPath: {})",
                expected.display()
            ),
        );
        Ok(false)
    }
}

/// Production [`ShortcutPlatform`]: real filesystem and a real `Update.exe` process.
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

    fn run_create_shortcut(&self, update_exe: &Path, exe_name: &str) -> io::Result<Option<i32>> {
        std::process::Command::new(update_exe)
            .args(["--createShortcut", exe_name])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|status| status.code())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashSet;

    const EXE: &str = "root/app-1.0.0/credits-tracker.exe";
    const UPDATE: &str = "root/Update.exe";
    const DESKTOP: &str = "desktop";

    enum Spawn {
        /// Update.exe exits with this code; `writes_shortcut` controls whether it leaves the `.lnk` behind.
        Exits {
            code: Option<i32>,
            writes_shortcut: bool,
        },
        FailsToStart,
    }

    struct FakeHost {
        supported: bool,
        files: RefCell<HashSet<PathBuf>>,
        spawn: Spawn,
        spawned: RefCell<Vec<(PathBuf, String)>>,
        logs: RefCell<Vec<(LogLevel, String)>>,
    }

    impl FakeHost {
        fn installed() -> Self {
            Self {
                supported: true,
                files: RefCell::new(HashSet::from([PathBuf::from(UPDATE)])),
                spawn: Spawn::Exits {
                    code: Some(0),
                    writes_shortcut: true,
                },
                spawned: RefCell::new(Vec::new()),
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

        fn run_create_shortcut(
            &self,
            update_exe: &Path,
            exe_name: &str,
        ) -> io::Result<Option<i32>> {
            self.spawned
                .borrow_mut()
                .push((update_exe.to_path_buf(), exe_name.to_string()));
            match self.spawn {
                Spawn::Exits {
                    code,
                    writes_shortcut,
                } => {
                    if writes_shortcut {
                        self.files
                            .borrow_mut()
                            .insert(PathBuf::from(DESKTOP).join("credits-tracker.lnk"));
                    }
                    Ok(code)
                }
                Spawn::FailsToStart => {
                    Err(io::Error::new(io::ErrorKind::NotFound, "no Update.exe"))
                }
            }
        }
    }

    fn create(host: &FakeHost) -> bool {
        create_desktop_shortcut(host, host).unwrap()
    }

    #[test]
    fn prompt_is_shown_for_squirrel_install_without_any_shortcut() {
        assert!(should_prompt_for_desktop_shortcut(&FakeHost::installed()));
    }

    #[test]
    fn prompt_is_suppressed_once_expected_shortcut_exists() {
        let host = FakeHost::installed().with_file("desktop/credits-tracker.lnk");
        assert!(!should_prompt_for_desktop_shortcut(&host));
    }

    #[test]
    fn prompt_is_suppressed_when_legacy_shortcut_exists() {
        let host = FakeHost::installed().with_file("desktop/Credits Tracker.lnk");
        assert!(!should_prompt_for_desktop_shortcut(&host));
    }

    #[test]
    fn prompt_is_not_shown_on_unsupported_or_non_squirrel_builds() {
        let unsupported = FakeHost {
            supported: false,
            ..FakeHost::installed()
        };
        assert!(!should_prompt_for_desktop_shortcut(&unsupported));

        let unmanaged = FakeHost {
            files: RefCell::new(HashSet::new()),
            ..FakeHost::installed()
        };
        assert!(!should_prompt_for_desktop_shortcut(&unmanaged));
    }

    #[test]
    fn dismissed_prompt_is_offered_again_on_next_launch() {
        let host = FakeHost::installed();
        assert!(should_prompt_for_desktop_shortcut(&host));
        assert!(should_prompt_for_desktop_shortcut(&host));
        assert!(host.spawned.borrow().is_empty());
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
    fn create_reports_success_only_when_update_exits_zero_and_shortcut_exists() {
        let host = FakeHost::installed();
        assert!(create(&host));
        assert_eq!(
            host.spawned.borrow().as_slice(),
            &[(PathBuf::from(UPDATE), "credits-tracker.exe".to_string())]
        );
        assert_eq!(host.logged(LogLevel::Info), 1);
    }

    #[test]
    fn create_returns_false_and_logs_warning_when_update_exits_nonzero() {
        let host = FakeHost {
            spawn: Spawn::Exits {
                code: Some(1),
                writes_shortcut: false,
            },
            ..FakeHost::installed()
        };
        assert!(!create(&host));
        assert_eq!(host.logged(LogLevel::Warn), 1);
    }

    #[test]
    fn create_returns_false_and_logs_error_when_update_cannot_start() {
        let host = FakeHost {
            spawn: Spawn::FailsToStart,
            ..FakeHost::installed()
        };
        assert!(!create(&host));
        assert_eq!(host.logged(LogLevel::Error), 1);
    }

    #[test]
    fn create_returns_false_when_exit_is_zero_but_shortcut_was_not_written() {
        let host = FakeHost {
            spawn: Spawn::Exits {
                code: Some(0),
                writes_shortcut: false,
            },
            ..FakeHost::installed()
        };
        assert!(!create(&host));
        assert_eq!(host.logged(LogLevel::Warn), 1);
    }

    #[test]
    fn create_does_not_spawn_when_unsupported_or_unmanaged() {
        let unsupported = FakeHost {
            supported: false,
            ..FakeHost::installed()
        };
        assert!(!create(&unsupported));

        let unmanaged = FakeHost {
            files: RefCell::new(HashSet::new()),
            ..FakeHost::installed()
        };
        assert!(!create(&unmanaged));

        assert!(unsupported.spawned.borrow().is_empty());
        assert!(unmanaged.spawned.borrow().is_empty());
    }
}
