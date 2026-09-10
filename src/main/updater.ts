import { app, autoUpdater, BrowserWindow } from 'electron';
import { logError, logInfo, logWarn } from './logger';
import type { UpdateState } from '../shared/types';

/**
 * GitHub repository whose Releases feed the app updates from. It is served
 * through Electron's public update service (update.electronjs.org), which
 * exposes both the availability endpoint used by {@link checkForUpdate} and
 * the Squirrel endpoints used by Electron's built-in `autoUpdater`.
 */
const REPO = 'jm-parent/CreditsTracker';
const FEED_HOST = 'https://update.electronjs.org';

/**
 * Delay between two automatic availability checks. Checking is a single
 * lightweight request that never downloads anything, so a few hours is
 * frequent enough to surface a release the same day without being noisy.
 */
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * The channel the main process pushes state changes on. The renderer keeps a
 * mirror of {@link UpdateState} so the version badge and the update dialog
 * react to background checks without polling.
 */
export const UPDATE_STATE_CHANNEL = 'update-state-changed';

let state: UpdateState = { status: 'checking', currentVersion: '0.0.0' };
let intervalHandle: ReturnType<typeof setInterval> | undefined;
let autoUpdaterWired = false;

function feedUrl(): string {
  return `${FEED_HOST}/${REPO}/${process.platform}-${process.arch}/${app.getVersion()}`;
}

export function getUpdateState(): UpdateState {
  return state;
}

function setState(patch: Partial<UpdateState>): UpdateState {
  state = { ...state, ...patch };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(UPDATE_STATE_CHANNEL, state);
    }
  }
  return state;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Squirrel only exists for packaged Windows and macOS builds, so anywhere
 * else (notably `npm start`) the whole feature is reported as unsupported and
 * the renderer hides the update affordance entirely.
 */
function isUpdateSupported(): boolean {
  return app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin');
}

/**
 * Asks the release feed whether a newer version exists **without downloading
 * anything**: the service answers `204 No Content` when the running version is
 * the latest, and a JSON payload describing the release otherwise. Electron's
 * `autoUpdater.checkForUpdates()` is deliberately not used here because it
 * immediately downloads and stages whatever it finds, whereas this flow only
 * downloads once the user explicitly accepts.
 */
export async function checkForUpdate(): Promise<UpdateState> {
  if (!isUpdateSupported()) {
    return setState({ status: 'unsupported' });
  }
  // A download already in flight (or staged) must not be reset by the
  // periodic check, otherwise the dialog would jump back to "available".
  if (state.status === 'downloading' || state.status === 'ready') {
    return state;
  }

  setState({ status: 'checking', error: undefined });
  try {
    const response = await fetch(feedUrl(), { headers: { accept: 'application/json' } });
    if (response.status === 204) {
      logInfo('updater', `No update available, ${app.getVersion()} is the latest version`);
      return setState({
        status: 'up-to-date',
        latestVersion: undefined,
        releaseNotes: undefined,
        lastCheckedAt: new Date().toISOString(),
      });
    }
    if (!response.ok) {
      throw new Error(`Update feed responded with ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as { name?: string; notes?: string };
    logInfo('updater', `Update ${payload.name ?? '(unknown version)'} is available`);
    return setState({
      status: 'available',
      latestVersion: payload.name?.replace(/^v/, ''),
      releaseNotes: payload.notes,
      lastCheckedAt: new Date().toISOString(),
    });
  } catch (error) {
    logWarn('updater', 'Failed to check for updates', error);
    return setState({
      status: 'error',
      error: errorMessage(error),
      lastCheckedAt: new Date().toISOString(),
    });
  }
}

/**
 * Registers the `autoUpdater` listeners once, lazily: `setFeedURL` throws on
 * platforms without a Squirrel installer, so it is only reached from the
 * user-initiated download path, which is already guarded.
 */
function wireAutoUpdater(): void {
  if (autoUpdaterWired) return;
  autoUpdater.setFeedURL({ url: feedUrl() });

  autoUpdater.on('update-not-available', () => {
    // Only reachable if the release disappeared between the check and the
    // download; there is nothing to install, so fall back to "up to date".
    logWarn('updater', 'Squirrel reported no update while downloading');
    setState({ status: 'up-to-date', latestVersion: undefined, releaseNotes: undefined });
  });

  autoUpdater.on('update-downloaded', (_event, releaseNotes, releaseName) => {
    logInfo('updater', `Update ${releaseName ?? ''} downloaded and staged, pending restart`);
    setState({
      status: 'ready',
      latestVersion: releaseName?.replace(/^v/, '') ?? state.latestVersion,
      releaseNotes: releaseNotes ?? state.releaseNotes,
      error: undefined,
    });
  });

  autoUpdater.on('error', (error) => {
    logError('updater', 'Squirrel failed to download the update', error);
    setState({ status: 'error', error: errorMessage(error) });
  });

  autoUpdaterWired = true;
}

/**
 * Downloads and stages the pending update. Squirrel exposes no byte-level
 * progress, so the renderer shows an indeterminate progress bar between this
 * call and the `update-downloaded` event.
 */
export function downloadUpdate(): UpdateState {
  if (!isUpdateSupported()) {
    return setState({ status: 'unsupported' });
  }
  if (state.status === 'downloading' || state.status === 'ready') {
    return state;
  }

  try {
    wireAutoUpdater();
    const next = setState({ status: 'downloading', error: undefined });
    logInfo('updater', `Downloading update ${state.latestVersion ?? '(unknown version)'}`);
    autoUpdater.checkForUpdates();
    return next;
  } catch (error) {
    logError('updater', 'Failed to start the update download', error);
    return setState({ status: 'error', error: errorMessage(error) });
  }
}

/** Restarts the app so the staged update takes effect. */
export function restartToUpdate(): void {
  if (state.status !== 'ready') {
    logWarn('updater', 'Ignoring a restart request while no update is staged');
    return;
  }
  logInfo('updater', 'Restarting to apply the downloaded update');
  autoUpdater.quitAndInstall();
}

/**
 * Runs a first availability check at startup and then one every
 * {@link UPDATE_CHECK_INTERVAL_MS}. Nothing is ever downloaded automatically:
 * checks only flip the state to `available` so the renderer can offer the
 * update, and the user decides whether to take it.
 */
export function startUpdateChecks(): void {
  state = { status: 'checking', currentVersion: app.getVersion() };
  if (!isUpdateSupported()) {
    logInfo('updater', 'Updates are unavailable for this build (unpackaged or unsupported platform)');
    setState({ status: 'unsupported' });
    return;
  }

  void checkForUpdate();
  intervalHandle = setInterval(() => void checkForUpdate(), UPDATE_CHECK_INTERVAL_MS);
  // A pending interval would otherwise keep the event loop alive on quit.
  intervalHandle.unref?.();
}

/** Test seam: stops the periodic check and clears the cached state. */
export function stopUpdateChecks(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = undefined;
  }
  autoUpdaterWired = false;
  state = { status: 'checking', currentVersion: '0.0.0' };
}
