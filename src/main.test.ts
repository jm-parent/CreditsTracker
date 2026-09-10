import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { startUpdateChecks } from './main/updater';

const mockedWhenReadyThen = vi.hoisted(() => vi.fn());
const mockedSpawn = vi.hoisted(() => vi.fn(() => ({ unref: vi.fn(), on: vi.fn() })));

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    quit: vi.fn(),
    whenReady: vi.fn(() => ({ then: mockedWhenReadyThen })),
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  __esModule: true,
  default: { spawn: mockedSpawn },
  spawn: mockedSpawn,
}));

vi.mock('./main/ipc-handlers', () => ({
  registerIpcHandlers: vi.fn(),
}));

vi.mock('./main/updater', () => ({
  startUpdateChecks: vi.fn(),
}));

vi.mock('./main/db', () => ({
  resolveDefaultDbPath: vi.fn(() => 'C:\\fake\\session-store.db'),
  DatabaseNotFoundError: class DatabaseNotFoundError extends Error {},
}));

vi.mock('./main/vscode-chat-store', () => ({
  resolveDefaultWorkspaceStorageDir: vi.fn(() => 'C:\\fake\\workspace-storage'),
}));

describe('main process startup', () => {
  const originalArgv = process.argv.slice();
  const originalExecPathDescriptor = Object.getOwnPropertyDescriptor(process, 'execPath');
  const installedExePath = 'C:\\Users\\jm-parent\\AppData\\Local\\CreditsTracker\\app-1.4.1\\CreditsTracker.exe';
  const expectedUpdateExePath = path.win32.resolve(path.win32.dirname(installedExePath), '..', 'Update.exe');
  const expectedShortcutArgs = ['--createShortcut', 'CreditsTracker.exe'];

  async function importMainFor(argv: string[]): Promise<void> {
    process.argv = argv;
    Object.defineProperty(process, 'execPath', {
      configurable: true,
      value: installedExePath,
    });

    await import('./main');
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockedWhenReadyThen.mockReset();
    process.argv = originalArgv.slice();
    if (originalExecPathDescriptor) {
      Object.defineProperty(process, 'execPath', originalExecPathDescriptor);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates Desktop and Start menu shortcuts during Squirrel install and stops startup', async () => {
    await importMainFor(['CreditsTracker.exe', '--squirrel-install']);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(mockedSpawn.mock.calls[0]?.[0]).toBe(expectedUpdateExePath);
    expect(mockedSpawn.mock.calls[0]?.[1]).toEqual(expectedShortcutArgs);
    // Squirrel quits after a short delay (not immediately) so Update.exe has
    // time to finish writing the shortcuts before the app process exits.
    vi.advanceTimersByTime(1_000);
    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(startUpdateChecks).not.toHaveBeenCalled();
    expect(app.whenReady).not.toHaveBeenCalled();
    expect(app.on).not.toHaveBeenCalled();
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it('creates Desktop and Start menu shortcuts during Squirrel update and stops startup', async () => {
    await importMainFor(['CreditsTracker.exe', '--squirrel-updated']);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(mockedSpawn.mock.calls[0]?.[0]).toBe(expectedUpdateExePath);
    expect(mockedSpawn.mock.calls[0]?.[1]).toEqual(expectedShortcutArgs);
    vi.advanceTimersByTime(1_000);
    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(startUpdateChecks).not.toHaveBeenCalled();
    expect(app.whenReady).not.toHaveBeenCalled();
    expect(app.on).not.toHaveBeenCalled();
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it('keeps ordinary launches on the normal startup path', async () => {
    await importMainFor(['CreditsTracker.exe']);

    expect(spawn).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
    expect(app.whenReady).toHaveBeenCalledTimes(1);
    expect(app.on).toHaveBeenCalledWith('window-all-closed', expect.any(Function));
  });

  it('ignores unhandled Squirrel events and keeps the normal startup path', async () => {
    await importMainFor(['CreditsTracker.exe', '--squirrel-uninstall']);

    expect(spawn).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
    expect(app.whenReady).toHaveBeenCalledTimes(1);
    expect(app.on).toHaveBeenCalledWith('window-all-closed', expect.any(Function));
  });
});
