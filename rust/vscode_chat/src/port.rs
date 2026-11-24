//! The Rust port of `reference/src/vscode-chat-store.ts`.
//!
//! Reads the chat logs that the VS Code Copilot Chat extension writes under `workspaceStorage`.
//! Each `chatSessions/*.jsonl` file is an append-only patch log; replaying it yields one usage
//! event per request that carries a `copilotCredits` cost.

#![forbid(unsafe_code)]

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One completed request. Mirrors `VscodeUsageEvent` in the TypeScript source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VscodeUsageEvent {
    pub session_id: String,
    pub project: Option<String>,
    pub model: String,
    pub aiu_credits: f64,
    pub input_tokens: f64,
    pub output_tokens: f64,
    /// SQLite-parseable UTC timestamp, e.g. `2026-09-07 12:04:17.100`.
    pub created_at: String,
}

/// One chat session that has at least one usage event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VscodeSessionSummary {
    pub session_id: String,
    pub project: Option<String>,
    pub summary: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VscodeUsageData {
    pub events: Vec<VscodeUsageEvent>,
    pub sessions: Vec<VscodeSessionSummary>,
}

/// Port of `resolveDefaultWorkspaceStorageDir` (`reference/src/vscode-chat-store.ts:43`).
pub fn resolve_default_workspace_storage_dir() -> PathBuf {
    let home = std::env::home_dir().unwrap_or_default();
    let code_dir = if cfg!(target_os = "macos") {
        home.join("Library")
            .join("Application Support")
            .join("Code")
    } else if cfg!(windows) {
        home.join("AppData").join("Roaming").join("Code")
    } else {
        home.join(".config").join("Code")
    };
    code_dir.join("User").join("workspaceStorage")
}

/// Port of `parseChatSessionFile` (`reference/src/vscode-chat-store.ts:104`). Returns `Err` where
/// the TypeScript throws, such as a `null` line.
pub fn parse_chat_session_file(
    file_path: &Path,
    project: Option<&str>,
) -> Result<VscodeUsageData, String> {
    let Ok(bytes) = std::fs::read(file_path) else {
        return Ok(VscodeUsageData::default());
    };
    let raw = String::from_utf8_lossy(&bytes);
    let base = file_path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut session_id = base.strip_suffix(".jsonl").unwrap_or(&base).to_string();
    let mut custom_title: Option<String> = None;
    let mut creation_date: Option<f64> = None;
    let mut requests: Vec<Slot> = Vec::new();

    for line in raw.split('\n') {
        let trimmed = js_trim(line);
        if trimmed.is_empty() {
            continue;
        }
        let Ok(obj) = serde_json::from_str::<Value>(&lone_surrogates_to_replacement(trimmed))
        else {
            continue;
        };
        if obj.is_null() {
            return Err(NULL_LINE.into());
        }
        if obj.get("kind").and_then(Value::as_f64) == Some(0.0) {
            if let Some(snapshot) = obj.get("v").and_then(Value::as_object) {
                if let Some(id) = snapshot.get("sessionId").and_then(Value::as_str) {
                    session_id = id.to_string();
                }
                if let Some(ms) = snapshot.get("creationDate").and_then(Value::as_f64) {
                    creation_date = Some(ms);
                }
            }
            continue;
        }
        let Some(k) = obj
            .get("k")
            .and_then(Value::as_array)
            .filter(|k| !k.is_empty())
        else {
            continue;
        };
        let v = obj.get("v").unwrap_or(&Value::Null);

        if k.len() == 1 && k[0].as_str() == Some("customTitle") {
            if let Some(title) = v.as_str() {
                custom_title = Some(title.to_string());
            }
            continue;
        }
        if k[0].as_str() != Some("requests") {
            continue;
        }
        if k.len() == 1 {
            if let Some(items) = v.as_array() {
                requests.extend(items.iter().map(Slot::from_item));
            }
            continue;
        }
        let index = js_number(&k[1]);
        if !(index.is_finite() && index.fract() == 0.0 && index >= 0.0) {
            continue;
        }
        let index = index as usize;
        while requests.len() <= index {
            requests.push(Slot::Object(Fields::default()));
        }
        match (&mut requests[index], k.len()) {
            (Slot::Null, _) => return Err(NULL_ASSIGN.into()),
            (Slot::Primitive, 2) => {}
            (Slot::Primitive, _) => return Err(PRIMITIVE_PROPERTY.into()),
            (Slot::Object(fields), 2) => {
                if let Some(map) = v.as_object() {
                    for (key, value) in map {
                        fields.set(key, value);
                    }
                }
            }
            (Slot::Object(fields), _) => fields.set(&property_name(&k[2]), v),
        }
    }

    let mut events = Vec::new();
    for slot in &requests {
        let fields = match slot {
            Slot::Null => return Err(NULL_LINE.into()),
            Slot::Primitive => continue,
            Slot::Object(fields) => fields,
        };
        let Some(credits) = fields.credits else {
            continue;
        };
        let model = match &fields.model {
            Model::Absent => "unknown".to_string(),
            Model::Text(text) => text.strip_prefix("copilot/").unwrap_or(text).to_string(),
            Model::Other => return Err("TypeError: modelId.replace is not a function".into()),
        };
        let epoch_ms = fields.timestamp.or(creation_date).unwrap_or_else(now_ms);
        events.push(VscodeUsageEvent {
            session_id: session_id.clone(),
            project: project.map(str::to_string),
            model,
            aiu_credits: credits,
            input_tokens: fields.prompt.unwrap_or(0.0),
            output_tokens: fields.completion.unwrap_or(0.0),
            created_at: to_sqlite_timestamp(epoch_ms)?,
        });
    }

    let mut sessions = Vec::new();
    if let Some(first) = events.first() {
        sessions.push(VscodeSessionSummary {
            session_id: session_id.clone(),
            project: project.map(str::to_string),
            summary: custom_title,
            created_at: match creation_date {
                Some(ms) => to_sqlite_timestamp(ms)?,
                None => first.created_at.clone(),
            },
        });
    }
    Ok(VscodeUsageData { events, sessions })
}

