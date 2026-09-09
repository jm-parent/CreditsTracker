import fs from 'node:fs';
import path from 'node:path';
import type { LogEntry, LogLevel, LogSource } from '../shared/types';

/**
 * In-memory ring buffer size. The Logs page only ever shows a recent window of
 * activity, and keeping the buffer bounded avoids growing the main process
 * heap during long sessions.
 */
const MAX_ENTRIES = 2_000;

/** Log file is rotated to `<name>.1` once it grows past this size. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

let entries: LogEntry[] = [];
let nextId = 1;
let logFilePath: string | null = null;
/** Set once a file write fails, so we don't spam the console on every entry. */
let fileWriteFailed = false;

/**
 * Points the logger at a file on disk. Everything logged before this call
 * stays in memory only; entries logged afterwards are both buffered and
 * appended to the file so a user can send the file for support.
 *
 * Deliberately Electron-free so the logger can be unit tested and reused from
 * any process; `main.ts` supplies the userData-based path.
 */
export function configureLogFile(filePath: string): void {
  logFilePath = filePath;
  fileWriteFailed = false;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch (error) {
    fileWriteFailed = true;
    console.error('Failed to create log directory:', error);
  }
}

export function getLogFilePath(): string | null {
  return logFilePath;
}

/** Turns anything a caller passes as `detail` into a readable string. */
export function formatDetail(detail: unknown): string | undefined {
  if (detail === undefined || detail === null) {
    return undefined;
  }
  if (typeof detail === 'string') {
    return detail;
  }
  if (detail instanceof Error) {
    return detail.stack ?? `${detail.name}: ${detail.message}`;
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

function formatLine(entry: LogEntry): string {
  const detail = entry.detail ? ` | ${entry.detail.replace(/\r?\n/g, ' ')}` : '';
  return `${entry.timestamp} ${entry.level.toUpperCase()} [${entry.source}/${entry.scope}] ${entry.message}${detail}\n`;
}

function rotateIfNeeded(filePath: string): void {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size >= MAX_FILE_BYTES) {
      fs.rmSync(`${filePath}.1`, { force: true });
      fs.renameSync(filePath, `${filePath}.1`);
    }
  } catch {
    // File doesn't exist yet (or can't be stat'ed) — nothing to rotate.
  }
}

function appendToFile(entry: LogEntry): void {
  if (!logFilePath || fileWriteFailed) {
    return;
  }
  try {
    rotateIfNeeded(logFilePath);
    fs.appendFileSync(logFilePath, formatLine(entry), 'utf8');
  } catch (error) {
    fileWriteFailed = true;
    console.error('Failed to write to log file:', error);
  }
}

function push(entry: LogEntry): LogEntry {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }
  appendToFile(entry);
  return entry;
}

/**
 * Records a log entry in the ring buffer, the log file and the console.
 * `source` distinguishes main-process entries from ones forwarded by the
 * renderer over IPC.
 */
export function log(
  level: LogLevel,
  scope: string,
  message: string,
  detail?: unknown,
  source: LogSource = 'main',
): LogEntry {
  const entry: LogEntry = {
    id: nextId++,
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    detail: formatDetail(detail),
    source,
  };

  const consoleLine = formatLine(entry).trimEnd();
  if (level === 'error') {
    console.error(consoleLine);
  } else if (level === 'warn') {
    console.warn(consoleLine);
  } else {
    console.log(consoleLine);
  }

  return push(entry);
}

export const logDebug = (scope: string, message: string, detail?: unknown): LogEntry =>
  log('debug', scope, message, detail);
export const logInfo = (scope: string, message: string, detail?: unknown): LogEntry =>
  log('info', scope, message, detail);
export const logWarn = (scope: string, message: string, detail?: unknown): LogEntry =>
  log('warn', scope, message, detail);
export const logError = (scope: string, message: string, detail?: unknown): LogEntry =>
  log('error', scope, message, detail);

/** Records an entry forwarded by the renderer process. */
export function recordRendererLog(input: {
  level?: LogLevel;
  scope?: string;
  message?: string;
  detail?: unknown;
}): LogEntry {
  const level: LogLevel = ['debug', 'info', 'warn', 'error'].includes(input?.level as string)
    ? (input.level as LogLevel)
    : 'info';
  return log(level, input?.scope || 'renderer', input?.message ?? '(empty message)', input?.detail, 'renderer');
}

/** Keys already emitted through `logOnce`. */
const emittedOnce = new Set<string>();

/**
 * Logs an entry only the first time a given `key` is seen. Used for
 * conditions re-evaluated on a timer (database rebuilds, missing files) so a
 * recurring state doesn't flood the log with identical lines. Callers encode
 * the changing part of the state in the key to get a new entry when it moves.
 */
export function logOnce(
  key: string,
  level: LogLevel,
  scope: string,
  message: string,
  detail?: unknown,
): LogEntry | null {
  if (emittedOnce.has(key)) {
    return null;
  }
  if (emittedOnce.size > 500) {
    emittedOnce.clear();
  }
  emittedOnce.add(key);
  return log(level, scope, message, detail);
}

/** Returns buffered entries, newest last. */
export function getLogEntries(): LogEntry[] {
  return entries.slice();
}

/** Empties the in-memory buffer and truncates the log file. */
export function clearLogs(): void {
  entries = [];
  if (logFilePath && !fileWriteFailed) {
    try {
      fs.writeFileSync(logFilePath, '', 'utf8');
    } catch (error) {
      console.error('Failed to truncate log file:', error);
    }
  }
}

/** Test-only helper: resets buffer, ids and file configuration. */
export function resetLoggerForTests(): void {
  entries = [];
  nextId = 1;
  logFilePath = null;
  fileWriteFailed = false;
  emittedOnce.clear();
}
