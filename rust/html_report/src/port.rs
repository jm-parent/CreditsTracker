//! The Rust port of `renderHtmlReport` in `src/main/html-report.ts`.
//!
//! The TypeScript template is reproduced byte for byte, whitespace included. Its `Intl.NumberFormat('fr-FR')`,
//! `toFixed`, `Math.round` and `localeCompare` calls are ported in the helpers below.
//! Parity is checked by replaying the TypeScript output recorded in `tests/fixtures/scenarios.json`.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::f64::consts::PI;
use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};

use icu_collator::options::CollatorOptions;
use icu_collator::{CollatorBorrowed, CollatorPreferences};
use shared::{
    ExportDailyPreviewRow, ExportReport, ExportSessionRow, ExportSummaryRow, HtmlReportOptions,
    UsageFilters,
};

const STYLES: &str = include_str!("styles.css");
const EMPTY_SELECTION_MESSAGE: &str = "No usage for this selection.";
const EMPTY_SECTION_MESSAGE: &str = "No data available";
const CHART_COLORS: [&str; 6] = [
    "#60a5fa", "#34d399", "#f59e0b", "#f472b6", "#a78bfa", "#fb7185",
];
const MS_PER_DAY: i64 = 86_400_000;
const MS_PER_HOUR: i64 = 3_600_000;
const MS_PER_MINUTE: i64 = 60_000;

struct ProjectRow {
    project: String,
    aiu_credits: f64,
    share_percent: f64,
}

struct ModelRow {
    model: String,
    aiu_credits: f64,
    input_tokens: f64,
    output_tokens: f64,
    tokens: f64,
    requests: f64,
    share_percent: f64,
}

/// A render the original throws on. `escapeHtml(null)` raises a TypeError in `src/main/html-report.ts`, so the
/// export fails rather than printing an empty cell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HtmlReportError {
    /// A row's `field` (`date` or `createdAt`) is null. The TS types it as a string, but `db.ts` reads
    /// `created_at` as nullable.
    NullDate { field: &'static str },
}

impl fmt::Display for HtmlReportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NullDate { field } => write!(f, "HTML report row has a null {field}"),
        }
    }
}

impl std::error::Error for HtmlReportError {}

pub type Result<T> = std::result::Result<T, HtmlReportError>;