/// Port of `loadVscodeUsage` (`reference/src/vscode-chat-store.ts:201`).
pub fn load_vscode_usage(workspace_storage_dir: &Path) -> VscodeUsageData {
    let mut usage = VscodeUsageData::default();
    let Ok(entries) = list_dir(workspace_storage_dir) else {
        return usage;
    };
    for entry in entries {
        if !entry.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let workspace_dir = entry.path();
        let project = resolve_workspace_project(&workspace_dir.join("workspace.json"));
        let Ok(files) = list_dir(&workspace_dir.join("chatSessions")) else {
            continue;
        };
        for file in files {
            if !file.file_name().to_string_lossy().ends_with(".jsonl") {
                continue;
            }
            if let Ok(parsed) = parse_chat_session_file(&file.path(), project.as_deref()) {
                usage.events.extend(parsed.events);
                usage.sessions.extend(parsed.sessions);
            }
        }
    }
    usage
}

/// Directory entries in the order Node's `readdirSync` returns them. libuv sorts them by name on
/// POSIX; on Windows it keeps the NTFS order, which `read_dir` also returns, so only POSIX sorts.
fn list_dir(dir: &Path) -> std::io::Result<Vec<std::fs::DirEntry>> {
    let mut entries: Vec<_> = std::fs::read_dir(dir)?.flatten().collect();
    entries.sort_by_key(|entry| (!cfg!(windows)).then(|| entry.file_name()));
    Ok(entries)
}

/// serde_json rejects unpaired `\uD800`-`\uDFFF` escapes, which `JSON.stringify` writes for a lone
/// surrogate (a prompt truncated mid-emoji). Each becomes `\uFFFD`: a Rust string cannot hold a
/// lone surrogate, the one loss against `JSON.parse`. Valid pairs and escaped backslashes stay.
fn lone_surrogates_to_replacement(text: &str) -> String {
    let (bytes, mut out, mut copied, mut i) = (text.as_bytes(), String::new(), 0, 0);
    while i < bytes.len() {
        match (bytes[i], unit_at(bytes, i), unit_at(bytes, i + 6)) {
            (b'\\', Some(0xD800..=0xDBFF), Some(0xDC00..=0xDFFF)) => i += 12,
            (b'\\', Some(0xD800..=0xDFFF), _) => {
                out += &format!("{}\\uFFFD", &text[copied..i]);
                (copied, i) = (i + 6, i + 6);
            }
            (b'\\', unit, _) => i += if unit.is_some() { 6 } else { 2 },
            _ => i += 1,
        }
    }
    out + &text[copied..]
}

