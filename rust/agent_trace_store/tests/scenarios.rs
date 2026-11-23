//! Replays `reference/scenarios/agent-trace-store-scenarios.ts` through the Rust store. The fixture is
//! the TypeScript output: after every step, the step's result and the SQLite file's contents (schema,
//! metadata and span rows, including each stored `span_json`) must match it.

mod common;

use std::path::{Path, PathBuf};

use agent_trace_store::port::{
    AgentTraceStore, AgentTraceStoreError, default_db_path, open_agent_trace_store,
};
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OpenFlags, params_from_iter};
use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};
use shared::{AgentTraceSelection, AgentTraceSpan};

const FIXTURE: &str = include_str!("fixtures/scenarios.json");
/// Stands for the Copilot CLI usage database path in the fixture, which differs between machines.
const DEFAULT_DB_TOKEN: &str = "<default>";

struct Replay {
    folder: PathBuf,
    store: Option<AgentTraceStore>,
    db_path: Option<PathBuf>,
}

impl Replay {
    fn perform(&mut self, step: &Value) -> Value {
        match self.execute(step) {
            Ok(ok) => json!({ "ok": ok }),
            Err(error) => {
                json!({ "error": error.to_string().replace(&default_db_path().display().to_string(), DEFAULT_DB_TOKEN) })
            }
        }
    }

    fn execute(&mut self, step: &Value) -> Result<Value, AgentTraceStoreError> {
        match step["call"].as_str().expect("call") {
            "open" => {
                let target = match step["dbPath"].as_str().expect("dbPath") {
                    DEFAULT_DB_TOKEN => default_db_path(),
                    relative => self.folder.join(relative),
                };
                self.store = Some(open_agent_trace_store(&target)?);
                self.db_path = Some(target);
                Ok(Value::Null)
            }
            "reopen" => {
                let path = self.db_path.clone().expect("open first");
                self.store = None;
                self.store = Some(open_agent_trace_store(&path)?);
                Ok(Value::Null)
            }
            "insertSpans" => {
                let spans: Vec<AgentTraceSpan> = decode(&step["spans"]);
                self.store()?.insert_spans(&spans)?;
                Ok(Value::Null)
            }
            "getSession" => {
                let selection: AgentTraceSelection = decode(&step["selection"]);
                Ok(serde_json::to_value(self.store()?.get_session(&selection)?).expect("json"))
            }
            "getCollectionEnabled" => Ok(json!(self.store()?.get_collection_enabled()?)),
            "setCollectionEnabled" => {
                let enabled = step["enabled"].as_bool().expect("enabled");
                self.store()?.set_collection_enabled(enabled)?;
                Ok(Value::Null)
            }
            "pruneExpired" => {
                let now_ms = step["nowMs"].as_i64().expect("nowMs");
                self.store()?.prune_expired(now_ms)?;
                Ok(Value::Null)
            }
            "clear" => {
                self.store()?.clear()?;
                Ok(Value::Null)
            }
            "close" => {
                self.store()?.close();
                Ok(Value::Null)
            }
            "exec" => {
                let path = self.db_path.clone().expect("open first");
                let params: Vec<SqlValue> = step["params"]
                    .as_array()
                    .expect("params")
                    .iter()
                    .map(sql_value)
                    .collect();
                Connection::open(path)?
                    .execute(step["sql"].as_str().expect("sql"), params_from_iter(params))?;
                Ok(Value::Null)
            }
            other => panic!("unknown call {other}"),
        }
    }

    fn store(&mut self) -> Result<&mut AgentTraceStore, AgentTraceStoreError> {
        self.store.as_mut().ok_or(AgentTraceStoreError::Closed)
    }
}

fn decode<T: DeserializeOwned>(value: &Value) -> T {
    serde_json::from_value(value.clone()).expect("fixture value decodes")
}

fn sql_value(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::String(text) => SqlValue::Text(text.clone()),
        Value::Number(number) => number
            .as_i64()
            .map(SqlValue::Integer)
            .unwrap_or_else(|| SqlValue::Real(number.as_f64().expect("number"))),
        other => panic!("unsupported SQL parameter {other}"),
    }
}

/// Every row as an object keyed by column name, like better-sqlite3's `.all()`.
fn rows(conn: &Connection, sql: &str) -> Vec<Value> {
    let mut statement = conn.prepare(sql).expect("prepare snapshot query");
    let names: Vec<String> = statement.column_names().map(str::to_owned).collect();
    statement
        .query_map([], |row| {
            let mut object = Map::new();
            for (index, name) in names.iter().enumerate() {
                let value = match row.get::<_, SqlValue>(index)? {
                    SqlValue::Null => Value::Null,
                    SqlValue::Text(text) => Value::String(text),
                    SqlValue::Integer(number) => json!(number),
                    other => panic!("unexpected column value {other:?}"),
                };
                object.insert(name.clone(), value);
            }
            Ok(Value::Object(object))
        })
        .expect("run snapshot query")
        .map(|row| row.expect("snapshot row"))
        .collect()
}

/// The database as the TypeScript side recorded it. `None` before the store has created a file.
fn snapshot(db_path: Option<&Path>) -> Value {
    let Some(path) = db_path.filter(|path| path.exists()) else {
        return Value::Null;
    };
    let conn =
        Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).expect("read database");
    let mut schema = rows(
        &conn,
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name",
    );
    for entry in &mut schema {
        let sql = entry["sql"]
            .as_str()
            .expect("sql")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        entry["sql"] = json!(sql);
    }
    json!({
        "schema": schema,
        "metadata": rows(&conn, "SELECT key, value FROM agent_trace_metadata ORDER BY key"),
        "spans": rows(
            &conn,
            "SELECT source, session_id, trace_id, span_id, parent_span_id, started_at, span_json FROM agent_trace_spans ORDER BY source, trace_id, span_id",
        ),
    })
}

/// JSON numbers compare by value: the fixture writes `1000` where Rust serializes `1000.0`.
fn canon(value: Value) -> Value {
    match value {
        Value::Number(number) => json!(number.as_f64()),
        Value::Array(items) => Value::Array(items.into_iter().map(canon).collect()),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| (key, canon(value)))
                .collect(),
        ),
        other => other,
    }
}

#[test]
fn replays_every_typescript_scenario_step_for_step() {
    let scenarios: Value = serde_json::from_str(FIXTURE).expect("fixture is JSON");
    for scenario in scenarios.as_array().expect("scenario list") {
        let name = scenario["name"].as_str().expect("name");
        let mut replay = Replay {
            folder: common::scratch(name),
            store: None,
            db_path: None,
        };
        for (index, step) in scenario["steps"]
            .as_array()
            .expect("steps")
            .iter()
            .enumerate()
        {
            let context = format!("{name} step {index} ({})", step["call"]);
            let result = replay.perform(step);
            assert_eq!(
                canon(result),
                canon(step["result"].clone()),
                "{context}: result"
            );
            let db = snapshot(replay.db_path.as_deref());
            assert_eq!(canon(db), canon(step["db"].clone()), "{context}: database");
        }
    }
}
