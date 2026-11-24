//! The Rust port of `reference/src/db.ts`: read-only usage queries over the Copilot CLI session store.
//!
//! Each query runs the same SQL as the TypeScript original, so SQLite does the grouping, date and
//! number work. The Rust side only builds the WHERE clause, maps rows and sorts where the original
//! uses `localeCompare` (see `locale_compare`).

use std::cmp::Ordering;
use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};

use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags, ToSql};
use shared::{
    AgentTraceSource, BreakdownPoint, ConversationSummary, ExportDailyPreviewRow,
    ExportModelPreviewRow, ExportPreview, ExportReport, ExportSessionRow, ExportSummaryRow,
    FilterOptions, HourlyDetailParams, HourlyPoint, MonthlyActivityParams, ProjectDetailResult,
    RawTableName, RawTablePage, TimeSeriesPoint, UsageFilters, UsageResult, UsageTotals,
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

/// The WHERE clause of `buildWhereClause`. The original tests each filter for truthiness, so an
/// empty string counts as no filter.
struct Clause {
    sql: String,
    params: Vec<(&'static str, String)>,
}

fn where_clause(filters: &UsageFilters) -> Clause {
    let mut conditions = Vec::new();
    let mut params = Vec::new();
    if let Some(project) = filters.project.as_deref().filter(|p| !p.is_empty()) {
        conditions.push("COALESCE(s.repository, s.cwd) = @project");
        params.push(("@project", project.to_string()));
    }
    // Literal, case-insensitive substring match; SQLite's lower() folds ASCII only, as in the original.
    if let Some(search) = filters
        .project_search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        conditions.push("instr(lower(COALESCE(s.repository, s.cwd)), lower(@projectSearch)) > 0");
        params.push(("@projectSearch", search.to_string()));
    }
    if let Some(model) = filters.model.as_deref().filter(|m| !m.is_empty()) {
        conditions.push("e.model = @model");
        params.push(("@model", model.to_string()));
    }
    if let Some(from) = filters.from.as_deref().filter(|f| !f.is_empty()) {
        conditions.push("date(e.created_at) >= @from");
        params.push(("@from", from.to_string()));
    }
    if let Some(to) = filters.to.as_deref().filter(|t| !t.is_empty()) {
        conditions.push("date(e.created_at) <= @to");
        params.push(("@to", to.to_string()));
    }
    let sql = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };
    Clause { sql, params }
}

impl Clause {
    /// The `FROM ... JOIN ... WHERE ...` tail every usage query shares.
    #[allow(clippy::wrong_self_convention)] // `from_tail` names the SQL FROM tail, not a constructor.
    fn from_tail(&self) -> String {
        format!(
            "FROM assistant_usage_events e JOIN sessions s ON s.id = e.session_id {}",
            self.sql
        )
    }

    fn bindings(&self) -> Vec<(&str, &dyn ToSql)> {
        self.params
            .iter()
            .map(|(name, value)| (*name, value as &dyn ToSql))
            .collect()
    }

    /// Adds one more condition to the clause, as `${whereSql} AND ...` does in the original.
    fn and(mut self, condition: &str, name: &'static str, value: String) -> Self {
        self.sql = if self.sql.is_empty() {
            format!("WHERE {condition}")
        } else {
            format!("{} AND {condition}", self.sql)
        };
        self.params.push((name, value));
        self
    }
}

