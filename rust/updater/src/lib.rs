//! Opt-in update checks: the Rust-native replacement for `src/main/updater.ts`
//! (behavior contract: `specs/012-opt-in-app-updates`).
//!
//! Three rules hold: an availability check never downloads; a download starts
//! only from [`UpdateService::download_update`], which the user triggers by
//! accepting the offered release; and only [`UpdateService::restart_to_update`]
//! applies a staged update.
//!
//! This crate has no Tauri runtime dependency. The app supplies the feed,
//! download, and restart steps through [`UpdateBackend`].

use shared::{UpdateState, UpdateStatus};
use std::fmt;
use std::sync::Arc;
use std::time::Duration;

/// Delay between two automatic availability checks (`updater.ts` line 19).
pub const UPDATE_CHECK_INTERVAL_MS: u64 = 4 * 60 * 60 * 1000;
pub const UPDATE_CHECK_INTERVAL: Duration = Duration::from_millis(UPDATE_CHECK_INTERVAL_MS);

/// A release offered by the feed. `version` may carry a leading `v`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Release {
    pub version: String,
    pub notes: Option<String>,
}

/// What the installer reported after staging a release.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DownloadOutcome {
    /// The update is staged and applies on the next restart.
    Installed,
    /// The installer found nothing to install (`updater.ts` `update-not-available`).
    UpToDate,
    Failed(String),
}

/// Why an update check could not complete.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateError {
    /// The release feed could not be reached or answered unusably.
    Feed(String),
}