/// The code unit of the `\uXXXX` escape starting at `at`, if there is one.
fn unit_at(bytes: &[u8], at: usize) -> Option<u32> {
    let digits = bytes.get(at..at + 6)?.strip_prefix(br"\u")?;
    digits
        .iter()
        .try_fold(0, |u, &b| Some(u * 16 + (b as char).to_digit(16)?))
}

const NULL_LINE: &str = "TypeError: Cannot read properties of null";
const NULL_ASSIGN: &str = "TypeError: Cannot convert undefined or null to object";
const PRIMITIVE_PROPERTY: &str = "TypeError: Cannot create property on a primitive value";
const MS_PER_DAY: i64 = 86_400_000;

/// One entry of the replayed `requests` array. A JS `null` or primitive can sit there, and patches
/// behave differently on each, so they are kept apart from objects.
enum Slot {
    Null,
    Primitive,
    Object(Fields),
}

impl Slot {
    fn from_item(item: &Value) -> Self {
        match item {
            Value::Null => Slot::Null,
            Value::Object(map) => {
                let mut fields = Fields::default();
                for (key, value) in map {
                    fields.set(key, value);
                }
                Slot::Object(fields)
            }
            Value::Array(_) => Slot::Object(Fields::default()),
            _ => Slot::Primitive,
        }
    }
}

/// The request fields the import reads. A field holding the wrong JSON type reads as absent,
/// as `typeof x === 'number'` does in the TypeScript.
#[derive(Default)]
struct Fields {
    timestamp: Option<f64>,
    model: Model,
    credits: Option<f64>,
    prompt: Option<f64>,
    completion: Option<f64>,
}

#[derive(Default)]
enum Model {
    #[default]
    Absent,
    Text(String),
    Other,
}

impl Fields {
    fn set(&mut self, key: &str, value: &Value) {
        match key {
            "timestamp" => self.timestamp = value.as_f64(),
            "modelId" => {
                self.model = match value {
                    Value::Null => Model::Absent,
                    Value::String(text) => Model::Text(text.clone()),
                    _ => Model::Other,
                }
            }
            "copilotCredits" => self.credits = value.as_f64(),
            "promptTokens" => self.prompt = value.as_f64(),
            "completionTokens" => self.completion = value.as_f64(),
            _ => {}
        }
    }
}

/// The property a patch path names. Only a string, or a one-item array holding one, can match a
/// field this import reads.
fn property_name(key: &Value) -> String {
    match key {
        Value::String(name) => name.clone(),
        Value::Array(items) if items.len() == 1 => property_name(&items[0]),
        _ => String::new(),
    }
}

/// JS `Number(value)` for the path indexes that address a request.
fn js_number(value: &Value) -> f64 {
    match value {
        Value::Null => 0.0,
        Value::Bool(b) => f64::from(u8::from(*b)),
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(text) => {
            let text = js_trim(text);
            if text.is_empty() {
                0.0
            } else if text
                .chars()
                .all(|c| c.is_ascii_digit() || matches!(c, '.' | '+' | '-' | 'e' | 'E'))
            {
                text.parse().unwrap_or(f64::NAN)
            } else {
                f64::NAN
            }
        }
        _ => f64::NAN,
    }
}

/// JS `String.prototype.trim`, which also strips U+FEFF and the Unicode spaces that Rust's
/// `str::trim` keeps.
fn js_trim(text: &str) -> &str {
    text.trim_matches(|c: char| {
        matches!(
            c,
            '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
                ..='\u{200a}'
                    | '\u{2028}'
                    | '\u{2029}'
                    | '\u{202f}'
                    | '\u{205f}'
                    | '\u{3000}'
                    | '\u{feff}'
        )
    })
}

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_millis() as f64)
}