/// Port of the TypeScript `localeCompare` used to order models, hours and dates. ICU's root
/// collation for printable ASCII (0x20 to 0x7E), with punctuation non-ignorable, lowercase before
/// uppercase and letters compared case-insensitively first. The order was read from Node's `Intl`
/// and checked pairwise against it.
/// ponytail: non-ASCII strings and control characters fall back to UTF-16 code-unit order.
/// Model names are ASCII in practice.
fn locale_compare(left: &str, right: &str) -> Ordering {
    const PUNCTUATION_AND_DIGITS: &str = " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$0123456789";
    fn weights(text: &str) -> Option<Vec<(u32, u8)>> {
        text.chars()
            .map(|c| {
                if c.is_ascii_alphabetic() {
                    let primary = PUNCTUATION_AND_DIGITS.len() as u32
                        + (c.to_ascii_lowercase() as u32 - 'a' as u32);
                    Some((primary, u8::from(c.is_ascii_uppercase())))
                } else if c.is_ascii() {
                    PUNCTUATION_AND_DIGITS
                        .find(c)
                        .map(|index| (index as u32, 0))
                } else {
                    None
                }
            })
            .collect()
    }
    match (weights(left), weights(right)) {
        (Some(l), Some(r)) => l
            .iter()
            .map(|(primary, _)| primary)
            .cmp(r.iter().map(|(primary, _)| primary))
            .then_with(|| {
                l.iter()
                    .map(|(_, tertiary)| tertiary)
                    .cmp(r.iter().map(|(_, tertiary)| tertiary))
            }),
        _ => left.encode_utf16().cmp(right.encode_utf16()),
    }
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
    let clause = where_clause(filters);
    let from = clause.from_tail();
    let binding = clause.bindings();

    let totals = query_totals(db, &from, &binding)?;

    let by_project_per_date = {
        let mut stmt = db.prepare(&format!(
            "SELECT date(e.created_at), COALESCE(s.repository, s.cwd) AS project,
                    COALESCE(SUM(e.total_nano_aiu), 0) / 1e9
             {from}
             GROUP BY date(e.created_at), project
             ORDER BY date(e.created_at)"
        ))?;
        let rows = stmt.query_map(binding.as_slice(), |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, f64>(2)?,
            ))
        })?;
        let mut per_date: HashMap<Option<String>, HashMap<String, f64>> = HashMap::new();
        for row in rows {
            let (date, project, credits) = row?;
            // The original skips a null or empty project (`if (!row.project)`).
            if let Some(project) = project.filter(|p| !p.is_empty()) {
                per_date.entry(date).or_default().insert(project, credits);
            }
        }
        per_date
    };

    let time_series = query_time_series(db, &from, &binding)?
        .into_iter()
        .map(|point| TimeSeriesPoint {
            by_project: Some(
                by_project_per_date
                    .get(&point.date)
                    .cloned()
                    .unwrap_or_default(),
            ),
            ..point
        })
        .collect();

    let by_project = query_breakdown(
        db,
        &format!(
            "SELECT COALESCE(s.repository, s.cwd) AS key, COALESCE(SUM(e.total_nano_aiu), 0) / 1e9
             {from}
             GROUP BY key
             ORDER BY key"
        ),
        &binding,
    )?;

    let by_model = query_breakdown(
        db,
        &format!(
            "SELECT e.model AS key, COALESCE(SUM(e.total_nano_aiu), 0) / 1e9
             {from}
             GROUP BY e.model
             ORDER BY e.model"
        ),
        &binding,
    )?;

    Ok(UsageResult {
        totals,
        time_series,
        by_project,
        by_model,
    })
}

/// `SELECT` totals over one filtered `FROM` tail, shared by the usage and project queries.
fn query_totals(
    db: &Connection,
    from: &str,
    binding: &[(&str, &dyn ToSql)],
) -> Result<UsageTotals> {
    let totals = db.query_row(
        &format!(
            "SELECT
               COALESCE(SUM(e.total_nano_aiu), 0) / 1e9 AS aiuCredits,
               COALESCE(SUM(e.input_tokens + e.output_tokens), 0) AS tokens,
               COUNT(*) AS requests
             {from}"
        ),
        binding,
        |row| {
            Ok(UsageTotals {
                aiu_credits: row.get(0)?,
                tokens: row.get(1)?,
                requests: row.get(2)?,
            })
        },
    )?;
    Ok(totals)
}

