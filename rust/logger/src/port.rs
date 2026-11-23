//! The Rust port of `src/logger.ts`.
//!
//! Replace each `unimplemented!` with the port of the source function. Return `Err` where
//! the source throws or raises: the caller gets an error there too. After changing a
//! signature, run `rust-anything refresh` to regenerate the bindings. `rust-anything diff` checks
//! behavior against what the source recorded.

#![forbid(unsafe_code)]

mod pinned;

use std::collections::HashSet;
use std::fs;
use std::io::Write as _;
use std::path::PathBuf;
use std::sync::Mutex;

/// In-memory ring buffer size (`src/logger.ts` `MAX_ENTRIES`).
const MAX_ENTRIES: usize = 2_000;

/// Log file is rotated to `<name>.1` once it grows past this size
/// (`src/logger.ts` `MAX_FILE_BYTES`).
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// Mirrors the module-level `let` state in `src/logger.ts`: a single shared logger instance.
struct LoggerState {
    entries: Vec<serde_json::Value>,
    next_id: i64,
    log_file_path: Option<PathBuf>,
    file_write_failed: bool,
    emitted_once: HashSet<String>,
}

impl LoggerState {
    fn new() -> Self {
        LoggerState {
            entries: Vec::new(),
            next_id: 1,
            log_file_path: None,
            file_write_failed: false,
            emitted_once: HashSet::new(),
        }
    }
}

static STATE: std::sync::LazyLock<Mutex<LoggerState>> =
    std::sync::LazyLock::new(|| Mutex::new(LoggerState::new()));

/// Port of `configureLogFile` (`src/logger.ts:29`).
pub fn configure_log_file(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(file_path);
    let mut state = STATE.lock().unwrap();
    state.log_file_path = Some(path.clone());
    state.file_write_failed = false;
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty());
    if let Some(parent) = parent
        && let Err(error) = fs::create_dir_all(parent)
    {
        state.file_write_failed = true;
        eprintln!("Failed to create log directory: {error}");
    }
    Ok(())
}

/// Port of `getLogFilePath` (`src/logger.ts:40`).
pub fn get_log_file_path() -> Result<Option<String>, String> {
    let state = STATE.lock().unwrap();
    Ok(state
        .log_file_path
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned()))
}

/// Turns a `detail` argument into the readable string `src/logger.ts`'s `log` stores, matching
/// `formatDetail` for every shape JSON can carry (the `Error`-`instanceof` branch stays
/// JS-only: see the crate README).
fn format_detail(detail: Option<serde_json::Value>) -> Option<String> {
    match detail {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(s)) => Some(s),
        Some(other) => Some(other.to_string()),
    }
}

/// Port of `formatLine` (`src/logger.ts:68`): one line of the on-disk/console log format.
fn format_line(
    timestamp: &str,
    level: &str,
    scope: &str,
    message: &str,
    detail: Option<&str>,
    source: &str,
) -> String {
    let suffix = match detail {
        Some(d) if !d.is_empty() => {
            format!(" | {}", d.replace("\r\n", "\n").replace('\n', " "))
        }
        _ => String::new(),
    };
    format!(
        "{timestamp} {} [{source}/{scope}] {message}{suffix}\n",
        level.to_uppercase()
    )
}

/// Appends `.1` to a path exactly as `` `${filePath}.1` `` does, independent of any existing
/// extension.
fn rotated_path(path: &std::path::Path) -> PathBuf {
    let mut os = path.as_os_str().to_os_string();
    os.push(".1");
    PathBuf::from(os)
}

/// Port of `rotateIfNeeded` (`src/logger.ts:71`). All errors (including a missing file) are
/// swallowed, matching the source's empty `catch`.
fn rotate_if_needed(path: &std::path::Path) {
    let _: Result<(), std::io::Error> = (|| {
        let stats = fs::metadata(path)?;
        if stats.len() >= MAX_FILE_BYTES {
            let rotated = rotated_path(path);
            let _ = fs::remove_file(&rotated);
            fs::rename(path, &rotated)?;
        }
        Ok(())
    })();
}

/// Port of `appendToFile` (`src/logger.ts:82`).
fn append_to_file(state: &mut LoggerState, line: &str) {
    if state.file_write_failed {
        return;
    }
    let Some(path) = state.log_file_path.clone() else {
        return;
    };
    rotate_if_needed(&path);
    let result = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut file| file.write_all(line.as_bytes()));
    if let Err(error) = result {
        state.file_write_failed = true;
        eprintln!("Failed to write to log file: {error}");
    }
}

