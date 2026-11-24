//! Tauri commands, one per IPC channel in `src/main/ipc-handlers.ts`.
//!
//! Each command keeps its channel's payload shape. The command name is the channel name with `-`
//! replaced by `_`, since Rust identifiers cannot contain `-`. Commands run on the async runtime
//! and move blocking work (SQLite, filesystem, COM, network, dialogs) onto the blocking pool.

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use db::port as queries;
use export::port::{get_export_file_path, write_export_file};
use html_report::port::render_html_report;
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{Value, json};
use shared::{
    AgentTraceCollectionStatus, AgentTraceSelection, AgentTraceSession, AgentTraceSource,
    ExportPreview, ExportRequest, ExportResult, FilterOptions, HourlyDetailParams, HourlyPoint,
    HtmlReportOptions, LogsSnapshot, MonthlyActivityParams, ProjectDetailResult, RawTableParams,
    RawTablePage, TimeSeriesPoint, UpdateState, UpdateStatus, UsageFilters, UsageResult,
};
use shortcut::SystemPlatform;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;
use updater::{DownloadOutcome, UpdateBackend};

use crate::state::{AppState, LoggerShortcutLog, publish_update_state, to_log_entry};

/// Channels left out of the slow-call trace: the Logs page polls them, so tracing them would grow the log.
const UNTRACED_CHANNELS: [&str; 3] = ["get-logs", "clear-logs", "log-message"];
/// Calls at least this slow are traced even when they succeed (`SLOW_CALL_MS` in ipc-handlers.ts).
const SLOW_CALL_MS: u128 = 250;

/// Port of the `handle()` wrapper in ipc-handlers.ts: failures are logged with their channel, and slow calls are traced.
fn traced<T>(channel: &str, started: Instant, result: Result<T, String>) -> Result<T, String> {
    let elapsed = started.elapsed().as_millis();
    match &result {
        Err(error) => {
            let _ = logger::port::log_error(
                "ipc".into(),
                format!("{channel} failed after {elapsed}ms"),
                Some(json!(error)),
            );
        }
        Ok(_) if elapsed >= SLOW_CALL_MS && !UNTRACED_CHANNELS.contains(&channel) => {
            let _ = logger::port::log_warn("ipc".into(), format!("{channel} took {elapsed}ms"), None);
        }
        Ok(_) => {}
    }
    result
}

/// Runs blocking work (SQLite, filesystem, COM, network, dialogs) off the async runtime.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

async fn read_db<T: Send + 'static>(
    app: Arc<AppState>,
    read: impl FnOnce(&Connection) -> queries::Result<T> + Send + 'static,
) -> Result<T, String> {
    blocking(move || app.db.with_db(|db| read(db).map_err(|error| error.to_string()))).await
}

async fn query<T: Send + 'static>(
    app: Arc<AppState>,
    channel: &'static str,
    read: impl FnOnce(&Connection) -> queries::Result<T> + Send + 'static,
) -> Result<T, String> {
    let started = Instant::now();
    let result = read_db(app, read).await;
    traced(channel, started, result)
}

