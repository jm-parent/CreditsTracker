import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { updateElectronApp } from 'update-electron-app';
import { registerIpcHandlers } from './main/ipc-handlers';
import { resolveDefaultDbPath, DatabaseNotFoundError } from './main/db';
import { resolveDefaultWorkspaceStorageDir } from './main/vscode-chat-store';
import { handleSquirrelEvent } from './main/squirrel-events';
import { configureLogFile, logError, logInfo, logWarn } from './main/logger';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

function createWindow(): void {
  logInfo('window', 'Creating the main window');
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    // Only resolves during `npm start` (assets/ is excluded from packaged
    // builds by forge.config.ts). Packaged builds get their icon from
    // packagerConfig.icon, embedded directly into the executable instead.
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload/preload.js'),
    },
  });

  // Renderer crashes and failed loads are the usual cause of a blank window,
  // so they are logged explicitly rather than left to the devtools console.
  win.webContents.on('render-process-gone', (_event, details) => {
    logError('window', 'Renderer process gone', details);
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logError('window', 'Renderer failed to load', { errorCode, errorDescription, validatedURL });
  });
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    logError('window', `Preload script failed: ${preloadPath}`, error);
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

if (!handleSquirrelEvent()) {
  // Checks GitHub Releases (via update.electronjs.org) for a newer Squirrel.
  // Windows installer on startup and every 10 minutes, downloading and
  // installing it silently in the background; the update takes effect on the
  // next app restart. Only meaningful for packaged Windows builds — `npm
  // start` runs unpackaged and has no Squirrel installer to update.
  if (app.isPackaged) {
    updateElectronApp({
      repo: 'jm-parent/CreditsTracker',
    });
  }

  process.on('uncaughtException', (error) => {
    logError('process', 'Uncaught exception in the main process', error);
  });
  process.on('unhandledRejection', (reason) => {
    logError('process', 'Unhandled promise rejection in the main process', reason);
  });

  app.whenReady().then(() => {
    try {
      configureLogFile(path.join(app.getPath('userData'), 'logs', 'app.log'));
    } catch (error) {
      // File logging is best-effort; the in-memory buffer still feeds the
      // Logs page even when the userData folder isn't writable.
      logWarn('logs', 'Failed to configure the log file, keeping logs in memory only', error);
    }
    logInfo('startup', `Credits Tracker ${app.getVersion()} starting`, {
      electron: process.versions.electron,
      node: process.versions.node,
      platform: process.platform,
      packaged: app.isPackaged,
    });

    try {
      registerIpcHandlers(resolveDefaultDbPath(), resolveDefaultWorkspaceStorageDir());
    } catch (error) {
      // Any DB-open failure (missing file, corrupt DB, permission error, or a
      // native-module load failure) must never prevent the window from
      // opening — the renderer's EmptyState covers all of these via its own
      // IPC-call rejections. Only DatabaseNotFoundError gets a distinct log
      // message; everything else is logged generically but still non-fatal.
      if (error instanceof DatabaseNotFoundError) {
        logWarn('startup', error.message);
      } else {
        logError('startup', 'Failed to initialize database access', error);
      }
    }
    createWindow();
  });

  app.on('window-all-closed', () => {
    logInfo('shutdown', 'All windows closed');
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
