import type { LogLevel } from '../../shared/types';

/**
 * Several hooks poll every few seconds, so a persistent failure would log the
 * same line over and over. Identical entries are dropped within this window.
 */
const DEDUPE_WINDOW_MS = 30_000;

const lastLoggedAt = new Map<string, number>();

/**
 * Forwards a renderer-side log entry to the main process so it shows up in the
 * Logs page and the log file. Failures are swallowed: logging must never be
 * the reason a screen breaks.
 */
export function log(level: LogLevel, scope: string, message: string, detail?: unknown): void {
  const key = `${level}|${scope}|${message}`;
  const now = Date.now();
  const previous = lastLoggedAt.get(key);
  if (previous !== undefined && now - previous < DEDUPE_WINDOW_MS) {
    return;
  }
  lastLoggedAt.set(key, now);

  try {
    window.api?.log?.({ level, scope, message, detail })?.catch(() => undefined);
  } catch {
    // The preload bridge isn't available (e.g. in tests) — ignore.
  }
}

export const logDebug = (scope: string, message: string, detail?: unknown): void =>
  log('debug', scope, message, detail);
export const logInfo = (scope: string, message: string, detail?: unknown): void =>
  log('info', scope, message, detail);
export const logWarn = (scope: string, message: string, detail?: unknown): void =>
  log('warn', scope, message, detail);
export const logError = (scope: string, message: string, detail?: unknown): void =>
  log('error', scope, message, detail);

/** Test-only helper: forgets which entries were recently logged. */
export function resetLogDedupeForTests(): void {
  lastLoggedAt.clear();
}

/**
 * Registers window-level handlers so uncaught renderer errors and rejected
 * promises — the classic causes of a blank page — end up in the Logs page.
 */
export function installGlobalErrorLogging(target: Window = window): void {
  target.addEventListener('error', (event) => {
    const errorEvent = event as ErrorEvent;
    logError('window', errorEvent.message || 'Uncaught renderer error', errorEvent.error ?? errorEvent.message);
  });

  target.addEventListener('unhandledrejection', (event) => {
    const rejection = event as PromiseRejectionEvent;
    logError('window', 'Unhandled promise rejection in the renderer', rejection.reason);
  });
}