/// `filters ?? {}` from ipc-handlers.ts: a missing filter object means no filter.
fn filters_or_default(filters: Option<UsageFilters>) -> UsageFilters {
    filters.unwrap_or(UsageFilters {
        project: None,
        project_search: None,
        model: None,
        from: None,
        to: None,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetailParams {
    #[serde(flatten)]
    filters: UsageFilters,
    project: String,
}

#[tauri::command]
pub async fn get_filter_options(state: State<'_, Arc<AppState>>) -> Result<FilterOptions, String> {
    query(state.inner().clone(), "get-filter-options", queries::get_filter_options).await
}

#[tauri::command]
pub async fn get_usage(
    state: State<'_, Arc<AppState>>,
    filters: Option<UsageFilters>,
) -> Result<UsageResult, String> {
    let filters = filters_or_default(filters);
    query(state.inner().clone(), "get-usage", move |db| queries::get_usage(db, &filters)).await
}

#[tauri::command]
pub async fn get_project_detail(
    state: State<'_, Arc<AppState>>,
    params: ProjectDetailParams,
) -> Result<ProjectDetailResult, String> {
    query(state.inner().clone(), "get-project-detail", move |db| {
        queries::get_project_detail(db, &params.project, &params.filters)
    })
    .await
}

#[tauri::command]
pub async fn get_raw_table_page(
    state: State<'_, Arc<AppState>>,
    params: RawTableParams,
) -> Result<RawTablePage, String> {
    query(state.inner().clone(), "get-raw-table-page", move |db| {
        queries::get_raw_table_page(db, params.table, params.page, params.page_size)
    })
    .await
}

#[tauri::command]
pub async fn get_hourly_detail(
    state: State<'_, Arc<AppState>>,
    params: HourlyDetailParams,
) -> Result<Vec<HourlyPoint>, String> {
    query(state.inner().clone(), "get-hourly-detail", move |db| {
        queries::get_hourly_detail(db, &params)
    })
    .await
}

#[tauri::command]
pub async fn get_monthly_activity(
    state: State<'_, Arc<AppState>>,
    params: MonthlyActivityParams,
) -> Result<Vec<TimeSeriesPoint>, String> {
    query(state.inner().clone(), "get-monthly-activity", move |db| {
        queries::get_monthly_activity(db, &params)
    })
    .await
}

#[tauri::command]
pub async fn get_export_preview(
    state: State<'_, Arc<AppState>>,
    filters: Option<UsageFilters>,
) -> Result<ExportPreview, String> {
    let filters = filters_or_default(filters);
    query(state.inner().clone(), "get-export-preview", move |db| {
        queries::get_export_report(db, &filters).map(|report| report.preview)
    })
    .await
}

fn cancelled_export() -> ExportResult {
    ExportResult { cancelled: true, html_path: None, summary_rows: None, session_rows: None }
}

#[tauri::command]
pub async fn export_html(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    request: Option<ExportRequest>,
) -> Result<ExportResult, String> {
    let started = Instant::now();
    let result = export_html_flow(app, state.inner().clone(), request).await;
    traced("export-html", started, result)
}

/// The export-html channel: query, ask where to save, confirm an overwrite, render, and write.
async fn export_html_flow(
    app: AppHandle,
    shared: Arc<AppState>,
    request: Option<ExportRequest>,
) -> Result<ExportResult, String> {
    let filters = filters_or_default(request.as_ref().map(|request| request.filters.clone()));
    let suggested_name = request
        .and_then(|request| request.suggested_name)
        .unwrap_or_else(|| "copilot-usage.html".to_string());

    let report_filters = filters.clone();
    let report = read_db(shared, move |db| queries::get_export_report(db, &report_filters)).await?;

    let dialog_app = app.clone();
    let picked = blocking(move || {
        Ok(dialog_app
            .dialog()
            .file()
            .set_title("Export Copilot usage")
            .set_file_name(suggested_name)
            .add_filter("HTML files", &["html"])
            .blocking_save_file())
    })
    .await?;
    let Some(picked) = picked else {
        return Ok(cancelled_export());
    };
    let selected = picked
        .into_path()
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .into_owned();

    let html_path = get_export_file_path(selected)?;
    if Path::new(&html_path).exists() {
        let confirm_app = app.clone();
        let message = format!("Overwrite the existing HTML report?\n\n{html_path}");
        let overwrite = blocking(move || {
            Ok(confirm_app
                .dialog()
                .message(message)
                .title("Files already exist")
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom("Overwrite".into(), "Cancel".into()))
                .blocking_show())
        })
        .await?;
        if !overwrite {
            return Ok(cancelled_export());
        }
    }

    let html = render_html_report(&report, &HtmlReportOptions { filters, generated_at: None })
        .map_err(|error| error.to_string())?;
    write_export_file(html_path.clone(), html).await?;
    Ok(ExportResult {
        cancelled: false,
        html_path: Some(html_path),
        summary_rows: Some(report.summary_rows.len() as f64),
        session_rows: Some(report.session_rows.len() as f64),
    })
}

#[tauri::command]
pub async fn get_app_version(app: AppHandle) -> Result<String, String> {
    Ok(app.package_info().version.to_string())
}

fn validate_collection_enabled(value: Value) -> Result<bool, String> {
    value
        .as_bool()
        .ok_or_else(|| "Agent trace collection opt-in must be a boolean".to_string())
}

fn validate_selection(value: Value) -> Result<AgentTraceSelection, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "Agent trace selection must be an object".to_string())?;
    let source = match object.get("source").and_then(Value::as_str) {
        Some("vscode") => AgentTraceSource::Vscode,
        Some("copilot-cli") => AgentTraceSource::CopilotCli,
        _ => return Err("Agent trace selection source must be \"vscode\" or \"copilot-cli\"".to_string()),
    };
    let session_id = object
        .get("sessionId")
        .and_then(Value::as_str)
        .filter(|session_id| !session_id.trim().is_empty())
        .ok_or_else(|| "Agent trace session id must be a non-empty string".to_string())?;
    Ok(AgentTraceSelection { source, session_id: session_id.to_string() })
}

