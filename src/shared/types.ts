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