impl fmt::Display for UpdateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Feed(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for UpdateError {}

/// Platform steps the update flow depends on. The app implements this against
/// its release feed, installer, and restart; tests use fakes.
pub trait UpdateBackend {
    /// False for unpackaged development builds and unsupported platforms.
    fn is_supported(&self) -> bool;
    fn current_version(&self) -> String;
    /// ISO 8601 timestamp recorded as `last_checked_at`.
    fn now(&self) -> String;
    /// Asks the feed for a newer release without downloading it. `Ok(None)`
    /// means the running version is the latest.
    fn fetch_latest(&self) -> Result<Option<Release>, String>;
    /// Downloads and stages `release`. Called only after the user accepts it,
    /// and outside the service lock (see [`UpdateService::begin_download`]).
    fn download(&self, release: &Release) -> DownloadOutcome;
    /// Restarts the app so the staged update takes effect.
    fn restart(&self);
}

pub struct UpdateService<B: UpdateBackend> {
    backend: Arc<B>,
    state: UpdateState,
    offered: Option<Release>,
    checks_active: bool,
}

impl<B: UpdateBackend> UpdateService<B> {
    pub fn new(backend: B) -> Self {
        let state = fresh_state(&backend);
        Self { backend: Arc::new(backend), state, offered: None, checks_active: false }
    }

    pub fn backend(&self) -> &B {
        &self.backend
    }

    /// Shared handle to the backend. Lets the caller run
    /// [`UpdateBackend::download`] between [`Self::begin_download`] and
    /// [`Self::finish_download`] without holding the service lock.
    pub fn backend_handle(&self) -> Arc<B> {
        Arc::clone(&self.backend)
    }

    pub fn get_update_state(&self) -> UpdateState {
        self.state.clone()
    }

    /// Runs the startup check and enables periodic checks. The caller drives
    /// the periodic checks by calling [`Self::on_interval_elapsed`] every
    /// [`UPDATE_CHECK_INTERVAL`]. A failed check is recorded in the state.
    pub fn start_update_checks(&mut self) -> UpdateState {
        self.state = fresh_state(self.backend());
        if !self.backend.is_supported() {
            self.state.status = UpdateStatus::Unsupported;
            return self.get_update_state();
        }
        self.checks_active = true;
        let _ = self.check_for_update();
        self.get_update_state()
    }

    /// Disables periodic checks and clears the cached state.
    pub fn stop_update_checks(&mut self) {
        self.checks_active = false;
        self.offered = None;
        self.state = fresh_state(self.backend());
    }

    /// Timer callback. Does nothing unless checks were started. A failed
    /// check is recorded in the state.
    pub fn on_interval_elapsed(&mut self) -> UpdateState {
        if self.checks_active {
            let _ = self.check_for_update();
        }
        self.get_update_state()
    }

    /// Asks the feed whether a newer release exists. Never downloads. A
    /// download already in flight or staged is left untouched.
    ///
    /// A feed failure returns `Err` and leaves the state at `error` with the
    /// same message, so the state and the result always agree.
    pub fn check_for_update(&mut self) -> Result<UpdateState, UpdateError> {
        if !self.backend.is_supported() {
            self.state.status = UpdateStatus::Unsupported;
            return Ok(self.get_update_state());
        }
        if matches!(self.state.status, UpdateStatus::Downloading | UpdateStatus::Ready) {
            return Ok(self.get_update_state());
        }

        self.state.status = UpdateStatus::Checking;
        self.state.error = None;
        let checked_at = self.backend.now();
        let fetched = self.backend.fetch_latest();
        self.state.last_checked_at = Some(checked_at);
        match fetched {
            Ok(None) => {
                self.offered = None;
                self.state.status = UpdateStatus::UpToDate;
                self.state.latest_version = None;
                self.state.release_notes = None;
                Ok(self.get_update_state())
            }
            Ok(Some(release)) => {
                self.state.status = UpdateStatus::Available;
                self.state.latest_version = Some(strip_v(&release.version).to_string());
                self.state.release_notes = release.notes.clone();
                self.offered = Some(release);
                Ok(self.get_update_state())
            }
            Err(message) => {
                self.offered = None;
                self.state.status = UpdateStatus::Error;
                self.state.error = Some(message.clone());
                Err(UpdateError::Feed(message))
            }
        }
    }

    /// First half of the user's accept action. Returns the offered release to
    /// download and sets `downloading`. Returns `None` and leaves the state
    /// unchanged unless the status is `available` with a release offered.
    ///
    /// The caller then runs [`UpdateBackend::download`] on
    /// [`Self::backend_handle`] with the service lock released, and passes the
    /// outcome to [`Self::finish_download`].
    pub fn begin_download(&mut self) -> Option<Release> {
        if !self.backend.is_supported() {
            self.state.status = UpdateStatus::Unsupported;
            return None;
        }
        if self.state.status != UpdateStatus::Available {
            return None;
        }
        let release = self.offered.clone()?;
        self.state.status = UpdateStatus::Downloading;
        self.state.error = None;
        Some(release)
    }

    /// Second half of the accept action: records the download outcome. Ignored
    /// unless a download is in progress, so a late result cannot overwrite a
    /// state that [`Self::stop_update_checks`] has already reset.
    pub fn finish_download(&mut self, outcome: DownloadOutcome) -> UpdateState {
        if self.state.status != UpdateStatus::Downloading {
            return self.get_update_state();
        }
        self.offered = None;
        match outcome {
            DownloadOutcome::Installed => self.state.status = UpdateStatus::Ready,
            DownloadOutcome::UpToDate => {
                self.state.status = UpdateStatus::UpToDate;
                self.state.latest_version = None;
                self.state.release_notes = None;
            }
            DownloadOutcome::Failed(message) => {
                self.state.status = UpdateStatus::Error;
                self.state.error = Some(message);
            }
        }
        self.get_update_state()
    }

    /// One-shot accept: [`Self::begin_download`], the backend download, then
    /// [`Self::finish_download`], all under `&mut self`. Behind a lock, use the
    /// split pair so the lock is not held during the download.
    pub fn download_update(&mut self) -> UpdateState {
        let Some(release) = self.begin_download() else {
            return self.get_update_state();
        };
        let outcome = self.backend.download(&release);
        self.finish_download(outcome)
    }

    /// Restarts to apply the staged update. Does nothing unless one is ready.
    pub fn restart_to_update(&self) {
        if self.state.status == UpdateStatus::Ready {
            self.backend.restart();
        }
    }
}

fn fresh_state<B: UpdateBackend>(backend: &B) -> UpdateState {
    UpdateState {
        status: UpdateStatus::Checking,
        current_version: backend.current_version(),
        latest_version: None,
        release_notes: None,
        error: None,
        last_checked_at: None,
    }
}

fn strip_v(version: &str) -> &str {
    version.strip_prefix('v').unwrap_or(version)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::collections::VecDeque;
    use std::time::Duration;

    #[derive(Default)]
    struct FakeBackend {
        supported: bool,
        fetch_results: RefCell<VecDeque<Result<Option<Release>, String>>>,
        download_result: RefCell<Option<DownloadOutcome>>,
        fetches: Cell<u32>,
        downloads: RefCell<Vec<String>>,
        restarts: Cell<u32>,
    }

    impl FakeBackend {
        fn supported() -> Self {
            Self { supported: true, ..Self::default() }
        }

        fn with_fetch(self, result: Result<Option<Release>, String>) -> Self {
            self.fetch_results.borrow_mut().push_back(result);
            self
        }

        fn release(version: &str, notes: &str) -> Result<Option<Release>, String> {
            Ok(Some(Release { version: version.into(), notes: Some(notes.into()) }))
        }
    }

    impl UpdateBackend for FakeBackend {
        fn is_supported(&self) -> bool {
            self.supported
        }
        fn current_version(&self) -> String {
            "1.5.0".into()
        }
        fn now(&self) -> String {
            "2026-11-24T10:00:00.000Z".into()
        }
        fn fetch_latest(&self) -> Result<Option<Release>, String> {
            self.fetches.set(self.fetches.get() + 1);
            self.fetch_results.borrow_mut().pop_front().unwrap_or(Ok(None))
        }
        fn download(&self, release: &Release) -> DownloadOutcome {
            self.downloads.borrow_mut().push(release.version.clone());
            self.download_result.borrow_mut().take().unwrap_or(DownloadOutcome::Installed)
        }
        fn restart(&self) {
            self.restarts.set(self.restarts.get() + 1);
        }
    }

    #[test]
    fn interval_is_four_hours() {
        assert_eq!(UPDATE_CHECK_INTERVAL_MS, 4 * 60 * 60 * 1000);
        assert_eq!(UPDATE_CHECK_INTERVAL, Duration::from_secs(4 * 60 * 60));
    }

    #[test]
    fn check_for_update_never_downloads() {
        let mut svc = UpdateService::new(FakeBackend::supported().with_fetch(FakeBackend::release("v1.6.0", "notes")));
        let state = svc.check_for_update().unwrap();
        assert_eq!(state.status, UpdateStatus::Available);
        assert_eq!(state.latest_version.as_deref(), Some("1.6.0"));
        assert_eq!(state.release_notes.as_deref(), Some("notes"));
        assert_eq!(svc.backend().downloads.borrow().len(), 0);
    }

    #[test]
    fn download_is_noop_until_user_accepts() {
        let backend = FakeBackend::supported()
            .with_fetch(FakeBackend::release("1.6.0", ""))
            .with_fetch(FakeBackend::release("1.6.0", ""));
        let mut svc = UpdateService::new(backend);
        svc.start_update_checks();
        svc.on_interval_elapsed();
        assert_eq!(svc.get_update_state().status, UpdateStatus::Available);
        assert_eq!(svc.backend().downloads.borrow().len(), 0);

        let state = svc.download_update();
        assert_eq!(state.status, UpdateStatus::Ready);
        assert_eq!(svc.backend().downloads.borrow().as_slice(), ["1.6.0"]);
    }

    #[test]
    fn download_without_offered_update_is_noop() {
        let mut svc = UpdateService::new(FakeBackend::supported().with_fetch(Ok(None)));
        svc.check_for_update().unwrap();
        let state = svc.download_update();
        assert_eq!(state.status, UpdateStatus::UpToDate);
        assert_eq!(svc.backend().downloads.borrow().len(), 0);
    }

    #[test]
    fn up_to_date_clears_offer_and_records_check_time() {
        let mut svc = UpdateService::new(FakeBackend::supported().with_fetch(Ok(None)));
        let state = svc.check_for_update().unwrap();
        assert_eq!(state.status, UpdateStatus::UpToDate);
        assert_eq!(state.latest_version, None);
        assert_eq!(state.release_notes, None);
        assert_eq!(state.last_checked_at.as_deref(), Some("2026-11-24T10:00:00.000Z"));
    }

    #[test]
    fn fetch_error_is_returned_and_kept_in_state_until_retry_recovers() {
        let backend = FakeBackend::supported()
            .with_fetch(Err("feed down".into()))
            .with_fetch(FakeBackend::release("1.6.0", ""));
        let mut svc = UpdateService::new(backend);
        let err = svc.check_for_update().unwrap_err();
        assert_eq!(err, UpdateError::Feed("feed down".into()));
        assert_eq!(err.to_string(), "feed down");
        let state = svc.get_update_state();
        assert_eq!(state.status, UpdateStatus::Error);
        assert_eq!(state.error.as_deref(), Some("feed down"));

        let state = svc.check_for_update().unwrap();
        assert_eq!(state.status, UpdateStatus::Available);
        assert_eq!(state.error, None);
    }

    #[test]
    fn download_failure_enters_error_without_ready() {
        let mut backend = FakeBackend::supported().with_fetch(FakeBackend::release("1.6.0", ""));
        *backend.download_result.get_mut() = Some(DownloadOutcome::Failed("disk full".into()));
        let mut svc = UpdateService::new(backend);
        svc.check_for_update().unwrap();
        let state = svc.download_update();
        assert_eq!(state.status, UpdateStatus::Error);
        assert_eq!(state.error.as_deref(), Some("disk full"));
        svc.restart_to_update();
        assert_eq!(svc.backend().restarts.get(), 0);
    }

    #[test]
    fn begin_download_is_none_unless_available_with_offer() {
        let backend = FakeBackend::supported()
            .with_fetch(Ok(None))
            .with_fetch(FakeBackend::release("v1.6.0", ""));
        let mut svc = UpdateService::new(backend);
        assert_eq!(svc.begin_download(), None);
        assert_eq!(svc.get_update_state().status, UpdateStatus::Checking);

        svc.check_for_update().unwrap();
        assert_eq!(svc.begin_download(), None);
        assert_eq!(svc.get_update_state().status, UpdateStatus::UpToDate);

        svc.check_for_update().unwrap();
        let release = svc.begin_download().expect("offered release");
        assert_eq!(release.version, "v1.6.0");
        assert_eq!(svc.get_update_state().status, UpdateStatus::Downloading);
        assert_eq!(svc.begin_download(), None);
    }

    #[test]
    fn begin_download_is_none_when_unsupported_or_in_error() {
        let mut unsupported = UpdateService::new(FakeBackend::default());
        assert_eq!(unsupported.begin_download(), None);
        assert_eq!(unsupported.get_update_state().status, UpdateStatus::Unsupported);

        let mut failing = UpdateService::new(FakeBackend::supported().with_fetch(Err("down".into())));
        assert!(failing.check_for_update().is_err());
        assert_eq!(failing.begin_download(), None);
        assert_eq!(failing.get_update_state().status, UpdateStatus::Error);
    }

    #[test]
    fn split_download_runs_backend_between_begin_and_finish() {
        let mut svc = UpdateService::new(FakeBackend::supported().with_fetch(FakeBackend::release("1.6.0", "")));
        svc.check_for_update().unwrap();
        let release = svc.begin_download().expect("offered release");

        assert_eq!(svc.check_for_update().unwrap().status, UpdateStatus::Downloading);

        let outcome = svc.backend_handle().download(&release);
        let state = svc.finish_download(outcome);
        assert_eq!(state.status, UpdateStatus::Ready);
        assert_eq!(svc.backend().downloads.borrow().as_slice(), ["1.6.0"]);
    }

    #[test]
    fn finish_download_installed_is_ready_and_restart_applies() {
        let mut svc = UpdateService::new(FakeBackend::supported().with_fetch(FakeBackend::release("1.6.0", "")));
        svc.check_for_update().unwrap();
        svc.begin_download().expect("offered release");
        assert_eq!(svc.finish_download(DownloadOutcome::Installed).status, UpdateStatus::Ready);
        svc.restart_to_update();
        assert_eq!(svc.backend().restarts.get(), 1);
    }

    #[test]
    fn finish_download_up_to_date_clears_offer_and_restart_does_not_apply() {
        let mut svc = UpdateService::new(FakeBackend::supported().with_fetch(FakeBackend::release("1.6.0", "notes")));
        svc.check_for_update().unwrap();
        svc.begin_download().expect("offered release");
        let state = svc.finish_download(DownloadOutcome::UpToDate);
        assert_eq!(state.status, UpdateStatus::UpToDate);
        assert_eq!(state.latest_version, None);
        assert_eq!(state.release_notes, None);
        assert_eq!(state.error, None);

        svc.restart_to_update();
        assert_eq!(svc.backend().restarts.get(), 0);
        assert_eq!(svc.begin_download(), None);
    }

    #[test]
    fn finish_download_without_begin_is_ignored() {
        let mut svc = UpdateService::new(FakeBackend::supported().with_fetch(FakeBackend::release("1.6.0", "")));
        svc.check_for_update().unwrap();
        let state = svc.finish_download(DownloadOutcome::Installed);
        assert_eq!(state.status, UpdateStatus::Available);
    }

    #[test]
    fn periodic_check_does_not_reset_ready_or_downloading_state() {
        let mut svc = UpdateService::new(FakeBackend::supported().with_fetch(FakeBackend::release("1.6.0", "")));
        svc.start_update_checks();
        svc.download_update();
        assert_eq!(svc.get_update_state().status, UpdateStatus::Ready);

        let fetches_before = svc.backend().fetches.get();
        let state = svc.on_interval_elapsed();
        assert_eq!(state.status, UpdateStatus::Ready);
        assert_eq!(svc.backend().fetches.get(), fetches_before);
    }

    #[test]
    fn restart_applies_only_when_ready() {
        let mut svc = UpdateService::new(FakeBackend::supported().with_fetch(FakeBackend::release("1.6.0", "")));
        svc.check_for_update().unwrap();
        svc.restart_to_update();
        assert_eq!(svc.backend().restarts.get(), 0);

        svc.download_update();
        svc.restart_to_update();
        assert_eq!(svc.backend().restarts.get(), 1);
    }

    #[test]
    fn unsupported_build_never_fetches_or_downloads() {
        let mut svc = UpdateService::new(FakeBackend::default());
        let state = svc.start_update_checks();
        assert_eq!(state.status, UpdateStatus::Unsupported);
        assert_eq!(svc.on_interval_elapsed().status, UpdateStatus::Unsupported);
        assert_eq!(svc.download_update().status, UpdateStatus::Unsupported);
        assert_eq!(svc.backend().fetches.get(), 0);
        assert_eq!(svc.backend().downloads.borrow().len(), 0);
    }

    #[test]
    fn periodic_checks_run_only_between_start_and_stop() {
        let mut svc = UpdateService::new(FakeBackend::supported());
        svc.on_interval_elapsed();
        assert_eq!(svc.backend().fetches.get(), 0);

        svc.start_update_checks();
        assert_eq!(svc.backend().fetches.get(), 1);
        svc.on_interval_elapsed();
        assert_eq!(svc.backend().fetches.get(), 2);

        svc.stop_update_checks();
        svc.on_interval_elapsed();
        assert_eq!(svc.backend().fetches.get(), 2);
    }
}
