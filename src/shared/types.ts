export interface UsageFilters {
  project?: string;
  projectSearch?: string;
  model?: string;
  /** Inclusive ISO date string 'YYYY-MM-DD' */
  from?: string;
  /** Inclusive ISO date string 'YYYY-MM-DD' */
  to?: string;
}

export interface UsageTotals {
  aiuCredits: number;
  tokens: number;
  requests: number;
}

export interface TimeSeriesPoint {
  date: string;
  aiuCredits: number;
  /** Credits for this date broken down by project key. Only populated for the main dashboard chart. */
  byProject?: Record<string, number>;
}

export interface HourlyPoint {
  /** Hour of day, formatted 'HH:00' */
  hour: string;
  aiuCredits: number;
  byProject: Record<string, number>;
}

export interface HourlyDetailParams extends UsageFilters {
  /** Inclusive ISO date string 'YYYY-MM-DD' to zoom into */
  date: string;
}

export interface BreakdownPoint {
  key: string;
  aiuCredits: number;
}

export interface UsageResult {
  totals: UsageTotals;
  timeSeries: TimeSeriesPoint[];
  byProject: BreakdownPoint[];
  byModel: BreakdownPoint[];
}

export interface ExportModelPreviewRow {
  model: string;
  aiuCredits: number;
  sharePercent: number;
}

export interface ExportDailyPreviewRow {
  date: string;
  aiuCredits: number;
  tokens: number;
  requests: number;
}

export interface ExportPreview {
  totals: UsageTotals;
  sessionCount: number;
  activeDays: number;
  byModel: ExportModelPreviewRow[];
  daily: ExportDailyPreviewRow[];
}

export interface ExportSummaryRow {
  date: string;
  project: string;
  model: string;
  aiuCredits: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  requests: number;
  dayTotalAiuCredits: number;
  modelTotalAiuCredits: number;
  modelSharePercent: number;
  projectTotalAiuCredits: number;
  projectSharePercent: number;
}

export interface ExportSessionRow {
  sessionId: string;
  createdAt: string;
  date: string;
  project: string;
  summary: string;
  models: string;
  aiuCredits: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  requests: number;
}

export interface ExportReport {
  preview: ExportPreview;
  summaryRows: ExportSummaryRow[];
  sessionRows: ExportSessionRow[];
}

export interface ExportRequest {
  filters: UsageFilters;
  suggestedName?: string;
}

export interface ExportResult {
  cancelled: boolean;
  htmlPath?: string;
  summaryRows?: number;
  sessionRows?: number;
}

export type AgentTraceSource = 'vscode' | 'copilot-cli';
export type AgentTraceCategory = 'agent' | 'llm' | 'tool' | 'skill' | 'shell' | 'mcp' | 'hook' | 'other';
export type AgentTraceContentState =
  | 'unavailable'
  | 'stored'
  | 'redacted'
  | 'truncated'
  | 'redacted-truncated'
  | 'omitted';

export interface AgentTraceSelection {
  source: AgentTraceSource;
  sessionId: string;
}

export interface AgentTraceSpan {
  source: AgentTraceSource;
  sessionId: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  category: AgentTraceCategory;
  toolName: string | null;
  skillName: string | null;
  model: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: 'unset' | 'ok' | 'error';
  errorType: string | null;
  toolCallId: string | null;
  argumentsJson: string | null;
  resultText: string | null;
  contentState: AgentTraceContentState;
}

export interface AgentTraceSession {
  source: AgentTraceSource;
  sessionId: string;
  availability: 'available' | 'partial' | 'not-collected';
  spans: AgentTraceSpan[];
}

export interface AgentTraceCollectionStatus {
  enabled: boolean;
  listening: boolean;
  endpoint: string | null;
  errorMessage: string | null;
}

export interface FilterOptions {
  projects: string[];
  models: string[];
  minDate: string | null;
  maxDate: string | null;
}

export interface ConversationSummary {
  source: AgentTraceSource;
  sessionId: string;
  createdAt: string;
  summary: string | null;
  models: string;
  aiuCredits: number;
  tokens: number;
  requests: number;
}

export interface ProjectDetailResult {
  project: string;
  totals: UsageTotals;
  timeSeries: TimeSeriesPoint[];
  conversations: ConversationSummary[];
}

export type RawTableName = 'sessions' | 'assistant_usage_events';

export interface RawTablePage {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
}

export interface RawTableParams {
  table: RawTableName;
  page: number;
  pageSize: number;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Which process produced a log entry. */
export type LogSource = 'main' | 'renderer';

export interface LogEntry {
  /** Monotonically increasing id, used as a stable React key and for polling diffs. */
  id: number;
  /** ISO 8601 timestamp. */
  timestamp: string;
  level: LogLevel;
  /** Short subsystem name, e.g. 'db' or 'ModelsPage'. */
  scope: string;
  message: string;
  /** Stack trace or serialized payload attached to the entry. */
  detail?: string;
  source: LogSource;
}

export interface LogsSnapshot {
  entries: LogEntry[];
  /** Absolute path of the log file, or null when file logging is unavailable. */
  filePath: string | null;
}

export interface RendererLogInput {
  level: LogLevel;
  scope: string;
  message: string;
  detail?: unknown;
}

/**
 * Where the app currently stands in the user-driven update flow.
 *
 * - `unsupported`: unpackaged (`npm start`) or a platform without a Squirrel
 *   installer, so no update can ever be applied.
 * - `checking`: a background (or manual) availability check is in flight.
 * - `up-to-date`: the last check found no newer release.
 * - `available`: a newer release exists and is waiting for the user to accept.
 * - `downloading`: the user accepted; Squirrel is fetching and staging it.
 * - `ready`: the update is installed locally and applies on the next restart.
 * - `error`: the last check or download failed; `error` holds the message.
 */
export type UpdateStatus =
  | 'unsupported'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

export interface UpdateState {
  status: UpdateStatus;
  /** Version currently running, e.g. "1.5.0". */
  currentVersion: string;
  /** Version offered by the release feed, when one is available. */
  latestVersion?: string;
  /** Release notes markdown supplied by the feed, when available. */
  releaseNotes?: string;
  /** Message of the last failure, only set when `status` is `error`. */
  error?: string;
  /** ISO 8601 timestamp of the last completed availability check. */
  lastCheckedAt?: string;
}

export interface MonthlyActivityParams {
  /** Full calendar year, e.g. 2026. */
  year: number;
  /** Month number, 1-12. */
  month: number;
  project?: string;
  projectSearch?: string;
  model?: string;
}
