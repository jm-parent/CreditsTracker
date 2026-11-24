//! Replays the TypeScript recordings in `tests/fixtures/scenarios.json` against the port. The file is
//! written by `reference/scenarios/db-scenarios.ts`, which runs `src/main/db.ts` over the synthetic
//! stores committed next to it. Both sides run in the zone `FIXED_ZONE` names there, so the hour
//! buckets (SQLite `localtime`) match on any machine.

use std::ffi::{CString, c_char, c_int};
use std::path::{Path, PathBuf};

use db::port::{self, DatabaseError};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use shared::{HourlyDetailParams, MonthlyActivityParams, RawTableName, UsageFilters};

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
const RECORDED_SCENARIOS: usize = 42;

/// Pins the C runtime's zone to the one the recording used (`FIXED_ZONE`, UTC+1 without DST). SQLite's
/// `localtime` reads the C runtime's zone, and on Windows `std::env::set_var` does not update it, so
/// the runtime's environment is set directly.
#[cfg(windows)]
fn pin_zone() {
    unsafe extern "C" {
        #[link_name = "_putenv"]
        fn putenv(assignment: *const c_char) -> c_int;
        fn _tzset();
    }
    let assignment = CString::new("TZ=CET-1").expect("no NUL byte");
    // SAFETY: `assignment` is NUL-terminated, and the C runtime copies it.
    unsafe {
        putenv(assignment.as_ptr());
        _tzset();
    }
}

#[cfg(not(windows))]
fn pin_zone() {
    unsafe extern "C" {
        fn setenv(name: *const c_char, value: *const c_char, overwrite: c_int) -> c_int;
        fn tzset();
    }
    // SAFETY: both strings are NUL-terminated literals, and this runs before the test reads the zone.
    unsafe {
        setenv(c"TZ".as_ptr(), c"CET-1".as_ptr(), 1);
        tzset();
    }
}

/// Fails if SQLite does not see the pinned zone: 08:05Z is 09:05 at UTC+1.
fn assert_zone_pinned() {
    let conn = Connection::open_in_memory().expect("in-memory database");
    let hour: String = conn
        .query_row(
            "SELECT strftime('%H', '2026-09-10 08:05:00', 'localtime')",
            [],
            |row| row.get(0),
        )
        .expect("localtime query");
    assert_eq!(
        hour, "09",
        "SQLite localtime did not follow the pinned zone"
    );
}

#[derive(Deserialize)]
#[serde(
    tag = "call",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum Scenario {
    OpenDatabase {
        db_path: String,
    },
    GetFilterOptions {
        db_path: String,
    },
    GetUsage {
        db_path: String,
        filters: UsageFilters,
    },
    GetExportReport {
        db_path: String,
        filters: UsageFilters,
    },
    GetHourlyDetail {
        db_path: String,
        params: HourlyDetailParams,
    },
    GetMonthlyActivity {
        db_path: String,
        params: MonthlyActivityParams,
    },
    GetProjectDetail {
        db_path: String,
        project: String,
        filters: UsageFilters,
    },
    GetRawTablePage {
        db_path: String,
        table: RawTableName,
        page: f64,
        page_size: f64,
    },
    ResolveDefaultDbPath,
}

fn expand(db_path: &str) -> PathBuf {
    PathBuf::from(db_path.replace("{fixtures}", FIXTURES))
}

fn threw(name: &str, message: String) -> Value {
    json!({ "threw": name, "message": message })
}

/// The recorded outcome shape: `{ok}` or `{threw, message}`.
fn outcome<T: Serialize>(result: port::Result<T>) -> Value {
    match result {
        Ok(value) => json!({ "ok": serde_json::to_value(value).expect("serializes") }),
        Err(error @ DatabaseError::NotFound(_)) => {
            threw("DatabaseNotFoundError", error.to_string())
        }
        Err(error @ DatabaseError::InvalidDateRange) => threw("Error", error.to_string()),
        Err(error) => panic!("unexpected error: {error}"),
    }
}

/// Opens the store as the app does, then runs one query on it.
fn query<T: Serialize>(db_path: &str, run: impl FnOnce(&Connection) -> port::Result<T>) -> Value {
    match port::open_database(&expand(db_path)) {
        Ok(conn) => outcome(run(&conn)),
        Err(error) => outcome::<()>(Err(error)),
    }
}

