//! Tauri shell for the Credits Dashboard. Starts the services `src/main.ts` starts (log file, agent
//! trace service, usage database, update checks), then hosts the renderer.

mod commands;
mod state;

use std::sync::{Arc, Mutex};
use std::thread;

use agent_trace_receiver::service::{AgentTraceServiceDependencies, create_agent_trace_service};
use db::port::resolve_default_db_path;
use serde_json::json;
use state::{AppState, DbCache, TauriUpdateBackend, publish_update_state};
use tauri::{App, AppHandle, Manager, RunEvent};
use updater::{UPDATE_CHECK_INTERVAL, UpdateService};
use vscode_chat::port::resolve_default_workspace_storage_dir;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(setup)
        .invoke_handler(tauri::generate_handler![
            commands::get_agent_trace_collection_status,
            commands::set_agent_trace_collection_enabled,
            commands::get_agent_trace_session,
            commands::clear_agent_trace_data,
            commands::get_filter_options,
            commands::get_usage,
            commands::get_project_detail,
            commands::get_raw_table_page,
            commands::get_hourly_detail,
            commands::get_monthly_activity,
            commands::get_export_preview,
            commands::export_html,
            commands::get_app_version,
            commands::get_update_state,
            commands::check_for_update,
            commands::download_update,
            commands::restart_to_update,
            commands::should_prompt_desktop_shortcut,
            commands::create_desktop_shortcut,
            commands::get_logs,
            commands::clear_logs,
            commands::open_log_file,
            commands::open_external_url,
            commands::log_message
        ])
        .build(tauri::generate_context!())
        .expect("error while building the Credits Tracker shell")
        .run(|app, event| {
            if let RunEvent::Exit = event
                && let Some(state) = app.try_state::<Arc<AppState>>()
            {
                state.trace.shutdown();
            }
        });
}

/// Startup sequence from `src/main.ts`. The data folder is `%APPDATA%\credits-tracker`, the same as Electron's `userData`.
fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let version = handle.package_info().version.to_string();
    let user_data = app.path().data_dir()?.join("credits-tracker");

    let log_file = user_data.join("logs").join("app.log");
    if let Err(error) = logger::port::configure_log_file(log_file.display().to_string()) {
        let _ = logger::port::log_warn(
            "logs".into(),
            "Failed to configure the log file, keeping logs in memory only".into(),
            Some(json!(error)),
        );
    }
    let _ = logger::port::log_info(
        "startup".into(),
        format!("Credits Tracker {version} starting"),
        Some(json!({
            "tauri": tauri::VERSION,
            "platform": std::env::consts::OS,
            "packaged": !cfg!(debug_assertions),
        })),
    );

    let trace = create_agent_trace_service(&user_data, AgentTraceServiceDependencies::default());
    trace.initialize();

    let db_path = resolve_default_db_path();
    let workspace_dir = resolve_default_workspace_storage_dir();
    let _ = logger::port::log_info(
        "startup".into(),
        "Registering IPC handlers".into(),
        Some(json!({
            "dbPath": db_path.display().to_string(),
            "workspaceStorageDir": workspace_dir.display().to_string(),
        })),
    );
    let db = DbCache::new(db_path, workspace_dir);
    if let Err(error) = db.with_db(|_| Ok(())) {
        let _ = logger::port::log_error(
            "startup".into(),
            "Failed to initialize database access".into(),
            Some(json!(error)),
        );
    }

    let updater = UpdateService::new(TauriUpdateBackend::new(handle.clone(), version));
    let state = Arc::new(AppState {
        db,
        trace: Arc::new(trace),
        updater: Arc::new(Mutex::new(updater)),
    });
    app.manage(state.clone());
    thread::spawn(move || run_update_checks(state, handle));
    Ok(())
}

/// A check at startup, then one every `UPDATE_CHECK_INTERVAL`. Checks never download; the user accepts first.
fn run_update_checks(state: Arc<AppState>, app: AppHandle) {
    match state.lock_updater() {
        Ok(mut service) => {
            let next = service.start_update_checks();
            publish_update_state(&app, &next);
        }
        Err(error) => {
            let _ = logger::port::log_error("updater".into(), "Update checks could not start".into(), Some(json!(error)));
            return;
        }
    }
    loop {
        thread::sleep(UPDATE_CHECK_INTERVAL);
        let Ok(mut service) = state.lock_updater() else {
            return;
        };
        let next = service.on_interval_elapsed();
        publish_update_state(&app, &next);
    }
}
