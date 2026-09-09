export interface UsageFilters {
  project?: string;
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

export interface FilterOptions {
  projects: string[];
  models: string[];
  minDate: string | null;
  maxDate: string | null;
}

export interface ConversationSummary {
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

export interface MonthlyActivityParams {
  /** Full calendar year, e.g. 2026. */
  year: number;
  /** Month number, 1-12. */
  month: number;
  project?: string;
  model?: string;
}
