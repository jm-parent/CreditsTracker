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