#[tauri::command]
pub async fn get_agent_trace_collection_status(
    state: State<'_, Arc<AppState>>,
) -> Result<AgentTraceCollectionStatus, String> {
    let started = Instant::now();
    let shared = state.inner().clone();
    let result = blocking(move || Ok(shared.trace.get_status())).await;
    traced("get-agent-trace-collection-status", started, result)
}

#[tauri::command]
pub async fn set_agent_trace_collection_enabled(
    state: State<'_, Arc<AppState>>,
    enabled: Value,
) -> Result<AgentTraceCollectionStatus, String> {
    let started = Instant::now();
    let shared = state.inner().clone();
    let result = blocking(move || {
        let enabled = validate_collection_enabled(enabled)?;
        Ok(shared.trace.set_enabled(enabled))
    })
    .await;
    traced("set-agent-trace-collection-enabled", started, result)
}

#[tauri::command]
pub async fn get_agent_trace_session(
    state: State<'_, Arc<AppState>>,
    selection: Value,
) -> Result<AgentTraceSession, String> {
    let started = Instant::now();
    let shared = state.inner().clone();
    let result = blocking(move || {
        let selection = validate_selection(selection)?;
        Ok(shared.trace.get_session(&selection))
    })
    .await;
    traced("get-agent-trace-session", started, result)
}

#[tauri::command]
pub async fn clear_agent_trace_data(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let started = Instant::now();
    let shared = state.inner().clone();
    let result = blocking(move || {
        shared.trace.clear();
        Ok(())
    })
    .await;
    traced("clear-agent-trace-data", started, result)
}

fn logs_snapshot() -> Result<LogsSnapshot, String> {
    let entries = logger::port::get_log_entries()?
        .into_iter()
        .map(to_log_entry)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(LogsSnapshot { entries, file_path: logger::port::get_log_file_path()? })
}

#[tauri::command]
pub async fn get_logs() -> Result<LogsSnapshot, String> {
    logs_snapshot()
}

#[tauri::command]
pub async fn clear_logs() -> Result<LogsSnapshot, String> {
    logger::port::clear_logs()?;
    let _ = logger::port::log_info(
        "logs".into(),
        "Log buffer cleared from the Logs page".into(),
        None,
    );
    logs_snapshot()
}

#[tauri::command]
pub async fn open_log_file(app: AppHandle) -> Result<Option<String>, String> {
    let started = Instant::now();
    let result = match logger::port::get_log_file_path()? {
        Some(path) => {
            app.opener().reveal_item_in_dir(&path).map_err(|error| error.to_string())?;
            Ok(Some(path))
        }
        None => {
            let _ = logger::port::log_warn(
                "logs".into(),
                "No log file configured, cannot reveal it in the file explorer".into(),
                None,
            );
            Ok(None)
        }
    };
    traced("open-log-file", started, result)
}

