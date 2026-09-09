import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { updateElectronApp } from 'update-electron-app';
import { registerIpcHandlers } from './main/ipc-handlers';
import { resolveDefaultDbPath, DatabaseNotFoundError } from './main/db';
import { resolveDefaultWorkspaceStorageDir } from './main/vscode-chat-store';

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

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

function createWindow(): void {
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

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

app.whenReady().then(() => {
  try {
    registerIpcHandlers(resolveDefaultDbPath(), resolveDefaultWorkspaceStorageDir());
  } catch (error) {
    // Any DB-open failure (missing file, corrupt DB, permission error, or a
    // native-module load failure) must never prevent the window from
    // opening — the renderer's EmptyState covers all of these via its own
    // IPC-call rejections. Only DatabaseNotFoundError gets a distinct log
    // message; everything else is logged generically but still non-fatal.
    if (error instanceof DatabaseNotFoundError) {
      console.error(error.message);
    } else {
      console.error('Failed to initialize database access:', error);
    }
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
