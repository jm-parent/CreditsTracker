import fs from 'node:fs';
import { app, dialog, ipcMain, shell } from 'electron';
import Database from 'better-sqlite3';
import {
  openDatabase,
  buildMergedDatabase,
  DatabaseNotFoundError,
  getFilterOptions,
  getExportReport,
  getUsage,
  getProjectDetail,
  getRawTablePage,
  getHourlyDetail,
  getMonthlyActivity,
} from './db';
import { writeExportFile, getExportFilePath } from './export-files';
import { renderHtmlReport } from './html-report';
import { loadVscodeUsage } from './vscode-chat-store';
import { checkForUpdate, downloadUpdate, getUpdateState, restartToUpdate } from './updater';
import {
  createDesktopShortcut,
  shouldPromptForDesktopShortcut,
} from './shortcut';
import {
  clearLogs,
  getLogEntries,
  getLogFilePath,
  logError,
  logInfo,
  logOnce,
  logWarn,
  recordRendererLog,
} from './logger';
import type { AgentTraceService } from './agent-trace-service';
import { MAX_AGENT_TRACE_SESSION_SEARCH_LENGTH } from '../shared/types';
import type {
  AgentTraceCategory,
  AgentTraceSelection,
  AgentTraceSessionListFilters,
  AgentTraceSource,
  HourlyDetailParams,
  LogsSnapshot,
  MonthlyActivityParams,
  ExportRequest,
  ExportResult,
  RawTableParams,
  RendererLogInput,
  UsageFilters,
} from '../shared/types';
import type { VscodeUsageData } from './vscode-chat-store';

const CANONICAL_GITHUB_REPOSITORY_PATH = /^\/[^/%?#]+\/[^/%?#]+$/;
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const AGENT_TRACE_SOURCES: readonly AgentTraceSource[] = ['vscode', 'copilot-cli'];
const AGENT_TRACE_CATEGORIES: readonly AgentTraceCategory[] = ['agent', 'llm', 'tool', 'skill', 'shell', 'mcp', 'hook', 'other'];
const AGENT_TRACE_STATUSES = ['unset', 'ok', 'error'] as const;

function validateExternalRepositoryUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Only GitHub repository URLs can be opened');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Only GitHub repository URLs can be opened');
  }

  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== 'github.com'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !CANONICAL_GITHUB_REPOSITORY_PATH.test(parsed.pathname)
  ) {
    throw new Error('Only GitHub repository URLs can be opened');
  }

  if (value !== `https://github.com${parsed.pathname}`) {
    throw new Error('Only GitHub repository URLs can be opened');
  }

  return value;
}

/**
 * Opens the Copilot CLI database (falling back to an empty in-memory schema
 * if it doesn't exist, so VS Code-only usage can still populate the
 * dashboard), optionally layers in Copilot Chat usage recorded by the VS Code
 * extension, and registers all the renderer-facing IPC handlers against the
 * resulting merged database.
 *
 * `workspaceStorageDir`, when provided, points at VS Code's
 * `User/workspaceStorage` folder and is scanned for chat session logs. It is
 * omitted in tests to keep handler behavior deterministic.
 */
/**
 * The merged database is rebuilt from the on-disk CLI database (and, when
 * configured, the VS Code chat usage files) at most once per this interval.
 * Rebuilding is triggered lazily, right before serving a renderer request,
 * so usage recorded since the last rebuild (e.g. a Copilot CLI action run
 * moments ago) shows up on screen within roughly this delay instead of only
 * after the app is restarted.
 */
const DB_REFRESH_INTERVAL_MS = 5_000;