/// Port of `validateExternalRepositoryUrl` in ipc-handlers.ts: only canonical `https://github.com/<owner>/<repo>` URLs.
fn validate_external_repository_url(value: Value) -> Result<String, String> {
    const REJECTED: &str = "Only GitHub repository URLs can be opened";
    let Value::String(text) = value else {
        return Err(REJECTED.to_string());
    };
    let parsed = url::Url::parse(&text).map_err(|_| REJECTED.to_string())?;
    let path = parsed.path();
    let segments: Vec<&str> = path.split('/').collect();
    let canonical_path = segments.len() == 3
        && segments[0].is_empty()
        && segments[1..]
            .iter()
            .all(|segment| !segment.is_empty() && !segment.contains(['%', '?', '#']));
    if !canonical_path || text != format!("https://github.com{path}") {
        return Err(REJECTED.to_string());
    }
    Ok(text)
}

#[tauri::command]
pub async fn open_external_url(app: AppHandle, url: Value) -> Result<(), String> {
    let started = Instant::now();
    let result = validate_external_repository_url(url).and_then(|url| {
        app.opener().open_url(url, None::<String>).map_err(|error| error.to_string())
    });
    traced("open-external-url", started, result)
}

#[tauri::command]
pub async fn log_message(entry: Option<Value>) -> Result<(), String> {
    let entry = entry.unwrap_or_else(|| {
        json!({ "level": "info", "scope": "renderer", "message": "(empty message)" })
    });
    logger::port::record_renderer_log(entry).map(|_| ())
}

#[tauri::command]
pub async fn get_update_state(state: State<'_, Arc<AppState>>) -> Result<UpdateState, String> {
    let shared = state.inner().clone();
    blocking(move || Ok(shared.lock_updater()?.get_update_state())).await
}

#[tauri::command]
pub async fn check_for_update(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<UpdateState, String> {
    let started = Instant::now();
    let shared = state.inner().clone();
    let result = blocking(move || {
        let mut service = shared.lock_updater()?;
        if let Err(error) = service.check_for_update() {
            let _ = logger::port::log_warn(
                "updater".into(),
                "Failed to check for updates".into(),
                Some(json!(error.to_string())),
            );
        }
        let next = service.get_update_state();
        publish_update_state(&app, &next);
        Ok(next)
    })
    .await;
    traced("check-for-update", started, result)
}

/// Accepting an offered update: `begin_download` and `finish_download` bracket the backend download,
/// so the update lock is not held while the download runs.
#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<UpdateState, String> {
    let started = Instant::now();
    let shared = state.inner().clone();
    let result = blocking(move || {
        let mut service = shared.lock_updater()?;
        let release = service.begin_download();
        publish_update_state(&app, &service.get_update_state());
        let Some(release) = release else {
            return Ok(service.get_update_state());
        };
        let _ = logger::port::log_info(
            "updater".into(),
            format!("Downloading update {}", release.version),
            None,
        );
        let backend = service.backend_handle();
        drop(service);

        let outcome = backend.download(&release);
        if let DownloadOutcome::Failed(message) = &outcome {
            let _ = logger::port::log_error(
                "updater".into(),
                "Failed to download the update".into(),
                Some(json!(message)),
            );
        }
        let next = shared.lock_updater()?.finish_download(outcome);
        publish_update_state(&app, &next);
        Ok(next)
    })
    .await;
    traced("download-update", started, result)
}

#[tauri::command]
pub async fn restart_to_update(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let started = Instant::now();
    let shared = state.inner().clone();
    let result = blocking(move || {
        let service = shared.lock_updater()?;
        if service.get_update_state().status != UpdateStatus::Ready {
            let _ = logger::port::log_warn(
                "updater".into(),
                "Ignoring a restart request while no update is staged".into(),
                None,
            );
            return Ok(());
        }
        let _ = logger::port::log_info(
            "updater".into(),
            "Restarting to apply the downloaded update".into(),
            None,
        );
        service.restart_to_update();
        Ok(())
    })
    .await;
    traced("restart-to-update", started, result)
}

