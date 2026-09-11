import { app, ipcMain, shell } from 'electron';
import Database from 'better-sqlite3';
import {
  openDatabase,
  buildMergedDatabase,
  DatabaseNotFoundError,
  getFilterOptions,
  getUsage,
  getProjectDetail,
  getRawTablePage,
  getHourlyDetail,
  getMonthlyActivity,
} from './db';
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
import type {
  HourlyDetailParams,
  LogsSnapshot,
  MonthlyActivityParams,
  RawTableParams,
  RendererLogInput,
  UsageFilters,
} from '../shared/types';
import type { VscodeUsageData } from './vscode-chat-store';

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
      const elapsed = Date.now() - startedAt;
      if (elapsed >= SLOW_CALL_MS && !UNTRACED_CHANNELS.has(channel)) {
        logWarn('ipc', `${channel} took ${elapsed}ms`);
      }
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

  handle('log-message', (_event: unknown, entry: RendererLogInput) => {
    recordRendererLog(entry ?? { level: 'info', scope: 'renderer', message: '(empty message)' });
  });
}
