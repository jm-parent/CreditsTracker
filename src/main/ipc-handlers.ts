import { ipcMain } from 'electron';
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
} from './db';
import { loadVscodeUsage } from './vscode-chat-store';
import type { HourlyDetailParams, RawTableParams, UsageFilters } from '../shared/types';
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
export function registerIpcHandlers(dbPath: string, workspaceStorageDir?: string): void {
  let cliDb: Database.Database;
  try {
    cliDb = openDatabase(dbPath);
  } catch (error) {
    if (!(error instanceof DatabaseNotFoundError)) {
      throw error;
    }
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
      console.error('Failed to load VS Code Copilot Chat usage:', error);
    }
  }

  const db = buildMergedDatabase(cliDb, vscodeData);

  ipcMain.handle('get-filter-options', () => {
    return getFilterOptions(db);
  });

  ipcMain.handle('get-usage', (_event, filters: UsageFilters) => {
    return getUsage(db, filters ?? {});
  });

  ipcMain.handle('get-project-detail', (_event, params: UsageFilters & { project: string }) => {
    return getProjectDetail(db, params);
  });

  ipcMain.handle('get-raw-table-page', (_event, params: RawTableParams) => {
    return getRawTablePage(db, params.table, params.page, params.pageSize);
  });

  ipcMain.handle('get-hourly-detail', (_event, params: HourlyDetailParams) => {
    return getHourlyDetail(db, params);
  });
}
