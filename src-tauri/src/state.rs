//! Process state for the Tauri shell and the adapters that connect the unit crates to Tauri.
//!
//! The usage database is rebuilt at most every few seconds, as `registerIpcHandlers` does in
//! `src/main/ipc-handlers.ts`. The updater backend talks to the release feed over HTTPS. Its
//! download and install steps are not implemented yet (see `TauriUpdateBackend::download`).

use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use agent_trace_receiver::service::AgentTraceService;
use aggregate::port::build_merged_database;
use db::port::{DatabaseError, open_database};
use rusqlite::Connection;
use serde_json::{Value, json};
use shortcut::{LogLevel as ShortcutLevel, ShortcutLog};
use tauri::{AppHandle, Emitter};
use updater::{DownloadOutcome, Release, UpdateBackend, UpdateService};
use vscode_chat::port::load_vscode_usage;

use shared::UpdateState;

/// The merged database is rebuilt at most this often (`DB_REFRESH_INTERVAL_MS` in ipc-handlers.ts).
const DB_REFRESH_INTERVAL: Duration = Duration::from_secs(5);

/// Channel name of the state event the renderer subscribes to (`UPDATE_STATE_CHANNEL` in updater.ts).
pub const UPDATE_STATE_EVENT: &str = "update-state-changed";

const FEED_HOST: &str = "https://update.electronjs.org";
const FEED_REPO: &str = "jm-parent/CreditsTracker";
/// Upper bound for one feed request. Update commands wait on the update lock while a check runs,
/// so this also bounds that wait.
const FEED_TIMEOUT: Duration = Duration::from_secs(15);

const EMPTY_CLI_SCHEMA: &str = "
    CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, summary TEXT, created_at TEXT);
    CREATE TABLE assistant_usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        model TEXT NOT NULL,
        total_nano_aiu INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        created_at TEXT
    );
";

/// Everything the commands share. Held in Tauri state as `Arc<AppState>`.
pub struct AppState {
    pub db: DbCache,
    pub trace: Arc<AgentTraceService>,
    pub updater: Arc<Mutex<UpdateService<TauriUpdateBackend>>>,
}

impl AppState {
    pub fn lock_updater(&self) -> Result<MutexGuard<'_, UpdateService<TauriUpdateBackend>>, String> {
        self.updater.lock().map_err(|_| "update state lock poisoned".to_string())
    }
}

struct BuiltDb {
    connection: Connection,
    built_at: Instant,
}

pub struct DbCache {
    cli_db_path: PathBuf,
    workspace_storage_dir: PathBuf,
    built: Mutex<Option<BuiltDb>>,
}

impl DbCache {
    pub fn new(cli_db_path: PathBuf, workspace_storage_dir: PathBuf) -> Self {
        Self { cli_db_path, workspace_storage_dir, built: Mutex::new(None) }
    }

    /// Runs `read` against the merged database, rebuilding it first when the cached copy is stale.
    /// A failed rebuild is returned as an error and retried on the next call.
    pub fn with_db<T>(&self, read: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
        let mut built = self.built.lock().map_err(|_| "database lock poisoned".to_string())?;
        let stale = built.as_ref().is_none_or(|cached| cached.built_at.elapsed() >= DB_REFRESH_INTERVAL);
        if stale {
            let connection = self.build()?;
            *built = Some(BuiltDb { connection, built_at: Instant::now() });
        }
        let Some(cached) = built.as_ref() else {
            return Err("merged database is not available".to_string());
        };
        read(&cached.connection)
    }

    /// Port of `buildMergedDatabaseFromSources` in ipc-handlers.ts.
    fn build(&self) -> Result<Connection, String> {
        let cli = match open_database(&self.cli_db_path) {
            Ok(connection) => connection,
            Err(DatabaseError::NotFound(path)) => {
                let _ = logger::port::log_once(
                    "db-missing".into(),
                    "warn".into(),
                    "db".into(),
                    "Copilot CLI database not found, falling back to an empty schema".into(),
                    Some(json!(path.display().to_string())),
                );
                let connection = Connection::open_in_memory().map_err(|error| error.to_string())?;
                connection.execute_batch(EMPTY_CLI_SCHEMA).map_err(|error| error.to_string())?;
                connection
            }
            Err(error) => {
                let message = error.to_string();
                let _ = logger::port::log_error(
                    "db".into(),
                    "Failed to open the Copilot CLI database".into(),
                    Some(json!(message)),
                );
                return Err(message);
            }
        };

        let vscode = load_vscode_usage(&self.workspace_storage_dir);
        let merged = build_merged_database(&cli, &vscode).map_err(|error| error.to_string())?;
        let _ = logger::port::log_once(
            format!("db-built:{}:{}", vscode.sessions.len(), vscode.events.len()),
            "info".into(),
            "db".into(),
            "Merged database rebuilt".into(),
            Some(json!({
                "dbPath": self.cli_db_path.display().to_string(),
                "vscodeSessions": vscode.sessions.len(),
                "vscodeEvents": vscode.events.len(),
            })),
        );
        Ok(merged)
    }
}