/// `SELECT date, credits ... GROUP BY date ORDER BY date`, shared by the usage, project and monthly
/// queries. `by_project` is left unset for the caller to fill.
fn query_time_series(
    db: &Connection,
    from: &str,
    binding: &[(&str, &dyn ToSql)],
) -> Result<Vec<TimeSeriesPoint>> {
    let mut stmt = db.prepare(&format!(
        "SELECT date(e.created_at), COALESCE(SUM(e.total_nano_aiu), 0) / 1e9
         {from}
         GROUP BY date(e.created_at)
         ORDER BY date(e.created_at)"
    ))?;
    let points = stmt
        .query_map(binding, |row| {
            Ok(TimeSeriesPoint {
                date: row.get(0)?,
                aiu_credits: row.get(1)?,
                by_project: None,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(points)
}

/// A `key, credits` breakdown query.
fn query_breakdown(
    db: &Connection,
    sql: &str,
    binding: &[(&str, &dyn ToSql)],
) -> Result<Vec<BreakdownPoint>> {
    let mut stmt = db.prepare(sql)?;
    let points = stmt
        .query_map(binding, |row| {
            Ok(BreakdownPoint {
                key: row.get(0)?,
                aiu_credits: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(points)
}

/// `getHourlyDetail`.
pub fn get_hourly_detail(db: &Connection, params: &HourlyDetailParams) -> Result<Vec<HourlyPoint>> {
    let filters = UsageFilters {
        project: params.project.clone(),
        project_search: params.project_search.clone(),
        model: params.model.clone(),
        from: params.from.clone(),
        to: params.to.clone(),
    };
    let clause =
        where_clause(&filters).and("date(e.created_at) = @date", "@date", params.date.clone());
    let from = clause.from_tail();
    let mut stmt = db.prepare(&format!(
        "SELECT strftime('%H:00', e.created_at, 'localtime') AS hour,
                COALESCE(s.repository, s.cwd) AS project,
                COALESCE(SUM(e.total_nano_aiu), 0) / 1e9 AS aiuCredits
         {from}
         GROUP BY hour, project
         ORDER BY hour"
    ))?;
    let rows = stmt
        .query_map(clause.bindings().as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, f64>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut by_hour: HashMap<String, HourlyPoint> = HashMap::new();
    for (hour, project, credits) in rows {
        let entry = by_hour.entry(hour.clone()).or_insert_with(|| HourlyPoint {
            hour,
            aiu_credits: 0.0,
            by_project: HashMap::new(),
        });
        entry.aiu_credits += credits;
        if let Some(project) = project.filter(|p| !p.is_empty()) {
            *entry.by_project.entry(project).or_insert(0.0) += credits;
        }
    }
    let mut points: Vec<HourlyPoint> = by_hour.into_values().collect();
    points.sort_by(|a, b| locale_compare(&a.hour, &b.hour));
    Ok(points)
}

/// `getMonthlyActivity`.
pub fn get_monthly_activity(
    db: &Connection,
    params: &MonthlyActivityParams,
) -> Result<Vec<TimeSeriesPoint>> {
    let filters = UsageFilters {
        project: params.project.clone(),
        project_search: params.project_search.clone(),
        model: params.model.clone(),
        from: None,
        to: None,
    };
    let month = format!("{}-{:02}", params.year, params.month);
    let clause =
        where_clause(&filters).and("strftime('%Y-%m', e.created_at) = @month", "@month", month);
    query_time_series(db, &clause.from_tail(), &clause.bindings())
}

/// `getProjectDetail`. The original takes `filters` with a required `project`; here `project` is
/// that field and replaces any `filters.project`.
pub fn get_project_detail(
    db: &Connection,
    project: &str,
    filters: &UsageFilters,
) -> Result<ProjectDetailResult> {
    let filters = UsageFilters {
        project: Some(project.to_string()),
        ..filters.clone()
    };
    let clause = where_clause(&filters);
    let from = clause.from_tail();
    let binding = clause.bindings();

    let totals = query_totals(db, &from, &binding)?;
    let time_series = query_time_series(db, &from, &binding)?;

    let mut stmt = db.prepare(&format!(
        "SELECT
           CASE WHEN s.id LIKE 'vscode:%' THEN 'vscode' ELSE 'copilot-cli' END AS source,
           s.id AS sessionId,
           s.created_at AS createdAt,
           s.summary AS summary,
           GROUP_CONCAT(DISTINCT e.model) AS models,
           COALESCE(SUM(e.total_nano_aiu), 0) / 1e9 AS aiuCredits,
           SUM(e.input_tokens + e.output_tokens) AS tokens,
           COUNT(*) AS requests
         {from}
         GROUP BY s.id
         ORDER BY s.created_at DESC"
    ))?;
    let conversations = stmt
        .query_map(binding.as_slice(), |row| {
            let source: String = row.get(0)?;
            Ok(ConversationSummary {
                source: if source == "vscode" {
                    AgentTraceSource::Vscode
                } else {
                    AgentTraceSource::CopilotCli
                },
                session_id: row.get(1)?,
                created_at: row.get(2)?,
                summary: row.get(3)?,
                models: row.get(4)?,
                aiu_credits: row.get(5)?,
                tokens: row.get(6)?,
                requests: row.get(7)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(ProjectDetailResult {
        project: project.to_string(),
        totals,
        time_series,
        conversations,
    })
}

/// `toSharePercent`: a share of zero total is 0, never NaN or infinity.
fn to_share_percent(value: f64, total: f64) -> f64 {
    if total == 0.0 {
        return 0.0;
    }
    let percent = value / total * 100.0;
    if percent.is_finite() { percent } else { 0.0 }
}

/// Orders by UTF-16 code units, as JavaScript's default `sort()` does.
fn code_unit_compare(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

/// The text a date sorts by. A NULL date sorts as "null", because `localeCompare` converts a `null`
/// argument to that string.
fn date_sort_key(date: &Option<String>) -> &str {
    date.as_deref().unwrap_or("null")
}

/// A `getExportReport` row grouped by date, project and model.
struct GroupedUsage {
    date: Option<String>,
    project: String,
    model: String,
    aiu_credits: f64,
    input_tokens: f64,
    output_tokens: f64,
    tokens: f64,
    requests: f64,
}

/// `getExportReport`.
pub fn get_export_report(db: &Connection, filters: &UsageFilters) -> Result<ExportReport> {
    if let (Some(from), Some(to)) = (
        filters.from.as_deref().filter(|f| !f.is_empty()),
        filters.to.as_deref().filter(|t| !t.is_empty()),
    ) && from > to
    {
        return Err(DatabaseError::InvalidDateRange);
    }

    let clause = where_clause(filters);
    let from = clause.from_tail();
    let binding = clause.bindings();

    let grouped = db
        .prepare(&format!(
            "SELECT
               date(e.created_at) AS date,
               COALESCE(s.repository, s.cwd, 'Unassigned') AS project,
               e.model AS model,
               COALESCE(SUM(e.total_nano_aiu), 0) / 1e9 AS aiuCredits,
               COALESCE(SUM(COALESCE(e.input_tokens, 0)), 0) AS inputTokens,
               COALESCE(SUM(COALESCE(e.output_tokens, 0)), 0) AS outputTokens,
               COALESCE(SUM(COALESCE(e.input_tokens, 0) + COALESCE(e.output_tokens, 0)), 0) AS tokens,
               COUNT(*) AS requests
             {from}
             GROUP BY date(e.created_at), COALESCE(s.repository, s.cwd, 'Unassigned'), e.model
             ORDER BY date(e.created_at), project, e.model"
        ))?
        .query_map(binding.as_slice(), |row| {
            Ok(GroupedUsage {
                date: row.get(0)?,
                project: row.get(1)?,
                model: row.get(2)?,
                aiu_credits: row.get(3)?,
                input_tokens: row.get(4)?,
                output_tokens: row.get(5)?,
                tokens: row.get(6)?,
                requests: row.get(7)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut day_totals: HashMap<Option<&str>, f64> = HashMap::new();
    let mut model_totals: HashMap<&str, f64> = HashMap::new();
    let mut project_totals: HashMap<&str, f64> = HashMap::new();
    let mut daily: HashMap<Option<&str>, (f64, f64, f64)> = HashMap::new();
    let (mut period_aiu, mut period_tokens, mut period_requests) = (0.0, 0.0, 0.0);
    for row in &grouped {
        period_aiu += row.aiu_credits;
        period_tokens += row.tokens;
        period_requests += row.requests;
        *day_totals.entry(row.date.as_deref()).or_insert(0.0) += row.aiu_credits;
        *model_totals.entry(&row.model).or_insert(0.0) += row.aiu_credits;
        *project_totals.entry(&row.project).or_insert(0.0) += row.aiu_credits;
        let day = daily.entry(row.date.as_deref()).or_insert((0.0, 0.0, 0.0));
        day.0 += row.aiu_credits;
        day.1 += row.tokens;
        day.2 += row.requests;
    }

    let summary_rows = grouped
        .iter()
        .map(|row| {
            let model_total = model_totals[row.model.as_str()];
            let project_total = project_totals[row.project.as_str()];
            ExportSummaryRow {
                date: row.date.clone(),
                project: row.project.clone(),
                model: row.model.clone(),
                aiu_credits: row.aiu_credits,
                input_tokens: row.input_tokens,
                output_tokens: row.output_tokens,
                tokens: row.tokens,
                requests: row.requests,
                day_total_aiu_credits: day_totals[&row.date.as_deref()],
                model_total_aiu_credits: model_total,
                model_share_percent: to_share_percent(model_total, period_aiu),
                project_total_aiu_credits: project_total,
                project_share_percent: to_share_percent(project_total, period_aiu),
            }
        })
        .collect();

    let mut by_model: Vec<ExportModelPreviewRow> = model_totals
        .iter()
        .map(|(model, aiu)| ExportModelPreviewRow {
            model: model.to_string(),
            aiu_credits: *aiu,
            share_percent: to_share_percent(*aiu, period_aiu),
        })
        .collect();
    by_model.sort_by(|a, b| locale_compare(&a.model, &b.model));

    let mut daily_rows: Vec<ExportDailyPreviewRow> = daily
        .iter()
        .map(|(date, (aiu, tokens, requests))| ExportDailyPreviewRow {
            date: (*date).map(str::to_string),
            aiu_credits: *aiu,
            tokens: *tokens,
            requests: *requests,
        })
        .collect();
    daily_rows.sort_by(|a, b| locale_compare(date_sort_key(&a.date), date_sort_key(&b.date)));

    let session_rows = query_session_rows(db, &from, &binding)?;

    Ok(ExportReport {
        preview: ExportPreview {
            totals: UsageTotals {
                aiu_credits: period_aiu,
                tokens: period_tokens,
                requests: period_requests,
            },
            session_count: session_rows.len() as f64,
            active_days: daily_rows.len() as f64,
            by_model,
            daily: daily_rows,
        },
        summary_rows,
        session_rows,
    })
}

fn query_session_rows(
    db: &Connection,
    from: &str,
    binding: &[(&str, &dyn ToSql)],
) -> Result<Vec<ExportSessionRow>> {
    let mut stmt = db.prepare(&format!(
        "SELECT
           s.id AS sessionId,
           s.created_at AS createdAt,
           MIN(date(e.created_at)) AS date,
           COALESCE(s.repository, s.cwd, 'Unassigned') AS project,
           COALESCE(s.summary, '') AS summary,
           GROUP_CONCAT(e.model) AS models,
           COALESCE(SUM(e.total_nano_aiu), 0) / 1e9 AS aiuCredits,
           COALESCE(SUM(COALESCE(e.input_tokens, 0)), 0) AS inputTokens,
           COALESCE(SUM(COALESCE(e.output_tokens, 0)), 0) AS outputTokens,
           COALESCE(SUM(COALESCE(e.input_tokens, 0) + COALESCE(e.output_tokens, 0)), 0) AS tokens,
           COUNT(*) AS requests
         {from}
         GROUP BY s.id, s.created_at, COALESCE(s.repository, s.cwd, 'Unassigned'), COALESCE(s.summary, '')
         ORDER BY s.created_at DESC, s.id"
    ))?;
    let rows = stmt
        .query_map(binding, |row| {
            // `models` is the comma-joined GROUP_CONCAT: split, drop empties, dedupe and sort.
            let models: String = row.get(5)?;
            let mut unique: Vec<&str> = models.split(',').filter(|m| !m.is_empty()).collect();
            unique.sort_by(|a, b| code_unit_compare(a, b));
            unique.dedup();
            Ok(ExportSessionRow {
                session_id: row.get(0)?,
                created_at: row.get(1)?,
                date: row.get(2)?,
                project: row.get(3)?,
                summary: row.get(4)?,
                models: unique.join(", "),
                aiu_credits: row.get(6)?,
                input_tokens: row.get(7)?,
                output_tokens: row.get(8)?,
                tokens: row.get(9)?,
                requests: row.get(10)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// `getRawTablePage`. `page` and `page_size` are clamped as in the original.
pub fn get_raw_table_page(
    db: &Connection,
    table: RawTableName,
    page: f64,
    page_size: f64,
) -> Result<RawTablePage> {
    let name = match table {
        RawTableName::Sessions => "sessions",
        RawTableName::AssistantUsageEvents => "assistant_usage_events",
    };
    let safe_page = page.floor().max(0.0);
    let safe_page_size = page_size.floor().clamp(1.0, 500.0);
    let limit = safe_page_size as i64;
    let offset = (safe_page * safe_page_size) as i64;

    let total: i64 = db.query_row(&format!("SELECT COUNT(*) FROM {name}"), [], |row| {
        row.get(0)
    })?;

    let mut stmt = db.prepare(&format!(
        "SELECT * FROM {name} ORDER BY rowid DESC LIMIT @limit OFFSET @offset"
    ))?;
    let columns: Vec<String> = stmt.column_names().map(str::to_string).collect();
    let params: [(&str, &dyn ToSql); 2] = [("@limit", &limit), ("@offset", &offset)];
    let rows = stmt
        .query_map(params.as_slice(), |row| {
            let mut record = HashMap::with_capacity(columns.len());
            for (index, column) in columns.iter().enumerate() {
                record.insert(column.clone(), sql_value_to_json(row.get_ref(index)?));
            }
            Ok(record)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(RawTablePage {
        columns,
        rows,
        total: total as f64,
        page: safe_page,
        page_size: safe_page_size,
    })
}

/// A SQLite value as `better-sqlite3` returns it to JavaScript, and so as JSON. Blobs take the
/// `Buffer` JSON shape.
fn sql_value_to_json(value: ValueRef<'_>) -> serde_json::Value {
    use serde_json::{Value, json};
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(number) => json!(number),
        ValueRef::Real(number) => {
            serde_json::Number::from_f64(number).map_or(Value::Null, Value::Number)
        }
        ValueRef::Text(text) => Value::String(String::from_utf8_lossy(text).into_owned()),
        ValueRef::Blob(bytes) => json!({ "type": "Buffer", "data": bytes }),
    }
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

    fn usage_filters() -> UsageFilters {
        UsageFilters {
            project: None,
            project_search: None,
            model: None,
            from: None,
            to: None,
        }
    }

    #[test]
    fn empty_range_gives_zero_totals_and_no_rows() {
        let dir = TempDir::new().unwrap();
        let conn = open_database(&seeded_store(&dir)).unwrap();
        let filters = UsageFilters {
            from: Some("2000-01-01".into()),
            to: Some("2000-01-02".into()),
            ..usage_filters()
        };

        let usage = get_usage(&conn, &filters).unwrap();

        assert_eq!(usage.totals.requests, 0.0);
        assert!(usage.totals.aiu_credits.is_finite() && usage.totals.tokens.is_finite());
        assert!(usage.time_series.is_empty());
        assert!(usage.by_project.is_empty());
        assert!(usage.by_model.is_empty());
    }

    #[test]
    fn empty_database_gives_empty_usage() {
        let dir = TempDir::new().unwrap();
        let conn = open_database(&empty_store(&dir)).unwrap();

        let usage = get_usage(&conn, &usage_filters()).unwrap();

        assert_eq!(usage.totals.requests, 0.0);
        assert!(usage.time_series.is_empty() && usage.by_project.is_empty());
    }

    #[test]
    fn usage_keeps_non_ascii_project_names_in_every_breakdown() {
        let dir = TempDir::new().unwrap();
        let conn = open_database(&seeded_store(&dir)).unwrap();

        let usage = get_usage(&conn, &usage_filters()).unwrap();

        let cafe = usage
            .by_project
            .iter()
            .find(|point| point.key.as_deref() == Some("Projet café 🚀"))
            .expect("by_project names the non-ASCII project");
        assert_eq!(cafe.aiu_credits, 4.1);
        let day = usage
            .time_series
            .iter()
            .find(|p| p.date.as_deref() == Some("2026-09-10"))
            .unwrap();
        assert_eq!(day.by_project.as_ref().unwrap()["Projet café 🚀"], 4.1);
    }

    #[test]
    fn empty_filter_strings_mean_no_filter() {
        let dir = TempDir::new().unwrap();
        let conn = open_database(&seeded_store(&dir)).unwrap();
        let filters = UsageFilters {
            project: Some(String::new()),
            project_search: Some("   ".into()),
            model: Some(String::new()),
            from: Some(String::new()),
            to: Some(String::new()),
        };

        let usage = get_usage(&conn, &filters).unwrap();

        assert_eq!(usage.totals.requests, 2.0);
    }

    #[test]
    fn project_search_is_a_trimmed_case_insensitive_substring() {
        let dir = TempDir::new().unwrap();
        let conn = open_database(&seeded_store(&dir)).unwrap();
        let filters = UsageFilters {
            project_search: Some("  ALPHA ".into()),
            ..usage_filters()
        };

        let usage = get_usage(&conn, &filters).unwrap();

        assert_eq!(usage.totals.requests, 1.0);
        assert_eq!(usage.by_project[0].key.as_deref(), Some("org/alpha"));
    }

    #[test]
    fn locale_compare_matches_node_intl_collation() {
        // Each pair's sign was read from `a.localeCompare(b)` in Node.
        let cases = [
            ("a", "A", Ordering::Less),
            ("A", "b", Ordering::Less),
            ("gpt-5", "GPT-4", Ordering::Greater),
            ("a-b", "a.b", Ordering::Less),
            ("ab", "a-b", Ordering::Greater),
            ("a1", "a-1", Ordering::Greater),
            ("x y", "xy", Ordering::Less),
            ("a b", "B", Ordering::Less),
            ("a  b", "a b", Ordering::Less),
            ("10:00", "09:00", Ordering::Greater),
        ];
        for (left, right, expected) in cases {
            assert_eq!(locale_compare(left, right), expected, "{left} vs {right}");
        }
    }

    fn hourly(date: &str) -> HourlyDetailParams {
        HourlyDetailParams {
            project: None,
            project_search: None,
            model: None,
            from: None,
            to: None,
            date: date.into(),
        }
    }

    #[test]
    fn hourly_detail_breaks_one_day_down_by_hour_and_project() {
        let dir = TempDir::new().unwrap();
        let conn = open_database(&seeded_store(&dir)).unwrap();

        let points = get_hourly_detail(&conn, &hourly("2026-09-10")).unwrap();

        assert_eq!(points.len(), 1);
        assert!(points[0].hour.len() == 5 && points[0].hour.ends_with(":00"));
        assert_eq!(points[0].aiu_credits, 4.1);
        assert_eq!(points[0].by_project["Projet café 🚀"], 4.1);
    }

    #[test]
    fn hourly_detail_for_a_day_without_usage_is_empty() {
        let dir = TempDir::new().unwrap();
        let conn = open_database(&seeded_store(&dir)).unwrap();

        assert!(
            get_hourly_detail(&conn, &hourly("2000-01-01"))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn monthly_activity_matches_only_the_padded_month() {
        let dir = TempDir::new().unwrap();
        let conn = open_database(&seeded_store(&dir)).unwrap();
        let params = |month| MonthlyActivityParams {
            year: 2026,
            month,
            project: None,
            project_search: None,
            model: None,
        };

        let september = get_monthly_activity(&conn, &params(9)).unwrap();
        let dates: Vec<&str> = september
            .iter()
            .map(|p| p.date.as_deref().unwrap())
            .collect();
        assert_eq!(dates, vec!["2026-09-01", "2026-09-10"]);
        assert!(get_monthly_activity(&conn, &params(10)).unwrap().is_empty());
    }

    #[test]
    fn project_detail_lists_conversations_newest_first() {
        let dir = TempDir::new().unwrap();
        let conn = open_database(&seeded_store(&dir)).unwrap();

        let detail = get_project_detail(&conn, "Projet café 🚀", &usage_filters()).unwrap();

        assert_eq!(detail.project, "Projet café 🚀");
        assert_eq!(detail.totals.requests, 1.0);
        assert_eq!(detail.totals.aiu_credits, 4.1);
        assert_eq!(detail.conversations.len(), 1);
        assert_eq!(detail.conversations[0].session_id, "s1");
        assert_eq!(detail.conversations[0].summary.as_deref(), Some("café"));
    }

    #[test]
    fn project_detail_for_an_unknown_project_is_empty() {
        let dir = TempDir::new().unwrap();
        let conn = open_database(&seeded_store(&dir)).unwrap();

        let detail = get_project_detail(&conn, "no-such-project", &usage_filters()).unwrap();

        assert_eq!(detail.totals.requests, 0.0);
        assert!(detail.time_series.is_empty() && detail.conversations.is_empty());
    }

    #[test]
    fn export_rejects_an_inverted_range_as_a_value() {
        let dir = TempDir::new().unwrap();
        let conn = open_database(&seeded_store(&dir)).unwrap();
        let filters = UsageFilters {
            from: Some("2026-12-01".into()),
            to: Some("2026-01-01".into()),
            ..usage_filters()
        };

        let err = get_export_report(&conn, &filters).unwrap_err();

        assert!(matches!(err, DatabaseError::InvalidDateRange));
        assert_eq!(err.to_string(), "Invalid export date range");
    }

    #[test]
    fn empty_export_range_has_zero_totals_and_no_rows() {
        let dir = TempDir::new().unwrap();
        let conn = open_database(&seeded_store(&dir)).unwrap();
        let filters = UsageFilters {
            from: Some("2000-01-01".into()),
            to: Some("2000-01-02".into()),
            ..usage_filters()
        };

        let report = get_export_report(&conn, &filters).unwrap();

        assert_eq!(report.preview.totals.requests, 0.0);
        assert_eq!(report.preview.session_count, 0.0);
        assert!(report.summary_rows.is_empty() && report.session_rows.is_empty());
    }

    #[test]
    fn zero_credit_usage_gives_zero_share_not_nan() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("zero.db");
        let setup = Connection::open(&path).unwrap();
        setup.execute_batch(SCHEMA).unwrap();
        setup
            .execute_batch(
                "INSERT INTO sessions VALUES ('z1', 'C:/repos/zero', 'org/zero', NULL, '2026-11-20 09:00:00');
                 INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
                   VALUES ('z1', 'gpt-5.4', 0, 0, 0, '2026-11-20 09:05:00');",
            )
            .unwrap();
        drop(setup);
        let conn = open_database(&path).unwrap();

        let report = get_export_report(&conn, &usage_filters()).unwrap();

        let row = &report.summary_rows[0];
        assert_eq!(row.model_share_percent, 0.0);
        assert_eq!(row.project_share_percent, 0.0);
        assert_eq!(report.preview.by_model[0].share_percent, 0.0);
        assert_eq!(report.session_rows[0].summary, "");
    }

    #[test]
    fn export_by_model_is_locale_ordered_and_session_models_are_deduplicated() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("models.db");
        let setup = Connection::open(&path).unwrap();
        setup.execute_batch(SCHEMA).unwrap();
        setup
            .execute_batch(
                "INSERT INTO sessions VALUES ('m1', 'C:/repos/m', 'org/m', 'models', '2026-09-01 09:00:00');
                 INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
                   VALUES ('m1', 'Zeta-model', 1000000000, 1, 1, '2026-09-01 09:01:00'),
                          ('m1', 'alpha-model', 1000000000, 1, 1, '2026-09-01 09:02:00'),
                          ('m1', 'Zeta-model', 1000000000, 1, 1, '2026-09-01 09:03:00');",
            )
            .unwrap();
        drop(setup);
        let conn = open_database(&path).unwrap();

        let report = get_export_report(&conn, &usage_filters()).unwrap();

        let models: Vec<&str> = report
            .preview
            .by_model
            .iter()
            .map(|m| m.model.as_str())
            .collect();
        assert_eq!(models, vec!["alpha-model", "Zeta-model"]);
        assert_eq!(report.session_rows[0].models, "Zeta-model, alpha-model");
        assert!((report.preview.by_model[1].share_percent - 200.0 / 3.0).abs() < 1e-9);
    }

    #[test]
    fn raw_table_pages_newest_first_and_clamp_the_page_size() {
        let dir = TempDir::new().unwrap();
        let conn = open_database(&seeded_store(&dir)).unwrap();

        let first =
            get_raw_table_page(&conn, RawTableName::AssistantUsageEvents, 0.0, 1.0).unwrap();
        assert_eq!(first.total, 2.0);
        assert_eq!(first.rows.len(), 1);
        assert_eq!(first.rows[0]["id"], 2);
        assert!(first.columns.contains(&"total_nano_aiu".to_string()));

        let second =
            get_raw_table_page(&conn, RawTableName::AssistantUsageEvents, 1.0, 1.0).unwrap();
        assert_eq!(second.rows[0]["id"], 1);

        let clamped = get_raw_table_page(&conn, RawTableName::Sessions, -3.0, 0.0).unwrap();
        assert_eq!((clamped.page, clamped.page_size), (0.0, 1.0));
        let capped = get_raw_table_page(&conn, RawTableName::Sessions, 0.0, 1000.0).unwrap();
        assert_eq!(capped.page_size, 500.0);
    }

    #[test]
    fn raw_table_keeps_non_ascii_text_and_empty_tables_list_their_columns() {
        let dir = TempDir::new().unwrap();
        let conn = open_database(&seeded_store(&dir)).unwrap();
        let page = get_raw_table_page(&conn, RawTableName::Sessions, 0.0, 10.0).unwrap();
        assert!(
            page.rows
                .iter()
                .any(|row| row["repository"] == "Projet café 🚀")
        );

        let empty = open_database(&empty_store(&dir)).unwrap();
        let page = get_raw_table_page(&empty, RawTableName::Sessions, 0.0, 10.0).unwrap();
        assert_eq!(page.total, 0.0);
        assert!(page.rows.is_empty());
        assert_eq!(
            page.columns,
            vec!["id", "cwd", "repository", "summary", "created_at"]
        );
    }
}
