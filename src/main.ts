import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { registerIpcHandlers } from './main/ipc-handlers';
import { resolveDefaultDbPath, DatabaseNotFoundError } from './main/db';
import { resolveDefaultWorkspaceStorageDir } from './main/vscode-chat-store';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
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
