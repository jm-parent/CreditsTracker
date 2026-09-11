import { app, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { logError, logInfo, logWarn } from './logger';

const SHORTCUT_NAME = 'Credits Tracker.lnk';

function desktopShortcutPath(): string {
  return path.join(app.getPath('desktop'), SHORTCUT_NAME);
}

function isSupported(): boolean {
  return process.platform === 'win32' && app.isPackaged;
}

/**
 * Whether the launch-time Desktop shortcut toast should be shown.
 * Packaged Windows builds prompt only when the expected shortcut is absent.
 */
export function shouldPromptForDesktopShortcut(): boolean {
  return isSupported() && !fs.existsSync(desktopShortcutPath());
}

/**
 * Creates (or overwrites) a Desktop `.lnk` pointing at the running
 * executable, using Electron's built-in Windows shortcut writer — no
 * external process needed.
 */
export function createDesktopShortcut(): boolean {
  try {
    const created = shell.writeShortcutLink(desktopShortcutPath(), 'create', {
      target: process.execPath,
      cwd: path.dirname(process.execPath),
      description: 'Credits Tracker',
      icon: process.execPath,
      iconIndex: 0,
    });
    if (created) {
      logInfo('shortcut', `Desktop shortcut created at ${desktopShortcutPath()}`);
    } else {
      logWarn('shortcut', 'Desktop shortcut creation reported failure');
    }
    return created;
  } catch (error) {
    logError('shortcut', 'Failed to create the desktop shortcut', error);
    return false;
  }
}
