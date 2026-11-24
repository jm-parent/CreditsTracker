//! Process state for the Tauri shell and the adapters that connect the unit crates to Tauri.
//!
//! The usage database is rebuilt at most every few seconds, as `registerIpcHandlers` does in
//! `src/main/ipc-handlers.ts`. The updater backend uses the Tauri updater plugin (`latest.json`).

use std::future::Future;
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
use tauri_plugin_updater::{Update, UpdaterExt};
use updater::{DownloadOutcome, Release, UpdateBackend, UpdateService};
use vscode_chat::port::load_vscode_usage;

use shared::UpdateState;

/// The merged database is rebuilt at most this often (`DB_REFRESH_INTERVAL_MS` in ipc-handlers.ts).
const DB_REFRESH_INTERVAL: Duration = Duration::from_secs(5);

/// Channel name of the state event the renderer subscribes to (`UPDATE_STATE_CHANNEL` in updater.ts).
pub const UPDATE_STATE_EVENT: &str = "update-state-changed";

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

/// Platform steps for the update flow, backed by the Tauri updater plugin.
///
/// The plugin reads `latest.json` from the endpoint in `tauri.conf.json`, verifies the signature
/// against the public key there, and stages the installer. Checks never download; `download` runs
/// only after the user accepts, and `restart` installs the staged installer.
pub struct TauriUpdateBackend {
    app: AppHandle,
    current_version: String,
    /// The update found by the last check, kept until the user accepts it.
    found: Mutex<Option<Update>>,
    /// The update and its downloaded installer, installed on restart.
    staged: Mutex<Option<(Update, Vec<u8>)>>,
}

impl TauriUpdateBackend {
    pub fn new(app: AppHandle, current_version: String) -> Self {
        Self {
            app,
            current_version,
            found: Mutex::new(None),
            staged: Mutex::new(None),
        }
    }
}

/// Runs a plugin future to completion on its own thread, so the update steps never block the async
/// runtime the commands run on.
fn run_blocking<T: Send>(future: impl Future<Output = T> + Send) -> T {
    std::thread::scope(|scope| {
        scope
            .spawn(|| tauri::async_runtime::block_on(future))
            .join()
            .expect("update worker panicked")
    })
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
        let updater = self
            .app
            .updater()
            .map_err(|error| format!("Updater is not configured: {error}"))?;
        let found = run_blocking(async move { updater.check().await })
            .map_err(|error| format!("Update check failed: {error}"))?;
        let mut slot = self
            .found
            .lock()
            .map_err(|_| "update slot lock poisoned".to_string())?;
        match found {
            None => {
                *slot = None;
                let _ = logger::port::log_info(
                    "updater".into(),
                    format!("No update available, {} is the latest version", self.current_version),
                    None,
                );
                Ok(None)
            }
            Some(update) => {
                let release = Release {
                    version: update.version.clone(),
                    notes: update.body.clone(),
                };
                let _ = logger::port::log_info(
                    "updater".into(),
                    format!("Update {} is available", release.version),
                    None,
                );
                *slot = Some(update);
                Ok(Some(release))
            }
        }
    }

    fn download(&self, release: &Release) -> DownloadOutcome {
        let update = match self.found.lock().ok().and_then(|mut slot| slot.take()) {
            Some(update) if update.version == release.version => update,
            _ => {
                return DownloadOutcome::Failed(
                    "No update is waiting to be downloaded, check for updates again".to_string(),
                );
            }
        };
        let version = update.version.clone();
        match run_blocking(async move {
            let bytes = update.download(|_, _| {}, || {}).await?;
            Ok::<_, tauri_plugin_updater::Error>((update, bytes))
        }) {
            Ok((update, bytes)) => {
                let Ok(mut staged) = self.staged.lock() else {
                    return DownloadOutcome::Failed("update slot lock poisoned".to_string());
                };
                *staged = Some((update, bytes));
                let _ = logger::port::log_info(
                    "updater".into(),
                    format!("Update {version} downloaded, it will be installed on restart"),
                    None,
                );
                DownloadOutcome::Installed
            }
            Err(error) => DownloadOutcome::Failed(format!("Update download failed: {error}")),
        }
    }

    fn restart(&self) {
        let staged = self.staged.lock().ok().and_then(|mut slot| slot.take());
        let Some((update, bytes)) = staged else {
            let _ = logger::port::log_error(
                "updater".into(),
                "Restart requested with no downloaded update to install".into(),
                None,
            );
            return;
        };
        if let Err(error) = update.install(bytes) {
            let _ = logger::port::log_error(
                "updater".into(),
                "Update install failed, staying on the current version".into(),
                Some(json!(error.to_string())),
            );
            return;
        }
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