/// `exe_path` is the running executable, as `process.execPath` is in shortcut.ts.
fn shortcut_platform(app: &AppHandle) -> Result<SystemPlatform, String> {
    let exe_path = std::env::current_exe().map_err(|error| error.to_string())?;
    let desktop_dir = app.path().desktop_dir().map_err(|error| error.to_string())?;
    Ok(SystemPlatform::new(exe_path, desktop_dir, !cfg!(debug_assertions)))
}

#[tauri::command]
pub async fn should_prompt_desktop_shortcut(app: AppHandle) -> Result<bool, String> {
    let started = Instant::now();
    let result = blocking(move || {
        let platform = shortcut_platform(&app)?;
        Ok(shortcut::should_prompt_for_desktop_shortcut(&platform))
    })
    .await;
    traced("should-prompt-desktop-shortcut", started, result)
}

/// Creates the Desktop shortcut. Blocks while COM writes the link, so it runs on the blocking pool.
#[tauri::command]
pub async fn create_desktop_shortcut(app: AppHandle) -> Result<bool, String> {
    let started = Instant::now();
    let result = blocking(move || {
        let platform = shortcut_platform(&app)?;
        let Ok(created) = shortcut::create_desktop_shortcut(&platform, &LoggerShortcutLog);
        let _ = logger::port::log_info(
            "shortcut".into(),
            if created {
                "Desktop shortcut created from the Desktop shortcut toast".into()
            } else {
                "Desktop shortcut creation failed from the Desktop shortcut toast".into()
            },
            None,
        );
        Ok(created)
    })
    .await;
    traced("create-desktop-shortcut", started, result)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::path::Path;

    fn read(relative: &str) -> String {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
        std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
    }

    /// Channel names passed to `handle('…', …)` in `src/main/ipc-handlers.ts`.
    fn ipc_channels() -> BTreeSet<String> {
        let source = read("../src/main/ipc-handlers.ts");
        source
            .split("handle('")
            .skip(1)
            .filter_map(|rest| rest.split('\'').next())
            .map(str::to_string)
            .collect()
    }

    /// Command names listed in `generate_handler![…]` in `src/main.rs`.
    fn registered_commands() -> BTreeSet<String> {
        let source = read("src/main.rs");
        let start = source
            .find("generate_handler![")
            .expect("src/main.rs must register commands with generate_handler!")
            + "generate_handler![".len();
        let end = start
            + source[start..]
                .find(']')
                .expect("generate_handler! list is not closed");
        source[start..end]
            .split(',')
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(|name| name.rsplit("::").next().unwrap_or(name).to_string())
            .collect()
    }

    #[test]
    fn every_ipc_channel_has_a_registered_command() {
        let channels = ipc_channels();
        assert!(!channels.is_empty(), "no channels found in ipc-handlers.ts");

        let registered = registered_commands();
        let missing: Vec<String> = channels
            .iter()
            .map(|channel| channel.replace('-', "_"))
            .filter(|command| !registered.contains(command))
            .collect();
        assert!(missing.is_empty(), "channels without a registered command: {missing:?}");
    }

    #[test]
    fn external_urls_must_be_canonical_github_repositories() {
        use super::validate_external_repository_url;
        use serde_json::json;

        assert!(validate_external_repository_url(json!("https://github.com/jm-parent/CreditsTracker")).is_ok());
        for rejected in [
            "http://github.com/jm-parent/CreditsTracker",
            "https://github.com/jm-parent",
            "https://github.com/jm-parent/CreditsTracker/issues",
            "https://github.com/jm-parent/..",
            "https://github.com/a%20b/c",
            "https://github.com/a/b?x=1",
            "https://user@github.com/a/b",
            "https://github.example.com/a/b",
        ] {
            assert!(
                validate_external_repository_url(json!(rejected)).is_err(),
                "{rejected} should be rejected"
            );
        }
        assert!(validate_external_repository_url(json!(42)).is_err());
    }
}