/// Emits the update state to every window, as `setState` does in updater.ts.
pub fn publish_update_state(app: &AppHandle, state: &UpdateState) {
    let _ = app.emit(UPDATE_STATE_EVENT, state);
}

/// Platform steps for the update flow, backed by the Tauri app.
///
/// Implemented so far: the release feed check (`fetch_latest`) and the restart. Downloading and
/// staging an installer is deferred to a follow-up, so `download` reports a failure.
pub struct TauriUpdateBackend {
    app: AppHandle,
    current_version: String,
}

impl TauriUpdateBackend {
    pub fn new(app: AppHandle, current_version: String) -> Self {
        Self { app, current_version }
    }
}

/// Same feed as `feedUrl()` in updater.ts, keyed by Node's platform and arch names.
fn feed_url(current_version: &str) -> String {
    let platform = match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    };
    format!("{FEED_HOST}/{FEED_REPO}/{platform}-{arch}/{current_version}")
}

#[derive(serde::Deserialize)]
struct FeedPayload {
    name: Option<String>,
    notes: Option<String>,
}

impl UpdateBackend for TauriUpdateBackend {
    fn is_supported(&self) -> bool {
        // Mirrors `isUpdateSupported` in updater.ts: packaged builds on Windows and macOS only.
        !cfg!(debug_assertions) && (cfg!(windows) || cfg!(target_os = "macos"))
    }

    fn current_version(&self) -> String {
        self.current_version.clone()
    }

    fn now(&self) -> String {
        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    }

    fn fetch_latest(&self) -> Result<Option<Release>, String> {
        let agent = ureq::Agent::new_with_config(
            ureq::Agent::config_builder()
                .http_status_as_error(false)
                .timeout_global(Some(FEED_TIMEOUT))
                .build(),
        );
        let mut response = agent
            .get(&feed_url(&self.current_version))
            .header("accept", "application/json")
            .call()
            .map_err(|error| format!("Update feed request failed: {error}"))?;

        let status = response.status();
        if status.as_u16() == 204 {
            let _ = logger::port::log_info(
                "updater".into(),
                format!("No update available, {} is the latest version", self.current_version),
                None,
            );
            return Ok(None);
        }
        if !status.is_success() {
            let reason = status.canonical_reason().unwrap_or_default();
            return Err(format!("Update feed responded with {} {reason}", status.as_u16()));
        }

        let payload: FeedPayload = response
            .body_mut()
            .read_json()
            .map_err(|error| format!("Update feed returned an unreadable payload: {error}"))?;
        // A release without a name cannot be offered (the version is what the user accepts), so it is a
        // feed error here rather than the unnamed "available" state that updater.ts shows.
        let name = payload
            .name
            .filter(|name| !name.trim().is_empty())
            .ok_or_else(|| "Update feed returned a release without a version".to_string())?;
        let _ = logger::port::log_info(
            "updater".into(),
            format!("Update {name} is available"),
            None,
        );
        Ok(Some(Release { version: name, notes: payload.notes }))
    }

    fn download(&self, _release: &Release) -> DownloadOutcome {
        DownloadOutcome::Failed(
            "Installing updates is not available in the Tauri build yet".to_string(),
        )
    }

    fn restart(&self) {
        self.app.restart()
    }
}

/// Routes shortcut diagnostics into the app log, under the `shortcut` scope.
pub struct LoggerShortcutLog;

impl ShortcutLog for LoggerShortcutLog {
    fn log(&self, level: ShortcutLevel, message: &str) {
        let scope = "shortcut".to_string();
        let message = message.to_string();
        let _ = match level {
            ShortcutLevel::Info => logger::port::log_info(scope, message, None),
            ShortcutLevel::Warn => logger::port::log_warn(scope, message, None),
            ShortcutLevel::Error => logger::port::log_error(scope, message, None),
        };
    }
}

/// Logger entries are stored as JSON, where `undefined` details are a marker object. The renderer
/// expects `null` there.
pub fn to_log_entry(mut value: Value) -> Result<shared::LogEntry, String> {
    if let Some(detail) = value.get_mut("detail")
        && logger::js::is_undefined(detail)
    {
        *detail = Value::Null;
    }
    serde_json::from_value(value).map_err(|error| error.to_string())
}