/// `new Date().toISOString()` at the pinned (or real) clock.
fn iso8601_now() -> String {
    let ms = pinned::now_ms().floor() as i64;
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .unwrap_or(chrono::DateTime::<chrono::Utc>::UNIX_EPOCH)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Port of `log` (`src/logger.ts:106`).
pub fn log(
    level: String,
    scope: String,
    message: String,
    detail: Option<serde_json::Value>,
    source: Option<String>,
) -> Result<serde_json::Value, String> {
    let source = source.unwrap_or_else(|| "main".to_string());
    let detail_str = format_detail(detail);
    let timestamp = iso8601_now();

    let mut state = STATE.lock().unwrap();
    let id = state.next_id;
    state.next_id += 1;

    let mut entry = serde_json::Map::new();
    entry.insert("id".into(), serde_json::Value::from(id));
    entry.insert(
        "timestamp".into(),
        serde_json::Value::String(timestamp.clone()),
    );
    entry.insert("level".into(), serde_json::Value::String(level.clone()));
    entry.insert("scope".into(), serde_json::Value::String(scope.clone()));
    entry.insert("message".into(), serde_json::Value::String(message.clone()));
    entry.insert(
        "detail".into(),
        match &detail_str {
            Some(d) => serde_json::Value::String(d.clone()),
            None => crate::js::undefined(),
        },
    );
    entry.insert("source".into(), serde_json::Value::String(source.clone()));
    let entry_value = serde_json::Value::Object(entry);

    let line = format_line(
        &timestamp,
        &level,
        &scope,
        &message,
        detail_str.as_deref(),
        &source,
    );
    match level.as_str() {
        "error" | "warn" => eprintln!("{}", line.trim_end()),
        _ => println!("{}", line.trim_end()),
    }

    state.entries.push(entry_value.clone());
    if state.entries.len() > MAX_ENTRIES {
        let excess = state.entries.len() - MAX_ENTRIES;
        state.entries.drain(0..excess);
    }
    append_to_file(&mut state, &line);

    Ok(entry_value)
}

/// Port of `logDebug` (`src/logger.ts:135`).
pub fn log_debug(
    scope: String,
    message: String,
    detail: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    log("debug".to_string(), scope, message, detail, None)
}

/// Port of `logInfo` (`src/logger.ts:137`).
pub fn log_info(
    scope: String,
    message: String,
    detail: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    log("info".to_string(), scope, message, detail, None)
}

/// Port of `logWarn` (`src/logger.ts:139`).
pub fn log_warn(
    scope: String,
    message: String,
    detail: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    log("warn".to_string(), scope, message, detail, None)
}

/// Port of `logError` (`src/logger.ts:141`).
pub fn log_error(
    scope: String,
    message: String,
    detail: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    log("error".to_string(), scope, message, detail, None)
}

/// Port of `recordRendererLog` (`src/logger.ts:145`).
pub fn record_renderer_log(input: serde_json::Value) -> Result<serde_json::Value, String> {
    let level = match input.get("level").and_then(|v| v.as_str()) {
        Some(l @ ("debug" | "info" | "warn" | "error")) => l.to_string(),
        _ => "info".to_string(),
    };
    let scope = match input.get("scope").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => "renderer".to_string(),
    };
    let message = match input.get("message") {
        Some(serde_json::Value::String(s)) => s.clone(),
        _ => "(empty message)".to_string(),
    };
    let detail = input.get("detail").cloned();
    log(level, scope, message, detail, Some("renderer".to_string()))
}

/// Port of `logOnce` (`src/logger.ts:166`).
pub fn log_once(
    key: String,
    level: String,
    scope: String,
    message: String,
    detail: Option<serde_json::Value>,
) -> Result<Option<serde_json::Value>, String> {
    let already_emitted = {
        let mut state = STATE.lock().unwrap();
        if state.emitted_once.contains(&key) {
            true
        } else {
            if state.emitted_once.len() > 500 {
                state.emitted_once.clear();
            }
            state.emitted_once.insert(key);
            false
        }
    };
    if already_emitted {
        return Ok(None);
    }
    log(level, scope, message, detail, None).map(Some)
}

/// Port of `getLogEntries` (`src/logger.ts:184`).
pub fn get_log_entries() -> Result<Vec<serde_json::Value>, String> {
    let state = STATE.lock().unwrap();
    Ok(state.entries.clone())
}

/// Port of `clearLogs` (`src/logger.ts:189`).
pub fn clear_logs() -> Result<(), String> {
    let mut state = STATE.lock().unwrap();
    state.entries.clear();
    if let Some(path) = state.log_file_path.clone()
        && !state.file_write_failed
        && let Err(error) = fs::write(&path, "")
    {
        eprintln!("Failed to truncate log file: {error}");
    }
    Ok(())
}

/// Port of `resetLoggerForTests` (`src/logger.ts:201`).
pub fn reset_logger_for_tests() -> Result<(), String> {
    let mut state = STATE.lock().unwrap();
    state.entries.clear();
    state.next_id = 1;
    state.log_file_path = None;
    state.file_write_failed = false;
    state.emitted_once.clear();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Serializes tests against the shared module-level state, mirroring the
    /// `beforeEach(resetLoggerForTests)` isolation `src/logger.ts`'s own test suite uses.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn path_arg(path: &std::path::Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn rotates_past_two_mebibytes() {
        let _guard = TEST_LOCK.lock().unwrap();
        reset_logger_for_tests().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("logs").join("app.log");
        configure_log_file(path_arg(&path)).unwrap();
        let big = "x".repeat(1024);
        for _ in 0..(2 * 1024 + 10) {
            log("info".to_string(), "t".to_string(), big.clone(), None, None).unwrap();
        }
        assert!(path.with_extension("log.1").exists());
    }

    #[test]
    fn creates_missing_log_directory_on_first_write() {
        let _guard = TEST_LOCK.lock().unwrap();
        reset_logger_for_tests().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing").join("app.log");
        configure_log_file(path_arg(&path)).unwrap();
        log(
            "info".to_string(),
            "t".to_string(),
            "hello".to_string(),
            None,
            None,
        )
        .unwrap();
        assert!(path.exists());
    }
}