fn replay(scenario: Scenario) -> Value {
    match scenario {
        Scenario::OpenDatabase { db_path } => query(&db_path, |conn| {
            Ok(json!({ "readonly": conn.is_readonly("main")? }))
        }),
        Scenario::GetFilterOptions { db_path } => query(&db_path, port::get_filter_options),
        Scenario::GetUsage { db_path, filters } => {
            query(&db_path, |conn| port::get_usage(conn, &filters))
        }
        Scenario::GetExportReport { db_path, filters } => {
            query(&db_path, |conn| port::get_export_report(conn, &filters))
        }
        Scenario::GetHourlyDetail { db_path, params } => {
            query(&db_path, |conn| port::get_hourly_detail(conn, &params))
        }
        Scenario::GetMonthlyActivity { db_path, params } => {
            query(&db_path, |conn| port::get_monthly_activity(conn, &params))
        }
        Scenario::GetProjectDetail {
            db_path,
            project,
            filters,
        } => query(&db_path, |conn| {
            port::get_project_detail(conn, &project, &filters)
        }),
        Scenario::GetRawTablePage {
            db_path,
            table,
            page,
            page_size,
        } => query(&db_path, |conn| {
            port::get_raw_table_page(conn, table, page, page_size)
        }),
        Scenario::ResolveDefaultDbPath => {
            // Compared below the home folder, as the recording was, so the fixture has no user name.
            let home = std::env::var_os("USERPROFILE")
                .or_else(|| std::env::var_os("HOME"))
                .map(PathBuf::from)
                .expect("a home folder is set");
            let relative = port::resolve_default_db_path()
                .strip_prefix(&home)
                .expect("the default path is under the home folder")
                .display()
                .to_string();
            json!({ "ok": relative })
        }
    }
}

/// Where `expected` and `actual` differ, if anywhere. Numbers compare by value, so `1` and `1.0`
/// agree. The recording omits `byProject` on time series that have none, so a `null` there is
/// accepted.
fn mismatch(path: &str, expected: &Value, actual: &Value) -> Option<String> {
    match (expected, actual) {
        (Value::Number(_), Value::Number(_)) if expected.as_f64() == actual.as_f64() => None,
        (Value::Array(e), Value::Array(a)) => {
            if e.len() != a.len() {
                return Some(format!("{path}: length {} vs {}", e.len(), a.len()));
            }
            e.iter()
                .zip(a)
                .enumerate()
                .find_map(|(i, (e, a))| mismatch(&format!("{path}[{i}]"), e, a))
        }
        (Value::Object(e), Value::Object(a)) => {
            let keys = e.keys().chain(a.keys().filter(|k| !e.contains_key(*k)));
            keys.filter_map(|key| {
                let child = format!("{path}.{key}");
                match (e.get(key), a.get(key)) {
                    (Some(e), Some(a)) => mismatch(&child, e, a),
                    (None, Some(Value::Null)) if key == "byProject" => None,
                    (e, a) => Some(format!("{child}: expected {e:?}, got {a:?}")),
                }
            })
            .next()
        }
        _ if expected == actual => None,
        _ => Some(format!("{path}: expected {expected}, got {actual}")),
    }
}

#[test]
fn replays_every_recorded_scenario() {
    pin_zone();
    assert_zone_pinned();
    let text = std::fs::read_to_string(Path::new(FIXTURES).join("scenarios.json"))
        .expect("scenarios.json is committed");
    let recorded: Vec<Value> = serde_json::from_str(&text).expect("scenarios.json parses");
    assert_eq!(
        recorded.len(),
        RECORDED_SCENARIOS,
        "a recorded scenario went missing"
    );

    let mut failures = Vec::new();
    for raw in recorded {
        let name = raw["name"].as_str().expect("named").to_string();
        let expected = raw["outcome"].clone();
        let scenario: Scenario = serde_json::from_value(raw).expect("scenario parses");
        if let Some(diff) = mismatch("", &expected, &replay(scenario)) {
            failures.push(format!("{name}: {diff}"));
        }
    }
    assert!(
        failures.is_empty(),
        "{} scenario(s) differ from the TypeScript recording:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
