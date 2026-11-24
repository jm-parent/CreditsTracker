//! The Rust port of `reference/src/db.ts`: read-only usage queries over the Copilot CLI session store.
//!
//! Each query runs the same SQL as the TypeScript original, so SQLite does the grouping, date and
//! number work. The Rust side only builds the WHERE clause, maps rows and sorts where the original
//! uses `localeCompare` (see `locale_compare`).

use std::cmp::Ordering;
use std::fmt;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags, ToSql};
use shared::{
    BreakdownPoint, ConversationSummary, ExportDailyPreviewRow, ExportModelPreviewRow,
    ExportPreview, ExportReport, ExportSessionRow, ExportSummaryRow, FilterOptions,
    HourlyDetailParams, HourlyPoint, MonthlyActivityParams, ProjectDetailResult, RawTableName,
    RawTablePage, TimeSeriesPoint, UsageFilters, UsageResult, UsageTotals,
};

#[derive(Debug)]
pub enum DatabaseError {
    /// `DatabaseNotFoundError` in the original: the session store does not exist at this path.
    NotFound(PathBuf),
    Sqlite(rusqlite::Error),
    InvalidDateRange,
}

impl fmt::Display for DatabaseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(path) => write!(
                f,
                "Copilot CLI session database not found at {}",
                path.display()
            ),
            Self::Sqlite(error) => write!(f, "{error}"),
            Self::InvalidDateRange => write!(f, "Invalid export date range"),
        }
    }
}

impl std::error::Error for DatabaseError {}

impl From<rusqlite::Error> for DatabaseError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

pub type Result<T> = std::result::Result<T, DatabaseError>;

/// `resolveDefaultDbPath`: `~/.copilot/session-store.db`.
pub fn resolve_default_db_path() -> PathBuf {
    home_dir().join(".copilot").join("session-store.db")
}

fn home_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

/// `openDatabase`: opens an existing store read-only. A missing store is a value, not a panic, and
/// is logged under scope `db`.
pub fn open_database(path: &Path) -> Result<Connection> {
    if !path.exists() {
        let error = DatabaseError::NotFound(path.to_path_buf());
        let _ = logger::port::log_error(
            "db".into(),
            error.to_string(),
            Some(serde_json::json!({ "dbPath": path.display().to_string() })),
        );
        return Err(error);
    }
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    Ok(Connection::open_with_flags(path, flags)?)
}

/// `getFilterOptions`.
pub fn get_filter_options(db: &Connection) -> Result<FilterOptions> {
    let projects = db
        .prepare(
            "SELECT DISTINCT COALESCE(s.repository, s.cwd) AS project
             FROM sessions s
             JOIN assistant_usage_events e ON e.session_id = s.id
             WHERE COALESCE(s.repository, s.cwd) IS NOT NULL
             ORDER BY project",
        )?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let models = db
        .prepare("SELECT DISTINCT model FROM assistant_usage_events ORDER BY model")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let (min_date, max_date) = db.query_row(
        "SELECT MIN(date(created_at)), MAX(date(created_at))
         FROM assistant_usage_events",
        [],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        },
    )?;

    Ok(FilterOptions {
        projects,
        models,
        min_date,
        max_date,
    })
}

/// `getUsage`.
pub fn get_usage(db: &Connection, filters: &UsageFilters) -> Result<UsageResult> {
    unimplemented!("port `getUsage` from reference/src/db.ts")
}

/// `getHourlyDetail`.
pub fn get_hourly_detail(db: &Connection, params: &HourlyDetailParams) -> Result<Vec<HourlyPoint>> {
    unimplemented!("port `getHourlyDetail` from reference/src/db.ts")
}

/// `getMonthlyActivity`.
pub fn get_monthly_activity(
    db: &Connection,
    params: &MonthlyActivityParams,
) -> Result<Vec<TimeSeriesPoint>> {
    unimplemented!("port `getMonthlyActivity` from reference/src/db.ts")
}

