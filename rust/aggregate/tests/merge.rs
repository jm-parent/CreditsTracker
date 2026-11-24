//! Behavior the merge keeps on its own, before the TypeScript replay in `scenarios.rs` runs.

use std::path::Path;

use aggregate::port::build_merged_database;
use rusqlite::Connection;
use rusqlite::types::Value;
use vscode_chat::port::VscodeUsageData;

const DB_FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../db/tests/fixtures");

/// `(name, type, notnull, pk)` for each column, in table order.
type ColumnInfo = (String, String, i64, i64);

fn columns(conn: &Connection, table: &str) -> Vec<ColumnInfo> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .unwrap();
    stmt.query_map([], |row| {
        Ok((
            row.get("name")?,
            row.get("type")?,
            row.get("notnull")?,
            row.get("pk")?,
        ))
    })
    .unwrap()
    .map(Result::unwrap)
    .collect()
}

fn rows(conn: &Connection, sql: &str) -> Vec<Vec<Value>> {
    let mut stmt = conn.prepare(sql).unwrap();
    let width = stmt.column_count();
    stmt.query_map([], |row| (0..width).map(|i| row.get(i)).collect())
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

#[test]
fn merged_schema_matches_the_typescript_tables() {
    let cli = db::port::open_database(&Path::new(DB_FIXTURES).join("session-store.db")).unwrap();
    let merged = build_merged_database(&cli, &VscodeUsageData::default()).unwrap();

    let column = |name: &str, ty: &str, notnull: i64, pk: i64| {
        (name.to_string(), ty.to_string(), notnull, pk)
    };
    assert_eq!(
        columns(&merged, "sessions"),
        vec![
            column("id", "TEXT", 0, 1),
            column("cwd", "TEXT", 0, 0),
            column("repository", "TEXT", 0, 0),
            column("summary", "TEXT", 0, 0),
            column("created_at", "TEXT", 0, 0),
        ]
    );
    assert_eq!(
        columns(&merged, "assistant_usage_events"),
        vec![
            column("id", "INTEGER", 0, 1),
            column("session_id", "TEXT", 1, 0),
            column("model", "TEXT", 1, 0),
            column("total_nano_aiu", "INTEGER", 0, 0),
            column("input_tokens", "INTEGER", 0, 0),
            column("output_tokens", "INTEGER", 0, 0),
            column("created_at", "TEXT", 0, 0),
        ]
    );
}

#[test]
fn missing_optional_cli_columns_merge_as_null() {
    let cli = Connection::open_in_memory().unwrap();
    cli.execute_batch(
        "CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, created_at TEXT);
         INSERT INTO sessions VALUES ('m1', 'C:/repos/minimal', '2026-09-08 07:00:00');
         CREATE TABLE assistant_usage_events (
           id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, model TEXT NOT NULL,
           total_nano_aiu INTEGER, input_tokens INTEGER
         );
         INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens)
         VALUES ('m1', 'gpt-5.4', 2500000000, 900);",
    )
    .unwrap();

    let merged = build_merged_database(&cli, &VscodeUsageData::default()).unwrap();

    assert_eq!(
        rows(
            &merged,
            "SELECT cwd, repository IS NULL, summary IS NULL FROM sessions"
        ),
        vec![vec![
            Value::Text("C:/repos/minimal".into()),
            Value::Integer(1),
            Value::Integer(1),
        ]]
    );
    assert_eq!(
        rows(
            &merged,
            "SELECT total_nano_aiu, input_tokens, output_tokens IS NULL, created_at IS NULL
             FROM assistant_usage_events",
        ),
        vec![vec![
            Value::Integer(2_500_000_000),
            Value::Integer(900),
            Value::Integer(1),
            Value::Integer(1),
        ]]
    );
}

#[test]
fn zero_vscode_sessions_return_the_cli_rows_unchanged() {
    let cli = db::port::open_database(&Path::new(DB_FIXTURES).join("session-store.db")).unwrap();
    let merged = build_merged_database(&cli, &VscodeUsageData::default()).unwrap();

    for sql in [
        "SELECT id, cwd, repository, summary, created_at FROM sessions ORDER BY rowid",
        "SELECT id, session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at
         FROM assistant_usage_events ORDER BY rowid",
    ] {
        let from_cli = rows(&cli, sql);
        assert!(!from_cli.is_empty(), "the fixture has rows for {sql}");
        assert_eq!(rows(&merged, sql), from_cli, "{sql}");
    }
}
