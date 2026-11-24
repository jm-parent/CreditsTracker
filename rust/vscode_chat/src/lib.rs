//! JS bindings for `reference/src/vscode-chat-store.ts`. The napi entry points are maintained by
//! hand: they decode the JSON text `index.cjs` sends for each argument, call the typed port in
//! `port.rs`, and turn its paths and errors into JS values. `rust-anything refresh` would overwrite
//! this file, because it cannot map `&Path` or `Option<&str>` arguments.

use std::path::{Path, PathBuf};

use napi_derive::napi;

pub mod js;
pub mod port;

fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".into())
}

#[allow(dead_code)]
fn run<T>(f: impl FnOnce() -> Result<T, String>) -> napi::Result<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(result) => result.map_err(napi::Error::from_reason),
        Err(payload) => Err(napi::Error::from_reason(format!(
            "Rust panic: {}",
            panic_message(&*payload)
        ))),
    }
}

fn path_text(path: PathBuf) -> Result<String, String> {
    path.into_os_string()
        .into_string()
        .map_err(|p| format!("TypeError: path {p:?} is not valid Unicode"))
}

/// `resolveDefaultWorkspaceStorageDir`.
#[napi(js_name = "resolveDefaultWorkspaceStorageDir")]
pub fn resolve_default_workspace_storage_dir() -> napi::Result<String> {
    run(move || crate::js::to_json(&path_text(port::resolve_default_workspace_storage_dir())?))
}

/// `parseChatSessionFile`.
#[napi(js_name = "parseChatSessionFile")]
pub fn parse_chat_session_file(file_path: String, project: String) -> napi::Result<String> {
    run(move || {
        let file_path: String = crate::js::from_json(&file_path)?;
        let project: Option<String> = crate::js::from_json(&project)?;
        let out = port::parse_chat_session_file(Path::new(&file_path), project.as_deref())?;
        crate::js::to_json(&out)
    })
}

/// `loadVscodeUsage`.
#[napi(js_name = "loadVscodeUsage")]
pub fn load_vscode_usage(workspace_storage_dir: String) -> napi::Result<String> {
    run(move || {
        let dir: String = crate::js::from_json(&workspace_storage_dir)?;
        crate::js::to_json(&port::load_vscode_usage(Path::new(&dir)))
    })
}