/// `getProjectDetail`. The original takes `filters` with a required `project`; here `project` is
/// that field and replaces any `filters.project`.
pub fn get_project_detail(
    db: &Connection,
    project: &str,
    filters: &UsageFilters,
) -> Result<ProjectDetailResult> {
    unimplemented!("port `getProjectDetail` from reference/src/db.ts")
}

/// `getExportReport`.
pub fn get_export_report(db: &Connection, filters: &UsageFilters) -> Result<ExportReport> {
    unimplemented!("port `getExportReport` from reference/src/db.ts")
}

/// `getRawTablePage`. `page` and `page_size` are clamped as in the original.
pub fn get_raw_table_page(
    db: &Connection,
    table: RawTableName,
    page: f64,
    page_size: f64,
) -> Result<RawTablePage> {
    unimplemented!("port `getRawTablePage` from reference/src/db.ts")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const SCHEMA: &str = "
        CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, summary TEXT, created_at TEXT);
        CREATE TABLE assistant_usage_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, model TEXT NOT NULL,
            total_nano_aiu INTEGER, input_tokens INTEGER, output_tokens INTEGER, created_at TEXT
        );";

    /// A writable temp store, seeded with one non-ASCII project and one ASCII project.
    fn seeded_store(dir: &TempDir) -> PathBuf {
        let path = dir.path().join("session-store.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch(
            "INSERT INTO sessions VALUES ('s1', '/home/dev/projet-cafe', 'Projet café 🚀', 'café', '2026-09-10 08:00:00');
             INSERT INTO sessions VALUES ('s2', 'C:/repos/alpha', 'org/alpha', 'alpha', '2026-09-01 09:00:00');
             INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
               VALUES ('s1', 'claude-sonnet-5', 4100000000, 200, 50, '2026-09-10 08:05:00'),
                      ('s2', 'gpt-5.4', 900000000, 40, 8, '2026-09-01 09:05:00');",
        )
        .unwrap();
        path
    }

    fn empty_store(dir: &TempDir) -> PathBuf {
        let path = dir.path().join("empty.db");
        Connection::open(&path)
            .unwrap()
            .execute_batch(SCHEMA)
            .unwrap();
        path
    }

    #[test]
    fn missing_database_returns_not_found_and_is_logged() {
        let dir = TempDir::new().unwrap();
        let missing = dir.path().join("does-not-exist-task11.db");

        let err = open_database(&missing).unwrap_err();

        assert!(matches!(err, DatabaseError::NotFound(ref path) if *path == missing));
        let logged = logger::port::get_log_entries().unwrap();
        let needle = missing.display().to_string();
        assert!(
            logged.iter().any(|entry| entry["scope"] == "db"
                && entry["message"]
                    .as_str()
                    .is_some_and(|m| m.contains(&needle))),
            "no `db` log entry names {needle}"
        );
    }

    #[test]
    fn opened_database_rejects_writes() {
        let dir = TempDir::new().unwrap();
        let conn = open_database(&seeded_store(&dir)).unwrap();

        let write = conn.execute("DELETE FROM sessions", []);

        assert!(
            write.is_err(),
            "a write through the read-only handle must fail"
        );
    }

    #[test]
    fn non_ascii_project_names_survive_filter_options() {
        let dir = TempDir::new().unwrap();
        let conn = open_database(&seeded_store(&dir)).unwrap();

        let options = get_filter_options(&conn).unwrap();

        assert_eq!(options.projects, vec!["Projet café 🚀", "org/alpha"]);
        assert_eq!(options.models, vec!["claude-sonnet-5", "gpt-5.4"]);
        assert_eq!(options.min_date.as_deref(), Some("2026-09-01"));
        assert_eq!(options.max_date.as_deref(), Some("2026-09-10"));
    }

    #[test]
    fn empty_database_gives_empty_filter_options() {
        let dir = TempDir::new().unwrap();
        let conn = open_database(&empty_store(&dir)).unwrap();

        let options = get_filter_options(&conn).unwrap();

        assert!(options.projects.is_empty());
        assert!(options.models.is_empty());
        assert_eq!(options.min_date, None);
        assert_eq!(options.max_date, None);
    }
}
