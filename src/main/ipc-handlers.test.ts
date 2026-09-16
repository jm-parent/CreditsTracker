import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { app, dialog, ipcMain } from 'electron';
import Database from 'better-sqlite3';
import { getExportFilePaths, SESSION_HEADERS, SUMMARY_HEADERS } from './csv';
import { registerIpcHandlers } from './ipc-handlers';

const exportFilesMock = vi.hoisted(() => ({
  writeExportFiles: vi.fn(),
}));

function createExportTestDirectory(): string {
  const directory = path.join(
    process.cwd(),
    '.test-artifacts',
    `credits-tracker-export-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

vi.mock('electron', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    app: {
      getVersion: vi.fn(),
    },
    shell: {
      showItemInFolder: vi.fn(),
    },
    dialog: {
      showSaveDialog: vi.fn(),
      showMessageBox: vi.fn(),
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

vi.mock('./shortcut', () => ({
  shouldPromptForDesktopShortcut: vi.fn(() => true),
  createDesktopShortcut: vi.fn().mockResolvedValue(true),
}));

vi.mock('./logger', () => ({
  clearLogs: vi.fn(),
  getLogEntries: vi.fn(() => []),
  getLogFilePath: vi.fn(() => null),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logOnce: vi.fn(),
  logWarn: vi.fn(),
  recordRendererLog: vi.fn(),
}));

vi.mock('./export-files', async () => {
  const actual = await vi.importActual('./export-files').catch(() => ({}));
  const actualWriteExportFiles = (actual as { writeExportFiles?: (...args: unknown[]) => unknown }).writeExportFiles;
  if (actualWriteExportFiles) {
    exportFilesMock.writeExportFiles.mockImplementation(actualWriteExportFiles as (...args: unknown[]) => unknown);
  }
  return {
    ...(actual as object),
    writeExportFiles: exportFilesMock.writeExportFiles,
  };
});

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
    expect(ipcMain.handle).toHaveBeenCalledWith('get-export-preview', expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith('export-csv', expect.any(Function));
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

  it('exposes the desktop shortcut prompt channels', async () => {
    const shortcut = await import('./shortcut');
    registerIpcHandlers('/fake/path.db');
    const handlers = (ipcMain as unknown as {
      __handlers: Map<string, (...args: unknown[]) => unknown>;
    }).__handlers;

    expect(handlers.get('should-prompt-desktop-shortcut')!({})).toBe(true);
    await expect(handlers.get('create-desktop-shortcut')!({})).resolves.toBe(true);

    expect(shortcut.shouldPromptForDesktopShortcut).toHaveBeenCalled();
    expect(shortcut.createDesktopShortcut).toHaveBeenCalled();
  });

  it('reports false through create-desktop-shortcut when creation fails', async () => {
    const shortcut = await import('./shortcut');
    (shortcut.createDesktopShortcut as unknown as Mock).mockResolvedValueOnce(false);
    registerIpcHandlers('/fake/path.db');
    const handlers = (ipcMain as unknown as {
      __handlers: Map<string, (...args: unknown[]) => unknown>;
    }).__handlers;

    await expect(handlers.get('create-desktop-shortcut')!({})).resolves.toBe(false);
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

  it('registers and returns an empty export preview', async () => {
    registerIpcHandlers('/fake/path.db');
    const handlers = (ipcMain as unknown as {
      __handlers: Map<string, (...args: unknown[]) => unknown>;
    }).__handlers;

    expect(handlers.get('get-export-preview')!({}, {})).toEqual({
      totals: { aiuCredits: 0, tokens: 0, requests: 0 },
      sessionCount: 0,
      activeDays: 0,
      byModel: [],
      daily: [],
    });
  });

  it('returns cancelled without writing when the save dialog is cancelled', async () => {
    (dialog.showSaveDialog as Mock).mockResolvedValueOnce({ canceled: true, filePath: '' });
    registerIpcHandlers('/fake/path.db');
    const handlers = (ipcMain as unknown as {
      __handlers: Map<string, (...args: unknown[]) => unknown>;
    }).__handlers;

    await expect(handlers.get('export-csv')!({}, { filters: {} })).resolves.toEqual({
      cancelled: true,
    });
    expect(dialog.showSaveDialog).toHaveBeenCalledWith({
      title: 'Export Copilot usage',
      defaultPath: 'copilot-usage.csv',
      filters: [{ name: 'CSV files', extensions: ['csv'] }],
    });
    expect(exportFilesMock.writeExportFiles).not.toHaveBeenCalled();
  });

  it('writes both CSV files with BOM and headers after overwrite confirmation', async () => {
    const exportRoot = createExportTestDirectory();
    const selectedPath = path.join(exportRoot, 'usage.csv');
    const paths = getExportFilePaths(selectedPath);
    fs.writeFileSync(paths.summaryPath, 'old-summary', 'utf8');
    fs.writeFileSync(paths.sessionsPath, 'old-sessions', 'utf8');
    (dialog.showSaveDialog as Mock).mockResolvedValueOnce({ canceled: false, filePath: selectedPath });
    (dialog.showMessageBox as Mock).mockResolvedValueOnce({ response: 0 });

    try {
      registerIpcHandlers('/fake/path.db');
      const handlers = (ipcMain as unknown as {
        __handlers: Map<string, (...args: unknown[]) => unknown>;
      }).__handlers;

      await expect(
        handlers.get('export-csv')!({}, { filters: {}, suggestedName: 'usage.csv' }),
      ).resolves.toEqual({
        cancelled: false,
        summaryPath: paths.summaryPath,
        sessionsPath: paths.sessionsPath,
        summaryRows: 0,
        sessionRows: 0,
      });

      expect(dialog.showMessageBox).toHaveBeenCalledWith({
        type: 'warning',
        buttons: ['Overwrite', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Files already exist',
        message: 'Overwrite the existing CSV files?',
        detail: [paths.summaryPath, paths.sessionsPath].join('\n'),
      });

      expect(fs.existsSync(paths.summaryPath)).toBe(true);
      expect(fs.existsSync(paths.sessionsPath)).toBe(true);
      expect(fs.readFileSync(paths.summaryPath, 'utf8')).toBe(`\uFEFF${SUMMARY_HEADERS.join(';')}\r\n`);
      expect(fs.readFileSync(paths.sessionsPath, 'utf8')).toBe(`\uFEFF${SESSION_HEADERS.join(';')}\r\n`);
    } finally {
      fs.rmSync(exportRoot, { recursive: true, force: true });
    }
  });

  it('returns cancelled when overwrite confirmation is declined', async () => {
    const exportRoot = createExportTestDirectory();
    const selectedPath = path.join(exportRoot, 'usage.csv');
    const paths = getExportFilePaths(selectedPath);
    fs.writeFileSync(paths.summaryPath, 'keep-summary', 'utf8');
    fs.writeFileSync(paths.sessionsPath, 'keep-sessions', 'utf8');
    (dialog.showSaveDialog as Mock).mockResolvedValueOnce({ canceled: false, filePath: selectedPath });
    (dialog.showMessageBox as Mock).mockResolvedValueOnce({ response: 1 });

    try {
      registerIpcHandlers('/fake/path.db');
      const handlers = (ipcMain as unknown as {
        __handlers: Map<string, (...args: unknown[]) => unknown>;
      }).__handlers;

      await expect(handlers.get('export-csv')!({}, { filters: {} })).resolves.toEqual({
        cancelled: true,
      });
      expect(exportFilesMock.writeExportFiles).not.toHaveBeenCalled();
      expect(fs.readFileSync(paths.summaryPath, 'utf8')).toBe('keep-summary');
      expect(fs.readFileSync(paths.sessionsPath, 'utf8')).toBe('keep-sessions');
    } finally {
      fs.rmSync(exportRoot, { recursive: true, force: true });
    }
  });

  it('preserves export write failures and logs the async rejection with the channel name', async () => {
    const { logError } = await import('./logger');
    const writeFailed = new Error('write failed');
    exportFilesMock.writeExportFiles.mockRejectedValueOnce(writeFailed);
    (dialog.showSaveDialog as Mock).mockResolvedValueOnce({
      canceled: false,
      filePath: 'C:\\exports\\usage.csv',
    });
    registerIpcHandlers('/fake/path.db');
    const handlers = (ipcMain as unknown as {
      __handlers: Map<string, (...args: unknown[]) => unknown>;
    }).__handlers;

    await expect(handlers.get('export-csv')!({}, { filters: {} })).rejects.toThrow('write failed');
    expect(logError).toHaveBeenCalledWith(
      'ipc',
      expect.stringContaining('export-csv'),
      writeFailed,
    );
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