/// Renders the standalone HTML report (`renderHtmlReport`, `src/main/html-report.ts:28`).
pub fn render_html_report(report: &ExportReport, options: &HtmlReportOptions) -> Result<String> {
    let generated_at = options.generated_at.unwrap_or_else(now_ms);
    // A JS template literal normalises CRLF to LF, whatever line endings the stylesheet file has on disk.
    let styles = STYLES.replace("\r\n", "\n");
    let total_aiu = safe(report.preview.totals.aiu_credits);
    let collator =
        CollatorBorrowed::try_new(CollatorPreferences::default(), CollatorOptions::default())
            .expect("compiled collation data is built in");
    let project_rows = build_project_rows(&report.summary_rows, total_aiu, &collator);
    let model_rows = build_model_rows(&report.summary_rows, total_aiu, &collator);
    let is_empty = report.summary_rows.is_empty() && report.session_rows.is_empty();
    let totals = &report.preview.totals;
    let global_empty = if is_empty {
        format!(r#"<p class="global-empty">{EMPTY_SELECTION_MESSAGE}</p>"#)
    } else {
        String::new()
    };

    Ok(format!(
        r#"<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Export report</title>
    <style>
      {styles}
    </style>
  </head>
  <body>
    <main class="page">
      <header class="hero">
        <div>
          <p class="eyebrow">CreditsTracker</p>
          <h1>Export report</h1>
          <p class="subtitle">Standalone usage dashboard with inline styles and no external resources.</p>
        </div>
        <dl class="metadata">
          <div>
            <dt>Period</dt>
            <dd>{period}</dd>
          </div>
          <div>
            <dt>Project</dt>
            <dd>{project}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{model}</dd>
          </div>
          <div>
            <dt>Generated</dt>
            <dd>{generated}</dd>
          </div>
        </dl>
      </header>

      {global_empty}

      <section class="card-grid" aria-label="Key performance indicators">
        {kpi_credits}
        {kpi_tokens}
        {kpi_requests}
        {kpi_sessions}
        {kpi_days}
      </section>

      <section id="daily-consumption" class="section card">
        <div class="section-heading">
          <h2>Daily consumption</h2>
          <p>AIU credits by day for the current selection.</p>
        </div>
        {daily}
      </section>

      <section id="model-breakdown" class="section card">
        <div class="section-heading">
          <h2>Model breakdown</h2>
          <p>AIU credit share aggregated across all summary rows.</p>
        </div>
        {model_breakdown}
      </section>

      <section id="project-consumption" class="section card">
        <div class="section-heading">
          <h2>Project consumption</h2>
          <p>Projects ranked by AIU credits for the selected export.</p>
        </div>
        {project_consumption}
      </section>

      <section id="token-ratio" class="section card">
        <div class="section-heading">
          <h2>Token ratio</h2>
          <p>Input and output token composition by model.</p>
        </div>
        {token_ratio}
      </section>

      <section id="execution-details" class="section card">
        <div class="section-heading">
          <h2>Execution details</h2>
          <p>Escaped session-level details for the selection.</p>
        </div>
        {execution_details}
      </section>
    </main>
  </body>
</html>"#,
        period = escape(&format_selected_period(&options.filters)),
        project = escape(options.filters.project.as_deref().unwrap_or("All projects")),
        model = escape(options.filters.model.as_deref().unwrap_or("All models")),
        generated = escape(&format_date(generated_at)),
        kpi_credits = kpi_card("AIU credits", &format_credits(totals.aiu_credits)),
        kpi_tokens = kpi_card("Tokens", &format_tokens(totals.tokens)),
        kpi_requests = kpi_card("Requests", &format_tokens(totals.requests)),
        kpi_sessions = kpi_card("Sessions", &format_tokens(report.preview.session_count)),
        kpi_days = kpi_card("Active days", &format_tokens(report.preview.active_days)),
        daily = render_daily_consumption(&report.preview.daily)?,
        model_breakdown = render_model_breakdown(&model_rows),
        project_consumption = render_project_consumption(&project_rows),
        token_ratio = render_token_ratio(&model_rows),
        execution_details = render_execution_details(report)?,
    ))
}

fn build_project_rows(
    summary_rows: &[ExportSummaryRow],
    total_aiu: f64,
    collator: &CollatorBorrowed<'_>,
) -> Vec<ProjectRow> {
    let mut totals: Vec<(&str, f64)> = Vec::new();
    let mut index: HashMap<&str, usize> = HashMap::new();
    for row in summary_rows {
        let i = *index.entry(row.project.as_str()).or_insert_with(|| {
            totals.push((row.project.as_str(), 0.0));
            totals.len() - 1
        });
        totals[i].1 = safe(totals[i].1) + safe(row.aiu_credits);
    }

    let mut rows: Vec<ProjectRow> = totals
        .into_iter()
        .map(|(project, aiu_credits)| {
            let aiu_credits = safe(aiu_credits);
            ProjectRow {
                project: project.to_string(),
                aiu_credits,
                share_percent: if total_aiu > 0.0 {
                    safe(aiu_credits / total_aiu * 100.0)
                } else {
                    0.0
                },
            }
        })
        .collect();
    rows.sort_by(|left, right| {
        compare_rows(
            left.aiu_credits,
            &left.project,
            right.aiu_credits,
            &right.project,
            collator,
        )
    });
    rows
}

fn build_model_rows(
    summary_rows: &[ExportSummaryRow],
    total_aiu: f64,
    collator: &CollatorBorrowed<'_>,
) -> Vec<ModelRow> {
    let mut rows: Vec<ModelRow> = Vec::new();
    let mut index: HashMap<&str, usize> = HashMap::new();
    for row in summary_rows {
        let i = *index.entry(row.model.as_str()).or_insert_with(|| {
            rows.push(ModelRow {
                model: row.model.clone(),
                aiu_credits: 0.0,
                input_tokens: 0.0,
                output_tokens: 0.0,
                tokens: 0.0,
                requests: 0.0,
                share_percent: 0.0,
            });
            rows.len() - 1
        });
        let current = &mut rows[i];
        current.aiu_credits += safe(row.aiu_credits);
        current.input_tokens += safe(row.input_tokens);
        current.output_tokens += safe(row.output_tokens);
        current.tokens += safe(row.tokens);
        current.requests += safe(row.requests);
    }

    for row in &mut rows {
        row.aiu_credits = safe(row.aiu_credits);
        row.input_tokens = safe(row.input_tokens);
        row.output_tokens = safe(row.output_tokens);
        row.tokens = safe(row.tokens);
        row.requests = safe(row.requests);
        row.share_percent = if total_aiu > 0.0 {
            safe(row.aiu_credits / total_aiu * 100.0)
        } else {
            0.0
        };
    }
    rows.sort_by(|left, right| {
        compare_rows(
            left.aiu_credits,
            &left.model,
            right.aiu_credits,
            &right.model,
            collator,
        )
    });
    rows
}

/// `compareRows`: highest credits first, then the label in locale order.
fn compare_rows(
    left_aiu: f64,
    left_label: &str,
    right_aiu: f64,
    right_label: &str,
    collator: &CollatorBorrowed,
) -> Ordering {
    let score = safe(right_aiu) - safe(left_aiu);
    if score != 0.0 {
        return score.partial_cmp(&0.0).unwrap_or(Ordering::Equal);
    }
    collator.compare(left_label, right_label)
}

fn kpi_card(label: &str, value: &str) -> String {
    format!(
        r#"<article class="kpi card">
    <p class="kpi-label">{}</p>
    <p class="kpi-value">{}</p>
  </article>"#,
        escape(label),
        escape(value)
    )
}

fn render_daily_consumption(daily: &[ExportDailyPreviewRow]) -> Result<String> {
    let rows: Vec<(Option<&str>, f64)> = daily
        .iter()
        .map(|row| (row.date.as_deref(), safe(row.aiu_credits)))
        .collect();
    let max_value = rows.iter().fold(0.0_f64, |max, (_, value)| max.max(*value));
    if rows.is_empty() || max_value <= 0.0 {
        return Ok(section_empty_state(EMPTY_SECTION_MESSAGE));
    }
    // The TS escapes each date only once the chart is drawn, so a null date fails only here.
    let rows: Vec<(&str, f64)> = rows
        .into_iter()
        .map(|(date, value)| required(date, "date").map(|date| (date, value)))
        .collect::<Result<_>>()?;

    let (left, top, chart_width, chart_height) = (56.0_f64, 20.0_f64, 620.0_f64, 180.0_f64);
    let bottom = top + chart_height;
    let step = if rows.len() == 1 {
        0.0
    } else {
        chart_width / (rows.len() - 1) as f64
    };
    let points: Vec<(f64, f64, &str, f64)> = rows
        .iter()
        .enumerate()
        .map(|(index, (date, value))| {
            let x = left + step * index as f64;
            let ratio = if max_value > 0.0 {
                value / max_value
            } else {
                0.0
            };
            let y = bottom - chart_height * ratio;
            (safe(x), safe(y), *date, *value)
        })
        .collect();
    let polyline = points
        .iter()
        .map(|(x, y, _, _)| format!("{},{}", fixed2(*x), fixed2(*y)))
        .collect::<Vec<_>>()
        .join(" ");
    let area = format!(
        "{},{} {} {},{}",
        fixed2(points[0].0),
        fixed2(bottom),
        polyline,
        fixed2(points[points.len() - 1].0),
        fixed2(bottom)
    );
    let y_axis: String = [0.0, max_value / 2.0, max_value]
        .into_iter()
        .map(|value| {
            let value = safe(value);
            let y = bottom
                - if max_value > 0.0 {
                    chart_height * (value / max_value)
                } else {
                    0.0
                };
            format!(
                r#"<line x1="{}" y1="{}" x2="{}" y2="{}" class="grid-line"></line>
          <text x="{}" y="{}" text-anchor="end" class="axis-label">{}</text>"#,
                fixed2(left),
                fixed2(y),
                fixed2(left + chart_width),
                fixed2(y),
                fixed2(left - 12.0),
                fixed2(y + 4.0),
                escape(&format_credits(value))
            )
        })
        .collect();
    let circles: String = points
        .iter()
        .map(|(x, y, date, value)| {
            format!(
                r#"<circle cx="{}" cy="{}" r="4" class="point-fill">
            <title>{}</title>
          </circle>"#,
                fixed2(*x),
                fixed2(*y),
                escape(&format!("{date}: {} AIU", format_credits(*value)))
            )
        })
        .collect();
    let labels: String = points
        .iter()
        .map(|(x, _, date, _)| {
            format!(
                r#"<text x="{}" y="{}" text-anchor="middle" class="axis-label">{}</text>"#,
                fixed2(*x),
                fixed2(bottom + 22.0),
                escape(date)
            )
        })
        .collect();

    Ok(format!(
        r#"<div class="chart-block">
    <svg viewBox="0 0 720 260" role="img" aria-labelledby="daily-consumption-title daily-consumption-desc">
      <title id="daily-consumption-title">Daily AIU credits</title>
      <desc id="daily-consumption-desc">Daily AIU credit totals for the selected export period.</desc>
      {y_axis}
      <polygon points="{area}" class="area-fill"></polygon>
      <polyline points="{polyline}" class="line-stroke"></polyline>
      {circles}
      {labels}
    </svg>
  </div>"#
    ))
}

fn render_model_breakdown(model_rows: &[ModelRow]) -> String {
    let total = model_rows
        .iter()
        .fold(0.0_f64, |sum, row| sum + safe(row.aiu_credits));
    if model_rows.is_empty() || total <= 0.0 {
        return section_empty_state(EMPTY_SECTION_MESSAGE);
    }

    let radius = 54.0_f64;
    let circumference = 2.0 * PI * radius;
    let mut consumed = 0.0_f64;
    let rings: String = model_rows
        .iter()
        .enumerate()
        .map(|(index, row)| {
            let length = safe((row.aiu_credits / total) * circumference);
            let dash = 0.0_f64.max(circumference.min(length));
            let offset = -safe(consumed);
            consumed += dash;
            format!(
                r#"<circle
        cx="80"
        cy="80"
        r="{}"
        fill="none"
        stroke="{}"
        stroke-width="22"
        stroke-dasharray="{} {}"
        stroke-dashoffset="{}"
        transform="rotate(-90 80 80)"
      >
        <title>{}</title>
      </circle>"#,
                fixed2(radius),
                CHART_COLORS[index % CHART_COLORS.len()],
                fixed2(dash),
                fixed2(circumference),
                fixed2(offset),
                escape(&format!(
                    "{}: {} AIU ({})",
                    row.model,
                    format_credits(row.aiu_credits),
                    format_percent(row.share_percent)
                ))
            )
        })
        .collect();
    let legend: String = model_rows
        .iter()
        .enumerate()
        .map(|(index, row)| {
            format!(
                r#"<li>
            <span class="legend-swatch" style="background:{}"></span>
            <div>
              <strong>{}</strong>
              <span>{} · {}</span>
            </div>
          </li>"#,
                CHART_COLORS[index % CHART_COLORS.len()],
                escape(&row.model),
                escape(&format_credits(row.aiu_credits)),
                escape(&format_percent(row.share_percent))
            )
        })
        .collect();

    format!(
        r##"<div class="split-layout">
    <svg viewBox="0 0 160 160" role="img" aria-labelledby="model-breakdown-title model-breakdown-desc" class="donut-chart">
      <title id="model-breakdown-title">AIU credit share by model</title>
      <desc id="model-breakdown-desc">Donut chart showing AIU credit share by model.</desc>
      <circle cx="80" cy="80" r="{}" fill="none" stroke="#1f2a44" stroke-width="22"></circle>
      {rings}
      <text x="80" y="74" text-anchor="middle" class="donut-total-label">Total</text>
      <text x="80" y="94" text-anchor="middle" class="donut-total-value">{}</text>
    </svg>
    <ul class="legend">
      {legend}
    </ul>
  </div>"##,
        fixed2(radius),
        escape(&format_credits(total))
    )
}

fn render_project_consumption(project_rows: &[ProjectRow]) -> String {
    if project_rows.is_empty() {
        return section_empty_state(EMPTY_SECTION_MESSAGE);
    }

    let items: String = project_rows
        .iter()
        .map(|row| {
            format!(
                r#"<article class="bar-item">
        <div class="bar-meta">
          <strong>{}</strong>
          <span>{} · {}</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:{}%"></div>
        </div>
      </article>"#,
                escape(&row.project),
                escape(&format_credits(row.aiu_credits)),
                escape(&format_percent(row.share_percent)),
                fixed2(row.share_percent)
            )
        })
        .collect();
    format!(
        r#"<div class="bar-list">
    {items}
  </div>"#
    )
}

fn render_token_ratio(model_rows: &[ModelRow]) -> String {
    if model_rows.is_empty() {
        return section_empty_state(EMPTY_SECTION_MESSAGE);
    }

    let items: String = model_rows
        .iter()
        .map(|row| {
            let total_tokens = safe(row.tokens);
            let input_percent = if total_tokens > 0.0 {
                safe((row.input_tokens / total_tokens) * 100.0)
            } else {
                0.0
            };
            let output_percent = if total_tokens > 0.0 {
                safe((row.output_tokens / total_tokens) * 100.0)
            } else {
                0.0
            };
            format!(
                r#"<article class="token-ratio-item">
          <div class="bar-meta">
            <strong>{}</strong>
            <span>{} tokens · {} requests</span>
          </div>
          <div class="stacked-track" aria-label="{} token ratio">
            <div class="stacked-input" style="width:{}%"></div>
            <div class="stacked-output" style="width:{}%"></div>
          </div>
          <div class="token-ratio-values">
            <span>Input {} ({})</span>
            <span>Output {} ({})</span>
          </div>
        </article>"#,
                escape(&row.model),
                escape(&format_tokens(total_tokens)),
                escape(&format_tokens(row.requests)),
                escape(&row.model),
                fixed2(input_percent),
                fixed2(output_percent),
                escape(&format_tokens(row.input_tokens)),
                escape(&format_percent(input_percent)),
                escape(&format_tokens(row.output_tokens)),
                escape(&format_percent(output_percent))
            )
        })
        .collect();
    format!(
        r#"<div class="token-ratio-list">
    {items}
  </div>"#
    )
}

fn render_execution_details(report: &ExportReport) -> Result<String> {
    if report.session_rows.is_empty() {
        return Ok(format!(
            r#"<p class="empty-state">{EMPTY_SELECTION_MESSAGE}</p>"#
        ));
    }

    let rows: String = report
        .session_rows
        .iter()
        .map(render_session_row)
        .collect::<Result<_>>()?;
    Ok(format!(
        r#"<div class="table-scroll">
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Created</th>
          <th>Project</th>
          <th>Models</th>
          <th>AIU</th>
          <th>Input tokens</th>
          <th>Output tokens</th>
          <th>Tokens</th>
          <th>Requests</th>
          <th>Summary</th>
        </tr>
      </thead>
      <tbody>
        {rows}
      </tbody>
    </table>
  </div>"#
    ))
}

fn render_session_row(row: &ExportSessionRow) -> Result<String> {
    let date = required(row.date.as_deref(), "date")?;
    let created_at = required(row.created_at.as_deref(), "createdAt")?;
    Ok(format!(
        r#"<tr>
              <td>{}</td>
              <td>{}</td>
              <td>{}</td>
              <td>{}</td>
              <td>{}</td>
              <td>{}</td>
              <td>{}</td>
              <td>{}</td>
              <td>{}</td>
              <td class="summary-cell">{}</td>
            </tr>"#,
        escape(date),
        escape(created_at),
        escape(&row.project),
        escape(&row.models),
        escape(&format_credits(row.aiu_credits)),
        escape(&format_tokens(row.input_tokens)),
        escape(&format_tokens(row.output_tokens)),
        escape(&format_tokens(row.tokens)),
        escape(&format_tokens(row.requests)),
        escape(&row.summary)
    ))
}

fn section_empty_state(message: &str) -> String {
    format!(r#"<p class="empty-state">{}</p>"#, escape(message))
}

fn format_selected_period(filters: &UsageFilters) -> String {
    match (non_empty(&filters.from), non_empty(&filters.to)) {
        (Some(from), Some(to)) => format!("{from} → {to}"),
        (Some(from), None) => format!("From {from}"),
        (None, Some(to)) => format!("Until {to}"),
        (None, None) => "All dates".to_string(),
    }
}

/// JS truthiness for an optional string: an empty string counts as absent.
fn non_empty(value: &Option<String>) -> Option<&str> {
    value.as_deref().filter(|s| !s.is_empty())
}

/// `escapeHtml(null)` throws in the original, so a null date fails the render.
fn required<'a>(value: Option<&'a str>, field: &'static str) -> Result<&'a str> {
    value.ok_or(HtmlReportError::NullDate { field })
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// `safeNumber`: non-finite numbers count as zero.
fn safe(value: f64) -> f64 {
    if value.is_finite() { value } else { 0.0 }
}

fn format_credits(value: f64) -> String {
    intl_number(safe(value), 0, 2)
}

fn format_tokens(value: f64) -> String {
    intl_number(js_round(safe(value)), 0, 0)
}

fn format_percent(value: f64) -> String {
    let value = safe(value);
    let min_fraction = if value > 0.0 && value < 10.0 { 1 } else { 0 };
    format!("{}%", intl_number(value, min_fraction, 2))
}

/// `Intl.NumberFormat('fr-FR')` with the given fraction digits. The shortest round-trip decimal is rounded
/// half away from zero, as `Intl` does, and grouped with U+202F; a negative value keeps its sign even when
/// it rounds to zero (`-0`).
fn intl_number(value: f64, min_fraction: usize, max_fraction: usize) -> String {
    let shortest = format!("{}", value.abs());
    let (int_part, frac_part) = shortest.split_once('.').unwrap_or((&shortest, ""));
    let mut int_len = int_part.len();
    let mut digits: Vec<u8> = int_part.bytes().map(|b| b - b'0').collect();
    digits.extend(frac_part.bytes().take(max_fraction).map(|b| b - b'0'));
    let round_digit = frac_part
        .as_bytes()
        .get(max_fraction)
        .map_or(0, |b| b - b'0');
    if round_digit >= 5 && add_one(&mut digits) {
        int_len += 1;
    }

    let mut frac: Vec<u8> = digits.split_off(int_len);
    while frac.len() > min_fraction && frac.last() == Some(&0) {
        frac.pop();
    }
    while frac.len() < min_fraction {
        frac.push(0);
    }

    let mut out = String::new();
    if value.is_sign_negative() {
        out.push('-');
    }
    let int_text: Vec<u8> = digits.iter().map(|d| b'0' + d).collect();
    for (i, digit) in int_text.iter().enumerate() {
        if i > 0 && (int_text.len() - i).is_multiple_of(3) {
            out.push('\u{202f}');
        }
        out.push(*digit as char);
    }
    if !frac.is_empty() {
        out.push(',');
        out.extend(frac.iter().map(|d| (b'0' + d) as char));
    }
    out
}

/// `Number.prototype.toFixed(digits)` for finite values below 1e21. The exact binary value is rounded
/// half up, and -0 prints without a sign.
fn to_fixed(value: f64, digits: usize) -> String {
    // The exact expansion of a double has at most 1074 fraction digits, so 1100 digits settle the next one.
    let exact = format!("{:.1100}", value.abs());
    let (int_part, frac_part) = exact
        .split_once('.')
        .expect("fixed-point output has a point");
    let mut int_len = int_part.len();
    let mut all: Vec<u8> = int_part.bytes().map(|b| b - b'0').collect();
    all.extend(frac_part.bytes().take(digits).map(|b| b - b'0'));
    if frac_part.as_bytes()[digits] >= b'5' && add_one(&mut all) {
        int_len += 1;
    }
    let frac = all.split_off(int_len);
    let int_text: String = all.iter().map(|d| (b'0' + d) as char).collect();
    let frac_text: String = frac.iter().map(|d| (b'0' + d) as char).collect();
    let sign = if value < 0.0 { "-" } else { "" };
    format!("{sign}{int_text}.{frac_text}")
}

fn fixed2(value: f64) -> String {
    to_fixed(safe(value), 2)
}

/// Adds one unit in the last place of `digits`; returns true when a new leading digit was needed.
fn add_one(digits: &mut Vec<u8>) -> bool {
    for digit in digits.iter_mut().rev() {
        if *digit == 9 {
            *digit = 0;
        } else {
            *digit += 1;
            return false;
        }
    }
    digits.insert(0, 1);
    true
}

/// `Math.round`: halves round toward +Infinity, and a negative input that rounds to zero stays -0.
fn js_round(value: f64) -> f64 {
    if !value.is_finite() {
        return value;
    }
    let floor = value.floor();
    let rounded = if value - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    };
    if rounded == 0.0 && value.is_sign_negative() {
        -0.0
    } else {
        rounded
    }
}

/// `formatDate`: `DD/MM/YYYY HH:MM UTC`, read in UTC.
fn format_date(ms: f64) -> String {
    if !ms.is_finite() {
        return "NaN/NaN/NaN NaN:NaN UTC".to_string();
    }
    let time = ms.trunc() as i64;
    let (year, month, day) = civil_from_days(time.div_euclid(MS_PER_DAY));
    let rem = time.rem_euclid(MS_PER_DAY);
    format!(
        "{:02}/{:02}/{} {:02}:{:02} UTC",
        day,
        month,
        year,
        rem / MS_PER_HOUR,
        rem % MS_PER_HOUR / MS_PER_MINUTE
    )
}

/// Year, month and day of a day count since 1970-01-01 (proleptic Gregorian calendar).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |elapsed| elapsed.as_millis() as f64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn report(project: &str, summary: &str) -> ExportReport {
        serde_json::from_value(json!({
            "preview": {
                "totals": { "aiuCredits": 1234.5, "tokens": 3000, "requests": 4 },
                "sessionCount": 1,
                "activeDays": 1,
                "byModel": [],
                "daily": [{ "date": "2026-01-01", "aiuCredits": 1234.5, "tokens": 3000, "requests": 4 }]
            },
            "summaryRows": [{
                "date": "2026-01-01", "project": project, "model": "gpt-5.4", "aiuCredits": 1234.5,
                "inputTokens": 1200, "outputTokens": 340, "tokens": 1540, "requests": 3,
                "dayTotalAiuCredits": 1234.5, "modelTotalAiuCredits": 1234.5, "modelSharePercent": 100,
                "projectTotalAiuCredits": 1234.5, "projectSharePercent": 100
            }],
            "sessionRows": [{
                "sessionId": "s1", "createdAt": "2026-01-01 09:00:00.000", "date": "2026-01-01",
                "project": project, "summary": summary, "models": "gpt-5.4", "aiuCredits": 1234.5,
                "inputTokens": 1200, "outputTokens": 340, "tokens": 1540, "requests": 3
            }]
        }))
        .unwrap()
    }

    fn options(project: Option<&str>) -> HtmlReportOptions {
        serde_json::from_value(json!({
            "filters": { "project": project },
            "generatedAt": 1700000000000.0
        }))
        .unwrap()
    }

    #[test]
    fn escapes_markup_and_quotes_in_project_name() {
        let name = "<Alpha> & \"Café\" 'x' 😀";
        let html = render_html_report(&report(name, "plain"), &options(Some(name))).unwrap();
        assert!(html.contains("&lt;Alpha&gt; &amp; &quot;Café&quot; &#39;x&#39; 😀"));
        assert!(!html.contains("<Alpha>"));
    }

    #[test]
    fn keeps_session_summary_newlines_and_escapes_it() {
        let html =
            render_html_report(&report("p", "line one\n<b>line two</b>"), &options(None)).unwrap();
        assert!(
            html.contains("<td class=\"summary-cell\">line one\n&lt;b&gt;line two&lt;/b&gt;</td>")
        );
    }

    #[test]
    fn never_renders_prompt_or_response_fields() {
        let mut value = json!({
            "preview": {
                "totals": { "aiuCredits": 1, "tokens": 1, "requests": 1 },
                "sessionCount": 1, "activeDays": 1, "byModel": [], "daily": []
            },
            "summaryRows": [],
            "sessionRows": [{
                "sessionId": "s1", "createdAt": "2026-01-01", "date": "2026-01-01", "project": "p",
                "summary": "visible summary", "models": "m", "aiuCredits": 1, "inputTokens": 1,
                "outputTokens": 1, "tokens": 1, "requests": 1
            }]
        });
        value["sessionRows"][0]["prompt"] = json!("PROMPT-SECRET");
        value["sessionRows"][0]["response"] = json!("RESPONSE-SECRET");
        let report: ExportReport = serde_json::from_value(value).unwrap();
        let html = render_html_report(&report, &options(None)).unwrap();
        assert!(html.contains("visible summary"));
        assert!(!html.contains("PROMPT-SECRET"));
        assert!(!html.contains("RESPONSE-SECRET"));
    }

    #[test]
    fn formats_numbers_like_intl_fr_fr() {
        let html = render_html_report(&report("p", "s"), &options(None)).unwrap();
        // Intl.NumberFormat('fr-FR') groups thousands with U+202F and uses a decimal comma.
        assert!(html.contains("<p class=\"kpi-value\">1\u{202f}234,5</p>"));
        assert!(html.contains("<p class=\"kpi-value\">3\u{202f}000</p>"));
    }

    #[test]
    fn null_created_at_is_an_error_not_an_empty_cell() {
        let mut input = report("p", "s");
        input.session_rows[0].created_at = None;
        assert_eq!(
            render_html_report(&input, &options(None)),
            Err(HtmlReportError::NullDate { field: "createdAt" })
        );
    }
}