/// Reads the workspace folder, or `.code-workspace` file, that a `workspace.json` points at.
fn resolve_workspace_project(workspace_json: &Path) -> Option<String> {
    let bytes = std::fs::read(workspace_json).ok()?;
    let raw: Value = serde_json::from_str(&String::from_utf8_lossy(&bytes)).ok()?;
    let raw = raw.as_object()?;
    let uri = raw
        .get("folder")
        .filter(|v| !v.is_null())
        .or_else(|| raw.get("workspace"))
        .filter(|v| !v.is_null())?;
    let Value::String(uri) = uri else {
        return None;
    };
    let path = normalize_drive_letter(file_uri_to_path(uri)?);
    // The TypeScript tests `raw.workspace` for truthiness, even when `folder` supplied the path.
    if is_truthy(raw.get("workspace")) {
        let base = Path::new(&path)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let stem = match base.rfind('.') {
            Some(i) if i > 0 => base[..i].to_string(),
            _ => base,
        };
        return Some(stem);
    }
    Some(path)
}

fn is_truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|x| x != 0.0),
        Some(Value::String(text)) => !text.is_empty(),
        Some(_) => true,
    }
}

/// VS Code keeps the drive letter's case from when a workspace was first opened; upper-case it so
/// one folder always groups together.
fn normalize_drive_letter(path: String) -> String {
    let bytes = path.as_bytes();
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\' {
        format!("{}{}", (bytes[0] as char).to_ascii_uppercase(), &path[1..])
    } else {
        path
    }
}

/// `fileURLToPath` for a `file:` URI, with Node's Windows rules: encoded `/` or `\` is rejected, a
/// host becomes a UNC prefix, and the path must start with a drive letter.
fn file_uri_to_path(uri: &str) -> Option<String> {
    let (scheme, rest) = uri.split_once(':')?;
    if !scheme.eq_ignore_ascii_case("file") {
        return None;
    }
    let (host, path) = match rest.strip_prefix("//") {
        Some(after) => {
            let end = after.find(['/', '?', '#']).unwrap_or(after.len());
            (&after[..end], &after[end..])
        }
        None => ("", rest),
    };
    let host = if host.eq_ignore_ascii_case("localhost") {
        ""
    } else {
        host
    };
    let path = path.split(['?', '#']).next().unwrap_or("");
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };

    let lower = path.to_ascii_lowercase();
    if lower.contains("%2f") || (cfg!(windows) && lower.contains("%5c")) {
        return None;
    }
    let decoded = percent_decode(&path)?;
    if cfg!(windows) {
        let win = decoded.replace('/', "\\");
        if !host.is_empty() {
            return Some(format!("\\\\{host}{win}"));
        }
        let bytes = win.as_bytes();
        if bytes.len() < 3 || !bytes[1].is_ascii_alphabetic() || !matches!(bytes[2], b':' | b'|') {
            return None;
        }
        Some(win[1..].to_string())
    } else {
        if !host.is_empty() {
            return None;
        }
        Some(decoded)
    }
}

