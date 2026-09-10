import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { app, ipcMain } from 'electron';
import Database from 'better-sqlite3';
import { registerIpcHandlers } from './ipc-handlers';

vi.mock('electron', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    app: {
      getVersion: vi.fn(),
    },
    shell: {
      showItemInFolder: vi.fn(),
    },
    ipcMain: {
      handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
        handlers.set(channel, listener);
      }),
      __handlers: handlers,
    },
  };
});

vi.mock('./updater', () => ({
  getUpdateState: vi.fn(() => ({ status: 'up-to-date', currentVersion: '1.4.1' })),
  checkForUpdate: vi.fn(),
  downloadUpdate: vi.fn(() => ({ status: 'downloading', currentVersion: '1.4.1' })),
  restartToUpdate: vi.fn(),
}));

vi.mock('./db', async () => {
  const actual = await vi.importActual<typeof import('./db')>('./db');
  return {
    ...actual,
    openDatabase: vi.fn(() => {
      const db = new Database(':memory:');
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          cwd TEXT,
          repository TEXT,
          summary TEXT,
          created_at TEXT
        );
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
      return db;
    }),
  };
});

describe('registerIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (ipcMain as unknown as { __handlers: Map<string, unknown> }).__handlers.clear();
  });

  it('registers a get-filter-options and a get-usage handler', () => {
    registerIpcHandlers('/fake/path.db');

    expect(ipcMain.handle).toHaveBeenCalledWith('get-filter-options', expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith('get-usage', expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith('get-project-detail', expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith('get-raw-table-page', expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith('get-hourly-detail', expect.any(Function));
  });

  it('returns Electron application version through get-app-version', () => {
    (app.getVersion as Mock).mockReturnValue('1.4.1');
    registerIpcHandlers('/fake/path.db');
    const handlers = (ipcMain as unknown as {
      __handlers: Map<string, (...args: unknown[]) => unknown>;
    }).__handlers;

    expect(handlers.get('get-app-version')!({})).toBe('1.4.1');
  });

  it('exposes the user-driven update channels', () => {
    registerIpcHandlers('/fake/path.db');
    const handlers = (ipcMain as unknown as {
      __handlers: Map<string, (...args: unknown[]) => unknown>;
    }).__handlers;

    expect(handlers.get('get-update-state')!({})).toEqual({
      status: 'up-to-date',
      currentVersion: '1.4.1',
    });
    expect(handlers.get('download-update')!({})).toEqual({
      status: 'downloading',
      currentVersion: '1.4.1',
    });
    expect(ipcMain.handle).toHaveBeenCalledWith('check-for-update', expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith('restart-to-update', expect.any(Function));
  });

  it('get-usage handler forwards filters and returns a UsageResult shape', async () => {
    registerIpcHandlers('/fake/path.db');
    const handlers = (ipcMain as unknown as { __handlers: Map<string, (...args: unknown[]) => unknown> }).__handlers;
    const getUsageHandler = handlers.get('get-usage')!;

    const result = await getUsageHandler({}, { project: 'org/repo-a' });

    expect(result).toEqual({
      totals: { aiuCredits: 0, tokens: 0, requests: 0 },
      timeSeries: [],
      byProject: [],
      byModel: [],
    });
  });

  it('get-project-detail handler forwards filters and returns a ProjectDetailResult shape', async () => {
    registerIpcHandlers('/fake/path.db');
    const handlers = (ipcMain as unknown as { __handlers: Map<string, (...args: unknown[]) => unknown> }).__handlers;
    const getProjectDetailHandler = handlers.get('get-project-detail')!;

    const result = await getProjectDetailHandler({}, { project: 'org/repo-a' });

    expect(result).toEqual({
      project: 'org/repo-a',
      totals: { aiuCredits: 0, tokens: 0, requests: 0 },
      timeSeries: [],
      conversations: [],
    });
  });

  it('get-raw-table-page handler forwards params and returns a RawTablePage shape', async () => {
    registerIpcHandlers('/fake/path.db');
    const handlers = (ipcMain as unknown as { __handlers: Map<string, (...args: unknown[]) => unknown> }).__handlers;
    const getRawTablePageHandler = handlers.get('get-raw-table-page')!;

    const result = await getRawTablePageHandler({}, { table: 'sessions', page: 0, pageSize: 10 });

    expect(result).toEqual({
      columns: ['id', 'cwd', 'repository', 'summary', 'created_at'],
      rows: [],
      total: 0,
      page: 0,
      pageSize: 10,
    });
  });

  it('get-hourly-detail handler forwards params and returns an array of hourly points', async () => {
    registerIpcHandlers('/fake/path.db');
    const handlers = (ipcMain as unknown as { __handlers: Map<string, (...args: unknown[]) => unknown> }).__handlers;
    const getHourlyDetailHandler = handlers.get('get-hourly-detail')!;

    const result = await getHourlyDetailHandler({}, { date: '2026-09-01' });

    expect(result).toEqual([]);
  });

  it('rebuilds the merged database from disk after the refresh interval elapses, so new usage becomes visible without an app restart', async () => {
    const { openDatabase } = await import('./db');
    vi.useFakeTimers();
    try {
      registerIpcHandlers('/fake/path.db');
      const handlers = (ipcMain as unknown as { __handlers: Map<string, (...args: unknown[]) => unknown> })
        .__handlers;
      const getUsageHandler = handlers.get('get-usage')!;

      // openDatabase is called once during registration to build the initial db.
      expect(openDatabase).toHaveBeenCalledTimes(1);

      // Calls within the refresh window reuse the same in-memory db.
      await getUsageHandler({}, {});
      await getUsageHandler({}, {});
      expect(openDatabase).toHaveBeenCalledTimes(1);

      // Once the refresh interval elapses, the next call rebuilds from disk.
      vi.advanceTimersByTime(5_000);
      await getUsageHandler({}, {});
      expect(openDatabase).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
