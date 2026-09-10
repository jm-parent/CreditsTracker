import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { app, autoUpdater, BrowserWindow } from 'electron';
import {
  checkForUpdate,
  downloadUpdate,
  getUpdateState,
  restartToUpdate,
  startUpdateChecks,
  stopUpdateChecks,
} from './updater';

const listeners = new Map<string, (...args: unknown[]) => void>();
const send = vi.fn();

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: vi.fn(() => '1.5.0'),
  },
  autoUpdater: {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn(),
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

vi.mock('./logger', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

/** Fires an `autoUpdater` event the module registered a listener for. */
function emit(event: string, ...args: unknown[]): void {
  listeners.get(event)?.(...args);
}

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  stopUpdateChecks();
  (app as unknown as { isPackaged: boolean }).isPackaged = true;
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
  (autoUpdater.on as Mock).mockImplementation((event: string, listener: (...args: unknown[]) => void) => {
    listeners.set(event, listener);
    return autoUpdater;
  });
  (BrowserWindow.getAllWindows as Mock).mockReturnValue([
    { isDestroyed: () => false, webContents: { send } },
  ]);
});

describe('checkForUpdate', () => {
  it('reports the app as up to date when the feed answers 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204, ok: true }));

    const state = await checkForUpdate();

    expect(state.status).toBe('up-to-date');
    expect(state.latestVersion).toBeUndefined();
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('exposes the offered release without downloading it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ name: 'v1.6.0', notes: 'Adds the update dialog' }),
      }),
    );

    const state = await checkForUpdate();

    expect(state.status).toBe('available');
    expect(state.latestVersion).toBe('1.6.0');
    expect(state.releaseNotes).toBe('Adds the update dialog');
    // Nothing is fetched from Squirrel until the user accepts the update.
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('update-state-changed', expect.objectContaining({ status: 'available' }));
  });

  it('surfaces a failing feed as an error state instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const state = await checkForUpdate();

    expect(state.status).toBe('error');
    expect(state.error).toBe('offline');
  });

  it('reports unsupported builds without hitting the network', async () => {
    (app as unknown as { isPackaged: boolean }).isPackaged = false;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const state = await checkForUpdate();

    expect(state.status).toBe('unsupported');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('downloadUpdate', () => {
  it('starts the Squirrel download and reaches the ready state', () => {
    const downloading = downloadUpdate();

    expect(downloading.status).toBe('downloading');
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
      url: `https://update.electronjs.org/jm-parent/CreditsTracker/win32-${process.arch}/1.5.0`,
    });
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    emit('update-downloaded', {}, 'Release notes', 'v1.6.0');

    expect(getUpdateState()).toMatchObject({ status: 'ready', latestVersion: '1.6.0' });
  });

  it('reports a Squirrel failure as an error state', () => {
    downloadUpdate();
    emit('error', new Error('no RELEASES file'));

    expect(getUpdateState()).toMatchObject({ status: 'error', error: 'no RELEASES file' });
  });

  it('does not restart the app while no update is staged', () => {
    restartToUpdate();

    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('restarts the app once the update is staged', () => {
    downloadUpdate();
    emit('update-downloaded', {}, 'notes', 'v1.6.0');

    restartToUpdate();

    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});

describe('startUpdateChecks', () => {
  it('checks once on startup and schedules the recurring check', () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ status: 204, ok: true });
    vi.stubGlobal('fetch', fetchMock);

    startUpdateChecks();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4 * 60 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Still no download without an explicit user action.
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();

    stopUpdateChecks();
    vi.useRealTimers();
  });
});