/// JS `decodeURIComponent`: `None` where it throws a URIError.
fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = bytes.get(i + 1..i + 3)?;
            if !hex.iter().all(u8::is_ascii_hexdigit) {
                return None;
            }
            let digits = std::str::from_utf8(hex).ok()?;
            out.push(u8::from_str_radix(digits, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// JS `new Date(ms).toISOString()` with `T` and `Z` removed, which is the SQLite text the TypeScript
/// stores.
fn to_sqlite_timestamp(epoch_ms: f64) -> Result<String, String> {
    const MAX_MS: f64 = 8.64e15;
    if !epoch_ms.is_finite() || epoch_ms.abs() > MAX_MS {
        return Err("RangeError: Invalid time value".into());
    }
    let ms = epoch_ms.trunc() as i64;
    let (year, month, day) = civil_from_days(ms.div_euclid(MS_PER_DAY));
    let of_day = ms.rem_euclid(MS_PER_DAY);
    let year = if (0..=9999).contains(&year) {
        format!("{year:04}")
    } else {
        format!("{}{:06}", if year < 0 { '-' } else { '+' }, year.abs())
    };
    Ok(format!(
        "{year}-{month:02}-{day:02} {:02}:{:02}:{:02}.{:03}",
        of_day / 3_600_000,
        of_day / 60_000 % 60,
        of_day / 1000 % 60,
        of_day % 1000
    ))
}

/// Days since 1970-01-01 to a proleptic Gregorian (year, month, day).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(relative: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join(relative)
    }

    fn storage() -> PathBuf {
        fixture("fixtures/vscode/workspaceStorage")
    }

    // Workspace folder URIs are Windows drive-letter paths; only Windows resolves them to this path.
    #[cfg(windows)]
    #[test]
    fn cafe_folder_and_emoji_title_survive_a_storage_scan() {
        let usage = load_vscode_usage(&storage());
        let session = usage
            .sessions
            .iter()
            .find(|s| s.session_id == "session-002")
            .expect("session-002 is listed");
        assert_eq!(
            session.project.as_deref(),
            Some("C:\\Users\\dev\\Projet café 🚀")
        );
        assert_eq!(session.summary.as_deref(), Some("🎉 Café Catch-up 🚀"));
    }

    #[test]
    fn patches_apply_and_malformed_lines_are_skipped() {
        let usage = parse_chat_session_file(
            &fixture("fixtures/vscode/workspaceStorage/multi-root-workspace/chatSessions/session-003.jsonl"),
            Some("café-team"),
        )
        .unwrap();
        let models: Vec<&str> = usage.events.iter().map(|e| e.model.as_str()).collect();
        assert_eq!(models, ["gpt-5.4", "claude-sonnet-5", "gemini-4-neon"]);
        assert_eq!(usage.events[1].aiu_credits, 0.5);
        assert_eq!(
            usage.events[1].input_tokens, 0.0,
            "a non-number token count reads as 0"
        );
        assert_eq!(usage.events[2].created_at, "2026-11-12 16:16:20.000");
    }

    #[test]
    fn lone_surrogate_line_keeps_its_credits() {
        let path = storage().join("truncated-prompt-workspace/chatSessions/session-008.jsonl");
        let usage = parse_chat_session_file(&path, None).unwrap();
        let credits: Vec<f64> = usage.events.iter().map(|e| e.aiu_credits).collect();
        assert_eq!(credits, [0.3, 0.4]);
    }

    #[test]
    fn null_line_fails_the_parse_like_the_typescript_throw() {
        let result = parse_chat_session_file(
            &fixture(
                "fixtures/vscode/workspaceStorage/broken-workspace/chatSessions/session-007.jsonl",
            ),
            None,
        );
        assert!(result.is_err());
    }

    #[test]
    fn load_drops_a_file_that_fails_to_parse() {
        let usage = load_vscode_usage(&fixture(
            "fixtures/vscode/workspaceStorage/broken-workspace",
        ));
        assert_eq!(usage, VscodeUsageData::default());
    }

    #[test]
    fn session_without_creation_date_uses_its_first_event_time() {
        let usage = parse_chat_session_file(
            &fixture("fixtures/vscode/workspaceStorage/no-manifest-workspace/chatSessions/session-005.jsonl"),
            None,
        )
        .unwrap();
        assert_eq!(usage.sessions[0].created_at, usage.events[0].created_at);
        assert_eq!(usage.sessions[0].summary, None);
    }

    #[cfg(windows)]
    #[test]
    fn file_uri_decodes_percent_encoding_and_drive_letter() {
        assert_eq!(
            file_uri_to_path("file:///c%3A/repos/caf%C3%A9%20d%C3%A9mo").as_deref(),
            Some("c:\\repos\\café démo")
        );
        assert_eq!(file_uri_to_path("vscode-remote://ssh/home/dev"), None);
    }

    #[test]
    fn timestamps_format_like_sqlite_and_reject_out_of_range() {
        assert_eq!(to_sqlite_timestamp(0.0).unwrap(), "1970-01-01 00:00:00.000");
        assert_eq!(
            to_sqlite_timestamp(-1.0).unwrap(),
            "1969-12-31 23:59:59.999"
        );
        assert!(to_sqlite_timestamp(8.64e15 + 1.0).is_err());
    }
}
