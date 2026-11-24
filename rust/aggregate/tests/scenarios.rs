//! Replays the TypeScript recordings in `tests/fixtures/scenarios.json` against the port, one step at a
//! time. The file is written by `reference/scenarios/merge-scenarios.ts`, which runs `reference/src/merge.ts`
//! over the session stores in `rust/db/tests/fixtures/` and over in-memory CLI schemas.

use std::path::Path;

use aggregate::port::build_merged_database;
use rusqlite::types::Value;
use rusqlite::{Connection, Error as SqliteError};
use serde::Deserialize;
use serde_json::{Value as Json, json};
use shared::UsageFilters;
use vscode_chat::port::VscodeUsageData;

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
const DB_FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../db/tests/fixtures");
const RECORDED_SCENARIOS: usize = 18;

const SESSION_COLUMNS: [&str; 5] = ["id", "cwd", "repository", "summary", "created_at"];
const EVENT_COLUMNS: [&str; 7] = [
    "id",
    "session_id",
    "model",
    "total_nano_aiu",
    "input_tokens",
    "output_tokens",
    "created_at",
];

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum CliSource {
    File { file: String },
    Sql { setup: Vec<String> },
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Outcome {
    Ok {
        ok: Json,
    },
    Threw {
        #[allow(dead_code)]
        threw: String,
        message: String,
    },
}

#[derive(Deserialize)]
struct Scenario {
    name: String,
    cli: CliSource,
    vscode: VscodeUsageData,
    outcome: Outcome,
}

fn no_filters() -> UsageFilters {
    UsageFilters {
        project: None,
        project_search: None,
        model: None,
        from: None,
        to: None,
    }
}

/// A SQLite cell as the recording writes it: `[value, typeof(value)]`.
fn cell(value: Value, storage_class: String) -> Json {
    let value = match value {
        Value::Null => Json::Null,
        Value::Integer(i) => json!(i),
        Value::Real(f) => json!(f),
        Value::Text(t) => json!(t),
        Value::Blob(_) => panic!("the merged tables hold no blobs in these scenarios"),
    };
    json!([value, storage_class])
}

fn dump_schema(conn: &Connection, table: &str) -> rusqlite::Result<Json> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = stmt
        .query_map([], |row| {
            Ok(json!({
                "name": row.get::<_, String>("name")?,
                "type": row.get::<_, String>("type")?,
                "notnull": row.get::<_, i64>("notnull")?,
                "pk": row.get::<_, i64>("pk")?,
            }))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Json::Array(columns))
}

fn dump_table(conn: &Connection, table: &str, columns: &[&str]) -> rusqlite::Result<Json> {
    let select = columns
        .iter()
        .map(|c| format!("{c}, typeof({c})"))
        .collect::<Vec<_>>()
        .join(", ");
    let mut stmt = conn.prepare(&format!("SELECT {select} FROM {table} ORDER BY rowid"))?;
    let rows = stmt
        .query_map([], |row| {
            (0..columns.len())
                .map(|i| Ok(cell(row.get(2 * i)?, row.get(2 * i + 1)?)))
                .collect::<rusqlite::Result<Vec<Json>>>()
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Json::Array(rows.into_iter().map(Json::Array).collect()))
}

/// Builds the merged database for one scenario and returns what the recording captured.
fn run(scenario: &Scenario) -> rusqlite::Result<Json> {
    let cli = match &scenario.cli {
        CliSource::File { file } => {
            db::port::open_database(&Path::new(DB_FIXTURES).join(file)).expect("fixture opens")
        }
        CliSource::Sql { setup } => {
            let conn = Connection::open_in_memory().expect("in-memory database");
            conn.execute_batch(&setup.join("\n")).expect("setup runs");
            conn
        }
    };
    let merged = build_merged_database(&cli, &scenario.vscode)?;
    let export = db::port::get_export_report(&merged, &no_filters()).expect("export report");
    let export = serde_json::to_value(export).expect("serializes");
    Ok(json!({
        "schema": {
            "sessions": dump_schema(&merged, "sessions")?,
            "assistant_usage_events": dump_schema(&merged, "assistant_usage_events")?,
        },
        "tables": {
            "sessions": dump_table(&merged, "sessions", &SESSION_COLUMNS)?,
            "assistant_usage_events": dump_table(&merged, "assistant_usage_events", &EVENT_COLUMNS)?,
        },
        "preview": export["preview"],
    }))
}

/// Where `expected` and `actual` differ, if anywhere. Numbers match exactly when `tolerance` is 0, and
/// otherwise within `tolerance` times the larger magnitude (absolute below 1), as rust-anything does.
fn mismatch(path: &str, expected: &Json, actual: &Json, tolerance: f64) -> Option<String> {
    match (expected, actual) {
        (Json::Number(_), Json::Number(_)) => {
            let (e, a) = (expected.as_f64()?, actual.as_f64()?);
            let close = e == a || (e - a).abs() <= tolerance * e.abs().max(a.abs()).max(1.0);
            (!close).then(|| format!("{path}: expected {e}, got {a}"))
        }
        (Json::Array(e), Json::Array(a)) => {
            if e.len() != a.len() {
                return Some(format!("{path}: length {} vs {}", e.len(), a.len()));
            }
            e.iter()
                .zip(a)
                .enumerate()
                .find_map(|(i, (e, a))| mismatch(&format!("{path}[{i}]"), e, a, tolerance))
        }
        (Json::Object(e), Json::Object(a)) => {
            if e.len() != a.len() {
                return Some(format!("{path}: keys differ"));
            }
            e.iter().find_map(|(key, e)| match a.get(key) {
                Some(a) => mismatch(&format!("{path}.{key}"), e, a, tolerance),
                None => Some(format!("{path}.{key}: missing")),
            })
        }
        _ if expected == actual => None,
        _ => Some(format!("{path}: expected {expected}, got {actual}")),
    }
}

/// `getExportReport` shares of the models must add up to 100 whenever the period has any credits.
fn shares_total_100(preview: &Json) -> Option<String> {
    let models = preview["byModel"]
        .as_array()
        .expect("preview.byModel must be an array");
    if preview["totals"]["aiuCredits"].as_f64() == Some(0.0) {
        return None;
    }
    let total: f64 = models
        .iter()
        .map(|model| {
            model["sharePercent"]
                .as_f64()
                .expect("each preview.byModel entry must have a numeric sharePercent")
        })
        .sum();
    ((total - 100.0).abs() > 1e-9).then(|| format!("model shares sum to {total}, not 100"))
}

/// The message SQLite gives, as `better-sqlite3` reports it. rusqlite reports prepare-time errors with the
/// statement and offset attached; the TypeScript message is the SQLite message alone.
fn sqlite_message(error: &SqliteError) -> String {
    match error {
        SqliteError::SqlInputError { msg, .. } => msg.clone(),
        SqliteError::SqliteFailure(_, Some(message)) => message.clone(),
        other => other.to_string(),
    }
}

fn check(scenario: &Scenario) -> Option<String> {
    let actual = run(scenario);
    match (&scenario.outcome, actual) {
        (Outcome::Ok { ok }, Ok(actual)) => {
            mismatch("schema", &ok["schema"], &actual["schema"], 0.0)
                .or_else(|| mismatch("tables", &ok["tables"], &actual["tables"], 0.0))
                .or_else(|| mismatch("preview", &ok["preview"], &actual["preview"], 1e-9))
                .or_else(|| shares_total_100(&actual["preview"]))
        }
        (Outcome::Ok { .. }, Err(error)) => Some(format!("expected a merge, got {error}")),
        (Outcome::Threw { message, .. }, Err(error)) => {
            let got = sqlite_message(&error);
            (got != *message).then(|| format!("expected threw {message:?}, got {got:?}"))
        }
        (Outcome::Threw { message, .. }, Ok(_)) => Some(format!("expected a throw: {message}")),
    }
}

#[test]
fn replays_every_recorded_scenario() {
    let text = std::fs::read_to_string(Path::new(FIXTURES).join("scenarios.json"))
        .expect("scenarios.json is committed");
    let scenarios: Vec<Scenario> = serde_json::from_str(&text).expect("scenarios.json parses");
    assert_eq!(
        scenarios.len(),
        RECORDED_SCENARIOS,
        "a recorded scenario went missing"
    );

    let failures: Vec<String> = scenarios
        .iter()
        .filter_map(|scenario| check(scenario).map(|diff| format!("{}: {diff}", scenario.name)))
        .collect();
    assert!(
        failures.is_empty(),
        "{} scenario(s) differ from the TypeScript recording:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
