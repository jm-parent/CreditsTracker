//! Shared data types for the Credits Dashboard Rust core.
//!
//! These mirror `src/shared/types.ts` field-for-field. Rust field names use
//! `snake_case` and `#[serde(rename_all = "camelCase")]` so JSON exchanged
//! with the existing renderer is unchanged.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageFilters {
    pub project: Option<String>,
    pub project_search: Option<String>,
    pub model: Option<String>,
    /// Inclusive ISO date string 'YYYY-MM-DD'
    pub from: Option<String>,
    /// Inclusive ISO date string 'YYYY-MM-DD'
    pub to: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTotals {
    pub aiu_credits: f64,
    pub tokens: f64,
    pub requests: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeSeriesPoint {
    pub date: String,
    pub aiu_credits: f64,
    /// Credits for this date broken down by project key. Only populated for
    /// the main dashboard chart.
    pub by_project: Option<HashMap<String, f64>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HourlyPoint {
    /// Hour of day, formatted 'HH:00'
    pub hour: String,
    pub aiu_credits: f64,
    pub by_project: HashMap<String, f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HourlyDetailParams {
    pub project: Option<String>,
    pub project_search: Option<String>,
    pub model: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    /// Inclusive ISO date string 'YYYY-MM-DD' to zoom into
    pub date: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakdownPoint {
    pub key: String,
    pub aiu_credits: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageResult {
    pub totals: UsageTotals,
    pub time_series: Vec<TimeSeriesPoint>,
    pub by_project: Vec<BreakdownPoint>,
    pub by_model: Vec<BreakdownPoint>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportModelPreviewRow {
    pub model: String,
    pub aiu_credits: f64,
    pub share_percent: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDailyPreviewRow {
    pub date: String,
    pub aiu_credits: f64,
    pub tokens: f64,
    pub requests: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPreview {
    pub totals: UsageTotals,
    pub session_count: f64,
    pub active_days: f64,
    pub by_model: Vec<ExportModelPreviewRow>,
    pub daily: Vec<ExportDailyPreviewRow>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummaryRow {
    pub date: String,
    pub project: String,
    pub model: String,
    pub aiu_credits: f64,
    pub input_tokens: f64,
    pub output_tokens: f64,
    pub tokens: f64,
    pub requests: f64,
    pub day_total_aiu_credits: f64,
    pub model_total_aiu_credits: f64,
    pub model_share_percent: f64,
    pub project_total_aiu_credits: f64,
    pub project_share_percent: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSessionRow {
    pub session_id: String,
    pub created_at: String,
    pub date: String,
    pub project: String,
    pub summary: String,
    pub models: String,
    pub aiu_credits: f64,
    pub input_tokens: f64,
    pub output_tokens: f64,
    pub tokens: f64,
    pub requests: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub preview: ExportPreview,
    pub summary_rows: Vec<ExportSummaryRow>,
    pub session_rows: Vec<ExportSessionRow>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub filters: UsageFilters,
    pub suggested_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub cancelled: bool,
    pub html_path: Option<String>,
    pub summary_rows: Option<f64>,
    pub session_rows: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentTraceSource {
    Vscode,
    CopilotCli,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentTraceCategory {
    Agent,
    Llm,
    Tool,
    Skill,
    Shell,
    Mcp,
    Hook,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentTraceContentState {
    Unavailable,
    Stored,
    Redacted,
    Truncated,
    RedactedTruncated,
    Omitted,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTraceSelection {
    pub source: AgentTraceSource,
    pub session_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentTraceSpanStatus {
    Unset,
    Ok,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTraceSpan {
    pub source: AgentTraceSource,
    pub session_id: String,
    pub trace_id: String,
    pub span_id: String,
    pub parent_span_id: Option<String>,
    pub name: String,
    pub category: AgentTraceCategory,
    pub tool_name: Option<String>,
    pub skill_name: Option<String>,
    pub model: Option<String>,
    pub started_at: String,
    pub ended_at: String,
    pub duration_ms: f64,
    pub status: AgentTraceSpanStatus,
    pub error_type: Option<String>,
    pub tool_call_id: Option<String>,
    pub arguments_json: Option<String>,
    pub result_text: Option<String>,
    pub content_state: AgentTraceContentState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentTraceAvailability {
    Available,
    Partial,
    NotCollected,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTraceSession {
    pub source: AgentTraceSource,
    pub session_id: String,
    pub availability: AgentTraceAvailability,
    pub spans: Vec<AgentTraceSpan>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTraceCollectionStatus {
    pub enabled: bool,
    pub listening: bool,
    pub endpoint: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterOptions {
    pub projects: Vec<String>,
    pub models: Vec<String>,
    pub min_date: Option<String>,
    pub max_date: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub source: AgentTraceSource,
    pub session_id: String,
    pub created_at: String,
    pub summary: Option<String>,
    pub models: String,
    pub aiu_credits: f64,
    pub tokens: f64,
    pub requests: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetailResult {
    pub project: String,
    pub totals: UsageTotals,
    pub time_series: Vec<TimeSeriesPoint>,
    pub conversations: Vec<ConversationSummary>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RawTableName {
    Sessions,
    AssistantUsageEvents,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawTablePage {
    pub columns: Vec<String>,
    pub rows: Vec<HashMap<String, serde_json::Value>>,
    pub total: f64,
    pub page: f64,
    pub page_size: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawTableParams {
    pub table: RawTableName,
    pub page: f64,
    pub page_size: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

/// Which process produced a log entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogSource {
    Main,
    Renderer,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// Monotonically increasing id, used as a stable React key and for
    /// polling diffs.
    pub id: f64,
    /// ISO 8601 timestamp.
    pub timestamp: String,
    pub level: LogLevel,
    /// Short subsystem name, e.g. 'db' or 'ModelsPage'.
    pub scope: String,
    pub message: String,
    /// Stack trace or serialized payload attached to the entry.
    pub detail: Option<String>,
    pub source: LogSource,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogsSnapshot {
    pub entries: Vec<LogEntry>,
    /// Absolute path of the log file, or null when file logging is
    /// unavailable.
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererLogInput {
    pub level: LogLevel,
    pub scope: String,
    pub message: String,
    pub detail: Option<serde_json::Value>,
}

/// Where the app currently stands in the user-driven update flow.
///
/// - `Unsupported`: unpackaged (`npm start`) or a platform without a Squirrel
///   installer, so no update can ever be applied.
/// - `Checking`: a background (or manual) availability check is in flight.
/// - `UpToDate`: the last check found no newer release.
/// - `Available`: a newer release exists and is waiting for the user to accept.
/// - `Downloading`: the user accepted; Squirrel is fetching and staging it.
/// - `Ready`: the update is installed locally and applies on the next restart.
/// - `Error`: the last check or download failed; `error` holds the message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateStatus {
    Unsupported,
    Checking,
    UpToDate,
    Available,
    Downloading,
    Ready,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    pub status: UpdateStatus,
    /// Version currently running, e.g. "1.5.0".
    pub current_version: String,
    /// Version offered by the release feed, when one is available.
    pub latest_version: Option<String>,
    /// Release notes markdown supplied by the feed, when available.
    pub release_notes: Option<String>,
    /// Message of the last failure, only set when `status` is `error`.
    pub error: Option<String>,
    /// ISO 8601 timestamp of the last completed availability check.
    pub last_checked_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyActivityParams {
    /// Full calendar year, e.g. 2026.
    pub year: i32,
    /// Month number, 1-12.
    pub month: i32,
    pub project: Option<String>,
    pub project_search: Option<String>,
    pub model: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_filters_deserializes_camel_case_from_renderer() {
        let json = r#"{"project":null,"model":null,"from":"2026-01-01","to":"2026-01-31"}"#;
        let f: UsageFilters = serde_json::from_str(json).unwrap();
        assert_eq!(f.from.as_deref(), Some("2026-01-01"));
    }

    /// The string literal unions in `src/shared/types.ts` use specific
    /// casing (kebab-case, lowercase, snake_case) that doesn't always match
    /// Rust's default PascalCase variant names. Pin each enum's wire format
    /// to the exact TypeScript literal so a future derive-attribute change
    /// can't silently break the renderer's JSON contract.
    #[test]
    fn enum_wire_formats_match_typescript_literals() {
        assert_eq!(
            serde_json::to_string(&AgentTraceSource::CopilotCli).unwrap(),
            "\"copilot-cli\""
        );
        assert_eq!(
            serde_json::to_string(&AgentTraceContentState::RedactedTruncated).unwrap(),
            "\"redacted-truncated\""
        );
        assert_eq!(
            serde_json::to_string(&AgentTraceAvailability::NotCollected).unwrap(),
            "\"not-collected\""
        );
        assert_eq!(
            serde_json::to_string(&UpdateStatus::UpToDate).unwrap(),
            "\"up-to-date\""
        );
        assert_eq!(
            serde_json::to_string(&RawTableName::AssistantUsageEvents).unwrap(),
            "\"assistant_usage_events\""
        );
    }
}
