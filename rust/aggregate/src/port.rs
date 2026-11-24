//! The Rust port of `buildMergedDatabase` in `reference/src/merge.ts`.
//!
//! The merged database is an in-memory SQLite database with the same two tables as the TypeScript one.
//! better-sqlite3 binds every JS number as a REAL, so numbers read from the CLI store are bound as REALs
//! too; the columns' affinities then store them exactly as the TypeScript merge does.

use std::collections::HashSet;

use rusqlite::types::Value;
use rusqlite::{Connection, Result, Statement, params_from_iter};
use vscode_chat::port::VscodeUsageData;

const MERGED_SCHEMA: &str = "
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT,
      repository TEXT,
      summary TEXT,
      created_at TEXT
    );
    CREATE TABLE assistant_usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      model TEXT NOT NULL,
      total_nano_aiu INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      created_at TEXT
    );";

const MERGED_SESSION_COLUMNS: [&str; 5] = ["id", "cwd", "repository", "summary", "created_at"];
const MERGED_EVENT_COLUMNS: [&str; 6] = [
    "session_id",
    "model",
    "total_nano_aiu",
    "input_tokens",
    "output_tokens",
    "created_at",
];

const INSERT_SESSION: &str =
    "INSERT OR IGNORE INTO sessions (id, cwd, repository, summary, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)";
const INSERT_EVENT: &str = "INSERT INTO assistant_usage_events
     (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)";

/// Port of `buildMergedDatabase` (`reference/src/merge.ts:31`): combines the CLI usage in `cli` with the
/// VS Code usage in `vscode` into a new in-memory database. `cli` is only read.
pub fn build_merged_database(cli: &Connection, vscode: &VscodeUsageData) -> Result<Connection> {
    let merged = Connection::open_in_memory()?;
    merged.execute_batch(MERGED_SCHEMA)?;
    {
        let mut insert_session = merged.prepare(INSERT_SESSION)?;
        let mut insert_event = merged.prepare(INSERT_EVENT)?;

        copy_cli_rows(cli, "sessions", &MERGED_SESSION_COLUMNS, |values| {
            run_insert(&mut insert_session, values)
        })?;
        copy_cli_rows(
            cli,
            "assistant_usage_events",
            &MERGED_EVENT_COLUMNS,
            |values| run_insert(&mut insert_event, values),
        )?;

        for session in &vscode.sessions {
            run_insert(
                &mut insert_session,
                vec![
                    Value::Text(format!("vscode:{}", session.session_id)),
                    nullable(&session.project),
                    nullable(&session.project),
                    nullable(&session.summary),
                    Value::Text(session.created_at.clone()),
                ],
            )?;
        }
        for event in &vscode.events {
            run_insert(
                &mut insert_event,
                vec![
                    Value::Text(format!("vscode:{}", event.session_id)),
                    Value::Text(event.model.clone()),
                    Value::Real(js_round(event.aiu_credits * 1e9)),
                    Value::Real(event.input_tokens),
                    Value::Real(event.output_tokens),
                    Value::Text(event.created_at.clone()),
                ],
            )?;
        }
    }
    Ok(merged)
}

/// Returns the `wanted` columns that `table` has in `cli`, in `wanted` order (`intersectColumns`).
fn intersect_columns<'a>(
    cli: &Connection,
    table: &str,
    wanted: &[&'a str],
) -> Result<Vec<&'a str>> {
    let mut stmt = cli.prepare(&format!("PRAGMA table_info({table})"))?;
    let existing = stmt
        .query_map([], |row| row.get::<_, String>("name"))?
        .collect::<Result<HashSet<String>>>()?;
    Ok(wanted
        .iter()
        .copied()
        .filter(|column| existing.contains(*column))
        .collect())
}

/// Reads `table` from `cli` through the columns that exist there, and passes each row to `insert` with one
/// value per wanted column, NULL where the CLI store has no such column.
fn copy_cli_rows(
    cli: &Connection,
    table: &str,
    wanted: &[&str],
    mut insert: impl FnMut(Vec<Value>) -> Result<()>,
) -> Result<()> {
    let present = intersect_columns(cli, table, wanted)?;
    let mut stmt = cli.prepare(&format!("SELECT {} FROM {table}", present.join(", ")))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let values = wanted
            .iter()
            .map(|column| match present.iter().position(|p| p == column) {
                Some(index) => row.get::<_, Value>(index).map(js_number),
                None => Ok(Value::Null),
            })
            .collect::<Result<Vec<_>>>()?;
        insert(values)?;
    }
    Ok(())
}

fn run_insert(statement: &mut Statement<'_>, values: Vec<Value>) -> Result<()> {
    statement.execute(params_from_iter(values)).map(|_| ())
}

fn nullable(value: &Option<String>) -> Value {
    value.clone().map_or(Value::Null, Value::Text)
}

/// A JS number is always bound as a REAL (see the module docs).
fn js_number(value: Value) -> Value {
    match value {
        Value::Integer(i) => Value::Real(i as f64),
        other => other,
    }
}

/// `Math.round`: halves round toward +Infinity, so -1.5 gives -1 where `f64::round` gives -2.
fn js_round(x: f64) -> f64 {
    let floor = x.floor();
    if x - floor >= 0.5 { floor + 1.0 } else { floor }
}