function buildMergedDatabaseFromSources(
  dbPath: string,
  workspaceStorageDir: string | undefined,
): Database.Database {
  let cliDb: Database.Database;
  try {
    cliDb = openDatabase(dbPath);
  } catch (error) {
    if (!(error instanceof DatabaseNotFoundError)) {
      logError('db', 'Failed to open the Copilot CLI database', error);
      throw error;
    }
    logOnce('db-missing', 'warn', 'db', 'Copilot CLI database not found, falling back to an empty schema', dbPath);
    cliDb = new Database(':memory:');
    cliDb.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, summary TEXT, created_at TEXT);
      CREATE TABLE assistant_usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        model TEXT NOT NULL,
        total_nano_aiu INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        created_at TEXT
      );
    `);
  }

  let vscodeData: VscodeUsageData = { events: [], sessions: [] };
  if (workspaceStorageDir) {
    try {
      vscodeData = loadVscodeUsage(workspaceStorageDir);
    } catch (error) {
      logError('vscode-chat', 'Failed to load VS Code Copilot Chat usage', error);
    }
  }

  const merged = buildMergedDatabase(cliDb, vscodeData);
  // The database is rebuilt every few seconds, so this is only logged when
  // the source contents actually change — otherwise the log would fill up
  // with identical lines.
  logOnce(
    `db-built:${vscodeData.sessions.length}:${vscodeData.events.length}`,
    'info',
    'db',
    'Merged database rebuilt',
    {
      dbPath,
      vscodeSessions: vscodeData.sessions.length,
      vscodeEvents: vscodeData.events.length,
    },
  );
  return merged;
}

/**
 * Channels excluded from the per-call debug trace: they are driven by the Logs
 * page polling itself, so tracing them would grow the log file indefinitely
 * with entries about reading the logs. Errors are still logged.
 */
const UNTRACED_CHANNELS = new Set(['get-logs', 'clear-logs', 'log-message']);

/**
 * The renderer polls several channels every few seconds, so only unusually
 * slow calls are traced. Anything faster stays out of the log to keep it
 * readable; failures are always logged.
 */
const SLOW_CALL_MS = 250;

function logSlowCall(channel: string, startedAt: number): void {
  const elapsed = Date.now() - startedAt;
  if (elapsed >= SLOW_CALL_MS && !UNTRACED_CHANNELS.has(channel)) {
    logWarn('ipc', `${channel} took ${elapsed}ms`);
  }
}

/**
 * Wraps an IPC handler so slow calls are traced and any thrown error lands in
 * the Logs page with its stack, instead of only rejecting in the renderer
 * where it usually surfaced as a blank screen.
 */
function handle(channel: string, listener: (...args: never[]) => unknown): void {
  ipcMain.handle(channel, (...args: unknown[]) => {
    const startedAt = Date.now();
    try {
      const result = (listener as (...inner: unknown[]) => unknown)(...args);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        return Promise.resolve(result).then(
          (value) => {
            logSlowCall(channel, startedAt);
            return value;
          },
          (error) => {
            logError('ipc', `${channel} failed after ${Date.now() - startedAt}ms`, error);
            throw error;
          },
        );
      }
      logSlowCall(channel, startedAt);
      return result;
    } catch (error) {
      logError('ipc', `${channel} failed after ${Date.now() - startedAt}ms`, error);
      throw error;
    }
  });
}

function snapshot(): LogsSnapshot {
  return { entries: getLogEntries(), filePath: getLogFilePath() };
}

export function registerAgentTraceIpcHandlers(traceService: AgentTraceService): void {
  handle('get-agent-trace-collection-status', () => traceService.getStatus());
  handle('get-agent-trace-session-count', () => traceService.getSessionCount());
  handle('list-agent-trace-sessions', (_event: unknown, filters: unknown) => {
    return traceService.listSessions(validateAgentTraceSessionListFilters(filters));
  });

  handle('set-agent-trace-collection-enabled', (_event: unknown, enabled: unknown) => {
    return traceService.setEnabled(validateAgentTraceCollectionEnabled(enabled));
  });

  handle('get-agent-trace-session', (_event: unknown, selection: unknown) => {
    return traceService.getSession(validateAgentTraceSelection(selection));
  });

  handle('clear-agent-trace-data', () => {
    traceService.clear();
  });
}

export function registerIpcHandlers(dbPath: string, workspaceStorageDir?: string): void {
  logInfo('startup', 'Registering IPC handlers', { dbPath, workspaceStorageDir });
  let db = buildMergedDatabaseFromSources(dbPath, workspaceStorageDir);
  let lastBuiltAt = Date.now();

  function currentDb(): Database.Database {
    const now = Date.now();
    if (now - lastBuiltAt >= DB_REFRESH_INTERVAL_MS) {
      db = buildMergedDatabaseFromSources(dbPath, workspaceStorageDir);
      lastBuiltAt = now;
    }
    return db;
  }

  handle('get-filter-options', () => {
    return getFilterOptions(currentDb());
  });

  handle('get-usage', (_event: unknown, filters: UsageFilters) => {
    return getUsage(currentDb(), filters ?? {});
  });

  handle('get-project-detail', (_event: unknown, params: UsageFilters & { project: string }) => {
    return getProjectDetail(currentDb(), params);
  });

  handle('get-raw-table-page', (_event: unknown, params: RawTableParams) => {
    return getRawTablePage(currentDb(), params.table, params.page, params.pageSize);
  });

  handle('get-hourly-detail', (_event: unknown, params: HourlyDetailParams) => {
    return getHourlyDetail(currentDb(), params);
  });

  handle('get-monthly-activity', (_event: unknown, params: MonthlyActivityParams) => {
    return getMonthlyActivity(currentDb(), params);
  });

  handle('get-export-preview', (_event: unknown, filters: UsageFilters) => {
    return getExportReport(currentDb(), filters ?? {}).preview;
  });

  handle('export-html', async (_event: unknown, request: ExportRequest) => {
    const report = getExportReport(currentDb(), request?.filters ?? {});
    const save = await dialog.showSaveDialog({
      title: 'Export Copilot usage',
      defaultPath: request?.suggestedName ?? 'copilot-usage.html',
      filters: [{ name: 'HTML files', extensions: ['html'] }],
    });
    if (save.canceled || !save.filePath) {
      return { cancelled: true } satisfies ExportResult;
    }

    const htmlPath = getExportFilePath(save.filePath);
    const existing = [htmlPath].filter((filePath) => fs.existsSync(filePath));
    if (existing.length > 0) {
      const confirmation = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Overwrite', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Files already exist',
        message: 'Overwrite the existing HTML report?',
        detail: existing.join('\n'),
      });
      if (confirmation.response !== 0) {
        return { cancelled: true } satisfies ExportResult;
      }
    }

    const html = renderHtmlReport(report, {
      filters: request?.filters ?? {},
    });
    await writeExportFile(htmlPath, html);
    return {
      cancelled: false,
      htmlPath,
      summaryRows: report.summaryRows.length,
      sessionRows: report.sessionRows.length,
    } satisfies ExportResult;
  });

  handle('get-app-version', () => app.getVersion());

  handle('get-update-state', () => getUpdateState());

  handle('check-for-update', () => checkForUpdate());

  handle('download-update', () => downloadUpdate());

  handle('restart-to-update', () => restartToUpdate());

  handle('should-prompt-desktop-shortcut', () => shouldPromptForDesktopShortcut());

  handle('create-desktop-shortcut', async () => {
    const created = await createDesktopShortcut();
    logInfo(
      'shortcut',
      created ? 'Desktop shortcut created from the Desktop shortcut toast' : 'Desktop shortcut creation failed from the Desktop shortcut toast',
    );
    return created;
  });

  handle('get-logs', () => snapshot());

  handle('clear-logs', () => {
    clearLogs();
    logInfo('logs', 'Log buffer cleared from the Logs page');
    return snapshot();
  });

  handle('open-log-file', () => {
    const filePath = getLogFilePath();
    if (filePath) {
      shell.showItemInFolder(filePath);
    } else {
      logWarn('logs', 'No log file configured, cannot reveal it in the file explorer');
    }
    return filePath;
  });

  handle('open-external-url', (_event: unknown, value: unknown) => {
    return shell.openExternal(validateExternalRepositoryUrl(value));
  });

  handle('log-message', (_event: unknown, entry: RendererLogInput) => {
    recordRendererLog(entry ?? { level: 'info', scope: 'renderer', message: '(empty message)' });
  });
}

function validateAgentTraceCollectionEnabled(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new Error('Agent trace collection opt-in must be a boolean');
  }

  return value;
}

function validateAgentTraceSelection(value: unknown): AgentTraceSelection {
  if (!value || typeof value !== 'object') {
    throw new Error('Agent trace selection must be an object');
  }

  const { source, sessionId } = value as Partial<AgentTraceSelection>;
  if (source !== 'vscode' && source !== 'copilot-cli') {
    throw new Error('Agent trace selection source must be "vscode" or "copilot-cli"');
  }
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw new Error('Agent trace session id must be a non-empty string');
  }

  return {
    source,
    sessionId,
  };
}

function validateAgentTraceSessionListFilters(value: unknown): AgentTraceSessionListFilters {
  if (!value || typeof value !== 'object') {
    throw new Error('Agent trace session filters must be an object');
  }

  const candidate = value as Partial<AgentTraceSessionListFilters>;
  const query = validateSessionListQuery(candidate.query);
  const source = validateSessionListSource(candidate.source);
  const from = validateSessionListDate(candidate.from, 'from');
  const to = validateSessionListDate(candidate.to, 'to');
  const category = validateSessionListCategory(candidate.category);
  const status = validateSessionListStatus(candidate.status);
  const page = validateSessionListPage(candidate.page);

  if (from && to && from > to) {
    throw new Error('Agent trace session "from" date must be on or before "to"');
  }

  return {
    query,
    source,
    from,
    to,
    category,
    status,
    page,
  };
}

function validateSessionListQuery(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Agent trace session search query must be a string');
  }
  if (value.length > MAX_AGENT_TRACE_SESSION_SEARCH_LENGTH) {
    throw new Error('Agent trace session search query must be 200 characters or fewer');
  }
  return value;
}

function validateSessionListSource(value: unknown): AgentTraceSource | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || !AGENT_TRACE_SOURCES.includes(value as AgentTraceSource)) {
    throw new Error('Agent trace session list source must be "vscode", "copilot-cli", or null');
  }
  return value as AgentTraceSource;
}

function validateSessionListDate(value: unknown, field: 'from' | 'to'): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`Agent trace session "${field}" must be a calendar date in YYYY-MM-DD format`);
  }

  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Agent trace session "${field}" must be a calendar date in YYYY-MM-DD format`);
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) {
    throw new Error(`Agent trace session "${field}" must be a calendar date in YYYY-MM-DD format`);
  }

  return value;
}

function validateSessionListCategory(value: unknown): AgentTraceCategory | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || !AGENT_TRACE_CATEGORIES.includes(value as AgentTraceCategory)) {
    throw new Error('Agent trace session category must be one of "agent", "llm", "tool", "skill", "shell", "mcp", "hook", "other", or null');
  }
  return value as AgentTraceCategory;
}

function validateSessionListStatus(value: unknown): AgentTraceSessionListFilters['status'] {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || !AGENT_TRACE_STATUSES.includes(value as (typeof AGENT_TRACE_STATUSES)[number])) {
    throw new Error('Agent trace session status must be "unset", "ok", "error", or null');
  }
  return value as AgentTraceSessionListFilters['status'];
}

function validateSessionListPage(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('Agent trace session list page must be a safe non-negative integer');
  }
  return value as number;
}
