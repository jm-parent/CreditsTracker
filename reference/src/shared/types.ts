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
