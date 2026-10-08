import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { app, dialog, ipcMain, shell } from 'electron';
import Database from 'better-sqlite3';
import { registerAgentTraceIpcHandlers, registerIpcHandlers } from './ipc-handlers';
import { getLogEntries, resetLoggerForTests } from './logger';
import type {
  AgentTraceCollectionStatus,
  AgentTraceSelection,
  AgentTraceSession,
  AgentTraceSessionListFilters,
  AgentTraceSessionListPage,
} from '../shared/types';
import type { AgentTraceService } from './agent-trace-service';

const exportFilesMock = vi.hoisted(() => ({
  writeExportFile: vi.fn(),
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
      openExternal: vi.fn().mockResolvedValue(undefined),
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

vi.mock('./logger', async () => {
  const actual = await vi.importActual<typeof import('./logger')>('./logger');
  return {
    ...actual,
    logError: vi.fn(actual.logError),
  };
});

vi.mock('./export-files', async () => {
  const actual = await vi.importActual('./export-files').catch(() => ({}));
  const actualWriteExportFile = (actual as { writeExportFile?: (...args: unknown[]) => unknown }).writeExportFile;
  if (actualWriteExportFile) {
    exportFilesMock.writeExportFile.mockImplementation(actualWriteExportFile as (...args: unknown[]) => unknown);
  }
  return {
    ...(actual as object),
    writeExportFile: exportFilesMock.writeExportFile,
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
    resetLoggerForTests();
  });

  it('registers a get-filter-options and a get-usage handler', () => {
    registerIpcHandlers('/fake/path.db');

    expect(ipcMain.handle).toHaveBeenCalledWith('get-filter-options', expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith('get-usage', expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith('get-project-detail', expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith('get-raw-table-page', expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith('get-hourly-detail', expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith('get-export-preview', expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith('export-html', expect.any(Function));
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

  it('opens canonical GitHub repository URLs in the external browser', async () => {
    registerIpcHandlers('/fake/path.db');
    const handlers = (ipcMain as unknown as {
      __handlers: Map<string, (...args: unknown[]) => unknown>;
    }).__handlers;

    await expect(
      handlers.get('open-external-url')!({}, 'https://github.com/rtk-ai/rtk'),
    ).resolves.toBeUndefined();
    expect(shell.openExternal).toHaveBeenCalledWith('https://github.com/rtk-ai/rtk');
  });

  it.each([
    'http://github.com/rtk-ai/rtk',
    'https://github.com:443/rtk-ai/rtk',
    'https://evil.example/rtk-ai/rtk',
    'https://github.com/rtk-ai',
    'https://github.com/rtk-ai/rtk/issues',
    'https://github.com/rtk-ai/rtk/',
    'https://GitHub.com/rtk-ai/rtk',
    'https://github.com/rtk-ai/rtk%2Fissues',
    'https://github.com/rtk-ai/rtk?redirect=https://evil.example',
    'https://user:pass@github.com/rtk-ai/rtk',
    'https://github.com/rtk-ai/rtk#overview',
    'not a URL',
  ])('rejects unsafe external URL %s', async (value) => {
    registerIpcHandlers('/fake/path.db');
    const handlers = (ipcMain as unknown as {
      __handlers: Map<string, (...args: unknown[]) => unknown>;
    }).__handlers;

    vi.mocked(shell.openExternal).mockClear();

    expect(() => handlers.get('open-external-url')!({}, value)).toThrow(
      'Only GitHub repository URLs can be opened',
    );
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('logs invalid external URL validation failures through the IPC wrapper', () => {
    registerIpcHandlers('/fake/path.db');
    const handlers = (ipcMain as unknown as {
      __handlers: Map<string, (...args: unknown[]) => unknown>;
    }).__handlers;
    const entriesBefore = getLogEntries().length;

    expect(() => handlers.get('open-external-url')!({}, 'https://github.com:443/rtk-ai/rtk')).toThrow(
      'Only GitHub repository URLs can be opened',
    );

    expect(getLogEntries().slice(entriesBefore)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'error',
        scope: 'ipc',
        message: expect.stringContaining('open-external-url failed after'),
      }),
    ]));
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

  describe('registerAgentTraceIpcHandlers', () => {
    function createTraceServiceDouble(
      overrides: Partial<AgentTraceService> = {},
    ): Pick<AgentTraceService, 'getStatus' | 'setEnabled' | 'getSession' | 'getSessionCount' | 'listSessions' | 'clear'> {
      return {
        getStatus: vi.fn(() => ({
          enabled: false,
          listening: false,
          endpoint: null,
          errorMessage: null,
        } satisfies AgentTraceCollectionStatus)),
        setEnabled: vi.fn(async (enabled: boolean) => ({
          enabled,
          listening: enabled,
          endpoint: enabled ? 'http://127.0.0.1:4318' : null,
          errorMessage: null,
        } satisfies AgentTraceCollectionStatus)),
        getSession: vi.fn((selection: AgentTraceSelection) => ({
          source: selection.source,
          sessionId: selection.sessionId,
          availability: 'not-collected',
          spans: [],
        } satisfies AgentTraceSession)),
        getSessionCount: vi.fn(() => 2),
        listSessions: vi.fn((filters: AgentTraceSessionListFilters) => ({
          items: [{ source: 'vscode', sessionId: `session-page-${filters.page}`, spanCount: 3 }],
          total: 1,
          page: filters.page,
          pageSize: 50,
        } satisfies AgentTraceSessionListPage)),
        clear: vi.fn(),
        ...overrides,
      };
    }

    beforeEach(() => {
      vi.clearAllMocks();
      (ipcMain as unknown as { __handlers: Map<string, unknown> }).__handlers.clear();
      resetLoggerForTests();
    });

    it('registers the trace collection status, count, list, opt-in, session, and clear channels', () => {
      registerAgentTraceIpcHandlers(createTraceServiceDouble() as AgentTraceService);

      expect(ipcMain.handle).toHaveBeenCalledWith('get-agent-trace-collection-status', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('get-agent-trace-session-count', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('list-agent-trace-sessions', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('set-agent-trace-collection-enabled', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('get-agent-trace-session', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('clear-agent-trace-data', expect.any(Function));
    });

    it('returns the current trace collection status', () => {
      const service = createTraceServiceDouble();
      registerAgentTraceIpcHandlers(service as AgentTraceService);
      const handlers = (ipcMain as unknown as {
        __handlers: Map<string, (...args: unknown[]) => unknown>;
      }).__handlers;

      expect(handlers.get('get-agent-trace-collection-status')!({})).toEqual({
        enabled: false,
        listening: false,
        endpoint: null,
        errorMessage: null,
      });
      expect(service.getStatus).toHaveBeenCalledTimes(1);
    });

    it('validates enabled before forwarding opt-in updates to the service', async () => {
      const service = createTraceServiceDouble();
      registerAgentTraceIpcHandlers(service as AgentTraceService);
      const handlers = (ipcMain as unknown as {
        __handlers: Map<string, (...args: unknown[]) => unknown>;
      }).__handlers;

      await expect(handlers.get('set-agent-trace-collection-enabled')!({}, true)).resolves.toEqual({
        enabled: true,
        listening: true,
        endpoint: 'http://127.0.0.1:4318',
        errorMessage: null,
      });
      expect(service.setEnabled).toHaveBeenCalledWith(true);

      expect(() => handlers.get('set-agent-trace-collection-enabled')!({}, 'true')).toThrow(
        'Agent trace collection opt-in must be a boolean',
      );
      expect(service.setEnabled).toHaveBeenCalledTimes(1);
    });

    it('returns the exact stored trace session count', () => {
      const service = createTraceServiceDouble({
        getSessionCount: vi.fn(() => 42),
      });
      registerAgentTraceIpcHandlers(service as AgentTraceService);
      const handlers = (ipcMain as unknown as {
        __handlers: Map<string, (...args: unknown[]) => unknown>;
      }).__handlers;

      expect(handlers.get('get-agent-trace-session-count')!({})).toBe(42);
      expect(service.getSessionCount).toHaveBeenCalledTimes(1);
    });

    it('validates filters before listing agent trace sessions', () => {
      const page: AgentTraceSessionListPage = {
        items: [{ source: 'copilot-cli', sessionId: 'cli-session', spanCount: 7 }],
        total: 1,
        page: 2,
        pageSize: 50,
      };
      const service = createTraceServiceDouble({
        listSessions: vi.fn(() => page),
      });
      registerAgentTraceIpcHandlers(service as AgentTraceService);
      const handlers = (ipcMain as unknown as {
        __handlers: Map<string, (...args: unknown[]) => unknown>;
      }).__handlers;
      const validFilters = makeSessionFilters({
        query: 'model-a',
        source: 'copilot-cli',
        from: '2026-09-24',
        to: '2026-09-25',
        category: 'tool',
        status: 'error',
        page: 2,
      });

      expect(handlers.get('list-agent-trace-sessions')!({}, validFilters)).toBe(page);
      expect(service.listSessions).toHaveBeenCalledWith(validFilters);

      expect(() => handlers.get('list-agent-trace-sessions')!({}, null)).toThrow(
        'Agent trace session filters must be an object',
      );
      expect(() => handlers.get('list-agent-trace-sessions')!({}, 'bad')).toThrow(
        'Agent trace session filters must be an object',
      );
      expect(() => handlers.get('list-agent-trace-sessions')!({}, makeSessionFilters({ page: -1 }))).toThrow(
        'Agent trace session list page must be a safe non-negative integer',
      );
      expect(() => handlers.get('list-agent-trace-sessions')!({}, makeSessionFilters({ page: 1.5 }))).toThrow(
        'Agent trace session list page must be a safe non-negative integer',
      );
      expect(
        () => handlers.get('list-agent-trace-sessions')!({}, makeSessionFilters({ page: Number.MAX_SAFE_INTEGER + 1 })),
      ).toThrow('Agent trace session list page must be a safe non-negative integer');
      expect(() => handlers.get('list-agent-trace-sessions')!({}, makeSessionFilters({ source: 'other' as never }))).toThrow(
        'Agent trace session list source must be "vscode", "copilot-cli", or null',
      );
      expect(() => handlers.get('list-agent-trace-sessions')!({}, makeSessionFilters({ category: 'invalid' as never }))).toThrow(
        'Agent trace session category must be one of "agent", "llm", "tool", "skill", "shell", "mcp", "hook", "other", or null',
      );
      expect(() => handlers.get('list-agent-trace-sessions')!({}, makeSessionFilters({ status: 'invalid' as never }))).toThrow(
        'Agent trace session status must be "unset", "ok", "error", or null',
      );
      expect(() => handlers.get('list-agent-trace-sessions')!({}, makeSessionFilters({ from: '2026-2-30' }))).toThrow(
        'Agent trace session "from" must be a calendar date in YYYY-MM-DD format',
      );
      expect(() => handlers.get('list-agent-trace-sessions')!({}, makeSessionFilters({ to: '2026-02-30' }))).toThrow(
        'Agent trace session "to" must be a calendar date in YYYY-MM-DD format',
      );
      expect(
        () => handlers.get('list-agent-trace-sessions')!({}, makeSessionFilters({ from: '2026-09-26', to: '2026-09-25' })),
      ).toThrow('Agent trace session "from" date must be on or before "to"');
      expect(() => handlers.get('list-agent-trace-sessions')!({}, makeSessionFilters({ query: 'x'.repeat(201) }))).toThrow(
        'Agent trace session search query must be 200 characters or fewer',
      );
      expect(service.listSessions).toHaveBeenCalledTimes(1);
    });

    it('validates session selection before reading agent trace sessions', () => {
      const service = createTraceServiceDouble();
      registerAgentTraceIpcHandlers(service as AgentTraceService);
      const handlers = (ipcMain as unknown as {
        __handlers: Map<string, (...args: unknown[]) => unknown>;
      }).__handlers;

      expect(
        handlers.get('get-agent-trace-session')!({}, { source: 'vscode', sessionId: 'vscode:conversation-1' }),
      ).toEqual({
        source: 'vscode',
        sessionId: 'vscode:conversation-1',
        availability: 'not-collected',
        spans: [],
      });
      expect(service.getSession).toHaveBeenCalledWith({
        source: 'vscode',
        sessionId: 'vscode:conversation-1',
      });

      expect(() => handlers.get('get-agent-trace-session')!({}, null)).toThrow(
        'Agent trace selection must be an object',
      );
      expect(() => handlers.get('get-agent-trace-session')!({}, { source: 'other', sessionId: 'x' })).toThrow(
        'Agent trace selection source must be "vscode" or "copilot-cli"',
      );
      expect(() => handlers.get('get-agent-trace-session')!({}, { source: 'vscode', sessionId: '' })).toThrow(
        'Agent trace session id must be a non-empty string',
      );
      expect(service.getSession).toHaveBeenCalledTimes(1);
    });

    it('clears persisted trace spans through the service', async () => {
      const service = createTraceServiceDouble();
      registerAgentTraceIpcHandlers(service as AgentTraceService);
      const handlers = (ipcMain as unknown as {
        __handlers: Map<string, (...args: unknown[]) => unknown>;
      }).__handlers;

      expect(handlers.get('clear-agent-trace-data')!({})).toBeUndefined();
      expect(service.clear).toHaveBeenCalledTimes(1);
    });

    it('logs and rethrows trace service failures through the shared ipc wrapper', async () => {
      const failure = new Error('trace status unavailable');
      const service = createTraceServiceDouble({
        getStatus: vi.fn(() => {
          throw failure;
        }),
      });
      registerAgentTraceIpcHandlers(service as AgentTraceService);
      const handlers = (ipcMain as unknown as {
        __handlers: Map<string, (...args: unknown[]) => unknown>;
      }).__handlers;
      const entriesBefore = getLogEntries().length;

      expect(() => handlers.get('get-agent-trace-collection-status')!({})).toThrow('trace status unavailable');
      expect(getLogEntries().slice(entriesBefore)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          scope: 'ipc',
          message: expect.stringContaining('get-agent-trace-collection-status failed after'),
        }),
      ]));
    });
  });

  function makeSessionFilters(overrides: Partial<AgentTraceSessionListFilters> = {}): AgentTraceSessionListFilters {
    return {
      query: '',
      source: null,
      from: null,
      to: null,
      category: null,
      status: null,
      page: 0,
      ...overrides,
    };
  }

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

    await expect(handlers.get('export-html')!({}, { filters: {} })).resolves.toEqual({
      cancelled: true,
    });
    expect(dialog.showSaveDialog).toHaveBeenCalledWith({
      title: 'Export Copilot usage',
      defaultPath: 'copilot-usage.html',
      filters: [{ name: 'HTML files', extensions: ['html'] }],
    });
    expect(exportFilesMock.writeExportFile).not.toHaveBeenCalled();
  });

  it('writes one HTML file after overwrite confirmation', async () => {
    const exportRoot = createExportTestDirectory();
    const selectedPath = path.join(exportRoot, 'usage.csv');
    const htmlPath = path.join(exportRoot, 'usage.html');
    fs.writeFileSync(htmlPath, 'old-html', 'utf8');
    (dialog.showSaveDialog as Mock).mockResolvedValueOnce({ canceled: false, filePath: selectedPath });
    (dialog.showMessageBox as Mock).mockResolvedValueOnce({ response: 0 });

    try {
      registerIpcHandlers('/fake/path.db');
      const handlers = (ipcMain as unknown as {
        __handlers: Map<string, (...args: unknown[]) => unknown>;
      }).__handlers;
      await expect(
        handlers.get('export-html')!({}, { filters: {}, suggestedName: 'usage.html' }),
      ).resolves.toEqual({
        cancelled: false,
        htmlPath,
        summaryRows: 0,
        sessionRows: 0,
      });

      expect(dialog.showMessageBox).toHaveBeenCalledWith({
        type: 'warning',
        buttons: ['Overwrite', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Files already exist',
        message: 'Overwrite the existing HTML report?',
        detail: htmlPath,
      });

      expect(fs.existsSync(htmlPath)).toBe(true);
      expect(fs.readFileSync(htmlPath, 'utf8')).toContain('<!doctype html>');
      expect(fs.existsSync(selectedPath)).toBe(false);
      expect(fs.readdirSync(exportRoot)).toEqual(['usage.html']);
    } finally {
      fs.rmSync(exportRoot, { recursive: true, force: true });
    }
  });

  it('returns cancelled when overwrite confirmation is declined', async () => {
    const exportRoot = createExportTestDirectory();
    const selectedPath = path.join(exportRoot, 'usage.csv');
    const htmlPath = path.join(exportRoot, 'usage.html');
    fs.writeFileSync(htmlPath, 'keep-html', 'utf8');
    (dialog.showSaveDialog as Mock).mockResolvedValueOnce({ canceled: false, filePath: selectedPath });
    (dialog.showMessageBox as Mock).mockResolvedValueOnce({ response: 1 });

    try {
      registerIpcHandlers('/fake/path.db');
      const handlers = (ipcMain as unknown as {
        __handlers: Map<string, (...args: unknown[]) => unknown>;
      }).__handlers;

      await expect(handlers.get('export-html')!({}, { filters: {} })).resolves.toEqual({
        cancelled: true,
      });
      expect(exportFilesMock.writeExportFile).not.toHaveBeenCalled();
      expect(fs.readFileSync(htmlPath, 'utf8')).toBe('keep-html');
      expect(fs.existsSync(selectedPath)).toBe(false);
    } finally {
      fs.rmSync(exportRoot, { recursive: true, force: true });
    }
  });

  it('preserves export write failures and logs the async rejection with the channel name', async () => {
    const { logError } = await import('./logger');
    const writeFailed = new Error('write failed');
    exportFilesMock.writeExportFile.mockRejectedValueOnce(writeFailed);
    (dialog.showSaveDialog as Mock).mockResolvedValueOnce({
      canceled: false,
      filePath: 'C:\\exports\\usage.html',
    });
    registerIpcHandlers('/fake/path.db');
    const handlers = (ipcMain as unknown as {
      __handlers: Map<string, (...args: unknown[]) => unknown>;
    }).__handlers;

    await expect(handlers.get('export-html')!({}, { filters: {} })).rejects.toThrow('write failed');
    expect(logError).toHaveBeenCalledWith(
      'ipc',
      expect.stringContaining('export-html'),
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
