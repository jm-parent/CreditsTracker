import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { registerAgentTraceIpcHandlers, registerIpcHandlers } from './main/ipc-handlers';
import { resolveDefaultDbPath, DatabaseNotFoundError } from './main/db';
import { resolveDefaultWorkspaceStorageDir } from './main/vscode-chat-store';
import { handleSquirrelEvent } from './main/squirrel-events';
import { startUpdateChecks } from './main/updater';
import { configureLogFile, logError, logInfo, logWarn } from './main/logger';
import { createAgentTraceService, type AgentTraceService } from './main/agent-trace-service';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let agentTraceService: AgentTraceService | null = null;
let shuttingDownAgentTraceService = false;
let agentTraceShutdownPromise: Promise<void> | null = null;

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
  process.on('uncaughtException', (error) => {
    logError('process', 'Uncaught exception in the main process', error);
  });
  process.on('unhandledRejection', (reason) => {
    logError('process', 'Unhandled promise rejection in the main process', reason);
  });

  app.whenReady().then(async () => {
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

    agentTraceService = createAgentTraceService(app.getPath('userData'), {
      onStatusChange: (status) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (window.isDestroyed() || window.webContents.isDestroyed()) {
            continue;
          }

          try {
            window.webContents.send('agent-trace-status-changed', status);
          } catch (error) {
            logError('agent-trace-service', 'Failed to publish trace status to the renderer', error);
          }
        }
      },
    });
    registerAgentTraceIpcHandlers(agentTraceService);
    await agentTraceService.initialize();

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
    // Availability checks run on startup and periodically after that, but
    // nothing is downloaded until the user accepts the update from the
    // renderer's update dialog.
    startUpdateChecks();
  });

  app.on('window-all-closed', () => {
    logInfo('shutdown', 'All windows closed');
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    if (shuttingDownAgentTraceService || !agentTraceService) {
      return;
    }

    event.preventDefault();
    if (agentTraceShutdownPromise) {
      return;
    }

    agentTraceShutdownPromise = agentTraceService.shutdown()
      .catch((error) => {
        logError('shutdown', 'Failed to stop the local agent trace service cleanly', error);
      })
      .finally(() => {
        shuttingDownAgentTraceService = true;
        agentTraceShutdownPromise = null;
        app.quit();
      });
  });
}
