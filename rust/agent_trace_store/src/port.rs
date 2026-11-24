//! The Rust port of `reference/src/agent-trace-store.ts`: the SQLite store for local agent traces.
//!
//! The store is not bridged to JS: its only export, `openAgentTraceStore`, returns an object with
//! function members, so `rust-anything bridge` refuses the unit. The port is reached through this
//! module directly, and parity is checked by replaying the TypeScript scenarios.

use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;
use std::ops::RangeInclusive;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use shared::{
    AgentTraceAvailability, AgentTraceCategory, AgentTraceSelection, AgentTraceSession,
    AgentTraceSource, AgentTraceSpan,
};

#[derive(Debug)]
pub enum AgentTraceStoreError {
    Closed,
    ProtectedDatabase(PathBuf),
    Io(std::io::Error),
    Sqlite(rusqlite::Error),
}

impl fmt::Display for AgentTraceStoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Closed => write!(f, "Agent trace store is closed"),
            Self::ProtectedDatabase(path) => write!(
                f,
                "Refusing to open the Copilot CLI usage database for writable agent traces: {}",
                path.display()
            ),
            Self::Io(error) => write!(f, "{error}"),
            Self::Sqlite(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for AgentTraceStoreError {}

impl From<std::io::Error> for AgentTraceStoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<rusqlite::Error> for AgentTraceStoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

pub type Result<T> = std::result::Result<T, AgentTraceStoreError>;

pub struct AgentTraceStore {
    conn: Option<Connection>,
}

const COLLECTION_ENABLED_KEY: &str = "collectionEnabled";
const RETENTION_WINDOW_MS: i64 = 30 * 24 * 60 * 60 * 1000;
const NULLABLE_STRING_KEYS: [&str; 8] = [
    "parentSpanId",
    "toolName",
    "skillName",
    "model",
    "errorType",
    "toolCallId",
    "argumentsJson",
    "resultText",
];
const SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS agent_trace_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_trace_spans (
      source TEXT NOT NULL,
      session_id TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      span_id TEXT NOT NULL,
      parent_span_id TEXT,
      started_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      span_json TEXT NOT NULL,
      PRIMARY KEY (source, trace_id, span_id)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_trace_session
      ON agent_trace_spans (source, session_id, started_at);
";

/// The Copilot CLI usage database, which the agent trace store must never open for writing.
pub fn default_db_path() -> PathBuf {
    let home = if cfg!(windows) {
        std::env::var_os("USERPROFILE")
    } else {
        std::env::var_os("HOME")
    };
    PathBuf::from(home.unwrap_or_default())
        .join(".copilot")
        .join("session-store.db")
}

/// Opens or creates the store at `db_path`, creating missing parent folders. Refuses the Copilot
/// CLI usage database.
pub fn open_agent_trace_store(db_path: &Path) -> Result<AgentTraceStore> {
    let in_memory = db_path == Path::new(":memory:");
    if !in_memory {
        if comparable_path(db_path) == comparable_path(&default_db_path()) {
            return Err(AgentTraceStoreError::ProtectedDatabase(
                db_path.to_path_buf(),
            ));
        }
        if let Some(parent) = db_path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            fs::create_dir_all(parent)?;
        }
    }

    let conn = if in_memory {
        Connection::open_in_memory()?
    } else {
        Connection::open(db_path)?
    };
    conn.execute_batch(SCHEMA)?;
    let mut store = AgentTraceStore { conn: Some(conn) };
    store.prune_expired(now_ms())?;
    Ok(store)
}

impl AgentTraceStore {
    pub fn insert_spans(&mut self, spans: &[AgentTraceSpan]) -> Result<()> {
        if spans.is_empty() {
            self.conn()?;
            return Ok(());
        }

        let received_at = iso_from_ms(now_ms());
        let tx = self.conn_mut()?.transaction()?;
        {
            let mut statement = tx.prepare_cached(
                "INSERT OR IGNORE INTO agent_trace_spans (
                    source, session_id, trace_id, span_id, parent_span_id, started_at, received_at, span_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?;
            for span in spans {
                statement.execute(params![
                    source_name(span.source),
                    span.session_id,
                    span.trace_id,
                    span.span_id,
                    span.parent_span_id,
                    span.started_at,
                    received_at,
                    stored_span_json(span),
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn get_session(&mut self, selection: &AgentTraceSelection) -> Result<AgentTraceSession> {
        self.prune_expired(now_ms())?;

        let source = source_name(selection.source);
        let rows = {
            let mut statement = self.conn()?.prepare(
                "SELECT source, session_id, trace_id, span_id, started_at, span_json
                 FROM agent_trace_spans
                 WHERE source = ?1 AND session_id = ?2
                 ORDER BY started_at ASC, trace_id ASC, span_id ASC",
            )?;
            statement
                .query_map(params![source, selection.session_id], |row| {
                    Ok(StoredRow {
                        source: row.get(0)?,
                        session_id: row.get(1)?,
                        trace_id: row.get(2)?,
                        span_id: row.get(3)?,
                        started_at: row.get(4)?,
                        span_json: row.get(5)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };

        if rows.is_empty() {
            return Ok(AgentTraceSession {
                source: selection.source,
                session_id: selection.session_id.clone(),
                availability: AgentTraceAvailability::NotCollected,
                spans: Vec::new(),
            });
        }

        let mut partial = false;
        let mut spans = Vec::new();
        for row in &rows {
            match parse_stored_span(row) {
                Some(span) => spans.push(span),
                None => partial = true,
            }
        }

        {
            let mut trace_span_ids: HashMap<&str, HashSet<&str>> = HashMap::new();
            for span in &spans {
                trace_span_ids
                    .entry(span.trace_id.as_str())
                    .or_default()
                    .insert(span.span_id.as_str());
            }
            for span in &spans {
                match &span.parent_span_id {
                    None => {
                        if span.category != AgentTraceCategory::Agent {
                            partial = true;
                        }
                    }
                    Some(parent) => {
                        let known = trace_span_ids
                            .get(span.trace_id.as_str())
                            .is_some_and(|ids| ids.contains(parent.as_str()));
                        if !known {
                            partial = true;
                        }
                    }
                }
            }
        }

        if spans.iter().any(is_incomplete_tool_span) {
            partial = true;
        }

        spans.sort_by(compare_spans);
        Ok(AgentTraceSession {
            source: selection.source,
            session_id: selection.session_id.clone(),
            availability: if partial {
                AgentTraceAvailability::Partial
            } else {
                AgentTraceAvailability::Available
            },
            spans,
        })
    }

    pub fn get_collection_enabled(&self) -> Result<bool> {
        let value: Option<String> = self
            .conn()?
            .query_row(
                "SELECT value FROM agent_trace_metadata WHERE key = ?1",
                [COLLECTION_ENABLED_KEY],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value.as_deref() == Some("true"))
    }

    pub fn set_collection_enabled(&mut self, enabled: bool) -> Result<()> {
        self.conn()?.execute(
            "INSERT INTO agent_trace_metadata (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![
                COLLECTION_ENABLED_KEY,
                if enabled { "true" } else { "false" }
            ],
        )?;
        Ok(())
    }

    /// Deletes spans received more than the retention window before `now_ms` (Unix epoch ms).
    pub fn prune_expired(&mut self, now_ms: i64) -> Result<()> {
        let threshold = iso_from_ms(now_ms - RETENTION_WINDOW_MS);
        self.conn()?.execute(
            "DELETE FROM agent_trace_spans WHERE received_at < ?1",
            [threshold],
        )?;
        Ok(())
    }

    pub fn clear(&mut self) -> Result<()> {
        self.conn()?.execute("DELETE FROM agent_trace_spans", [])?;
        Ok(())
    }

    pub fn close(&mut self) {
        self.conn = None;
    }

    fn conn(&self) -> Result<&Connection> {
        self.conn.as_ref().ok_or(AgentTraceStoreError::Closed)
    }

    fn conn_mut(&mut self) -> Result<&mut Connection> {
        self.conn.as_mut().ok_or(AgentTraceStoreError::Closed)
    }
}

struct StoredRow {
    source: String,
    session_id: String,
    trace_id: String,
    span_id: String,
    started_at: String,
    span_json: String,
}

/// Returns the span only when its stored JSON is a valid span whose key fields match its row.
fn parse_stored_span(row: &StoredRow) -> Option<AgentTraceSpan> {
    let value: Value = serde_json::from_str(&row.span_json).ok()?;
    if !is_stored_span(&value) {
        return None;
    }
    let span: AgentTraceSpan = serde_json::from_value(value).ok()?;
    let matches_row = source_name(span.source) == row.source
        && span.session_id == row.session_id
        && span.trace_id == row.trace_id
        && span.span_id == row.span_id
        && span.started_at == row.started_at;
    matches_row.then_some(span)
}

/// The checks `isStoredAgentTraceSpan` makes beyond what the typed decode enforces: serde accepts a
/// missing optional field as `None`, and parses dates loosely.
fn is_stored_span(value: &Value) -> bool {
    NULLABLE_STRING_KEYS
        .iter()
        .all(|key| matches!(value.get(*key), Some(Value::Null | Value::String(_))))
        && ["startedAt", "endedAt"]
            .iter()
            .all(|key| value[*key].as_str().is_some_and(is_iso_date))
}

fn is_incomplete_tool_span(span: &AgentTraceSpan) -> bool {
    matches!(
        span.category,
        AgentTraceCategory::Tool
            | AgentTraceCategory::Shell
            | AgentTraceCategory::Skill
            | AgentTraceCategory::Mcp
            | AgentTraceCategory::Hook
    ) && (span.arguments_json.is_none() || span.result_text.is_none())
}

/// Orders by start, trace and span id with plain code-unit comparison, as the SQL query does. The
/// TypeScript store re-sorts with `localeCompare` (reference/src/agent-trace-store.ts:343-353). The two
/// agree on what the app stores: lowercase hex ids (reference/src/agent-trace-protocol.ts:340, 355) and
/// `toISOString` start times (reference/src/agent-trace-sanitizer.ts:440). Ties are covered by the
/// `hex-id-order-ties` scenario.
/// ponytail: the store accepts any string id. `localeCompare` puts "a" before "B" and "_" before "0",
/// code-unit order does not. The decoder never produces such ids, so that is not reproduced.
fn compare_spans(left: &AgentTraceSpan, right: &AgentTraceSpan) -> std::cmp::Ordering {
    left.started_at
        .cmp(&right.started_at)
        .then_with(|| left.trace_id.cmp(&right.trace_id))
        .then_with(|| left.span_id.cmp(&right.span_id))
}

/// The stored `span_json`, byte for byte what `JSON.stringify(projectStoredSpan(span))` writes.
fn stored_span_json(span: &AgentTraceSpan) -> String {
    let mut value = serde_json::to_value(span).expect("span serializes");
    value["durationMs"] = js_number(span.duration_ms);
    value.to_string()
}

/// JavaScript writes whole numbers without a decimal point, which `serde_json` does not.
fn js_number(number: f64) -> Value {
    if number.fract() == 0.0 && number.abs() < 9e15 {
        Value::from(number as i64)
    } else {
        Value::from(number)
    }
}

fn source_name(source: AgentTraceSource) -> &'static str {
    match source {
        AgentTraceSource::Vscode => "vscode",
        AgentTraceSource::CopilotCli => "copilot-cli",
    }
}

/// Lexically normalized, and lowercased on Windows, so that two spellings of one path compare equal.
fn comparable_path(path: &Path) -> String {
    let absolute = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    let normalized = absolute
        .components()
        .fold(PathBuf::new(), |mut acc, component| {
            match component {
                Component::CurDir => {}
                Component::ParentDir => {
                    acc.pop();
                }
                other => acc.push(other),
            }
            acc
        });
    let text = normalized.to_string_lossy().into_owned();
    if cfg!(windows) {
        text.to_lowercase()
    } else {
        text
    }
}

fn now_ms() -> i64 {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
}

/// `Date.prototype.toISOString` for the years a trace store can hold.
fn iso_from_ms(ms: i64) -> String {
    const DAY_MS: i64 = 86_400_000;
    let (year, month, day) = civil_from_days(ms.div_euclid(DAY_MS));
    let time = ms.rem_euclid(DAY_MS);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        time / 3_600_000,
        time / 60_000 % 60,
        time / 1000 % 60,
        time % 1000,
    )
}

/// Days since 1970-01-01 to a proleptic Gregorian (year, month, day).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Reads the ISO 8601 forms `Date.parse` accepts for stored span times: a date, optionally followed
/// by `T` (or a space), a time and an optional `Z` or `±HH:MM` offset. Field ranges are checked;
/// day-of-month is checked against 31 only, as V8 does.
fn is_iso_date(text: &str) -> bool {
    let mut cursor = Cursor {
        bytes: text.as_bytes(),
        at: 0,
    };
    if !cursor.number(4, 0..=9999) {
        return false;
    }
    if cursor.eat(b'-') {
        if !cursor.number(2, 1..=12) {
            return false;
        }
        if cursor.eat(b'-') && !cursor.number(2, 1..=31) {
            return false;
        }
    }
    if cursor.eat(b'T') || cursor.eat(b' ') {
        if !cursor.number(2, 0..=24) || !cursor.eat(b':') || !cursor.number(2, 0..=59) {
            return false;
        }
        if cursor.eat(b':') {
            if !cursor.number(2, 0..=59) {
                return false;
            }
            if cursor.eat(b'.') && !cursor.fraction() {
                return false;
            }
        }
        let has_offset = !cursor.eat(b'Z') && (cursor.eat(b'+') || cursor.eat(b'-'));
        if has_offset
            && (!cursor.number(2, 0..=23) || !cursor.eat(b':') || !cursor.number(2, 0..=59))
        {
            return false;
        }
    }
    cursor.at == cursor.bytes.len()
}

struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Cursor<'_> {
    fn eat(&mut self, byte: u8) -> bool {
        let matched = self.bytes.get(self.at) == Some(&byte);
        if matched {
            self.at += 1;
        }
        matched
    }

    fn number(&mut self, width: usize, range: RangeInclusive<u32>) -> bool {
        let Some(digits) = self.bytes.get(self.at..self.at + width) else {
            return false;
        };
        if !digits.iter().all(u8::is_ascii_digit) {
            return false;
        }
        let value = digits
            .iter()
            .fold(0, |n, digit| n * 10 + u32::from(digit - b'0'));
        self.at += width;
        range.contains(&value)
    }

    fn fraction(&mut self) -> bool {
        let start = self.at;
        while self.bytes.get(self.at).is_some_and(u8::is_ascii_digit) {
            self.at += 1;
        }
        self.at > start
    }
}

#[cfg(test)]
mod tests {
    use super::iso_from_ms;

    /// Expected values are `new Date(ms).toISOString()` from Node 24.
    #[test]
    fn iso_from_ms_matches_to_iso_string() {
        assert_eq!(iso_from_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_from_ms(-1), "1969-12-31T23:59:59.999Z");
        assert_eq!(iso_from_ms(1_000_000_000_123), "2001-09-09T01:46:40.123Z");
        assert_eq!(iso_from_ms(951_782_400_000), "2000-02-29T00:00:00.000Z");
        assert_eq!(iso_from_ms(4_102_444_800_000), "2100-01-01T00:00:00.000Z");
        assert_eq!(iso_from_ms(1_709_210_096_789), "2024-02-29T12:34:56.789Z");
    }
}
