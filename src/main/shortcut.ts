import { app } from 'electron';
import { spawnSync } from 'node:child_process';
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

function updateExePath(): string {
  return path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
}

function isSquirrelManagedInstall(): boolean {
  return fs.existsSync(updateExePath());
}

/**
 * Whether the launch-time Desktop shortcut toast should be shown.
 * Packaged Squirrel-managed Windows builds prompt only when the expected
 * shortcut is absent.
 */
export function shouldPromptForDesktopShortcut(): boolean {
  return isSupported() && isSquirrelManagedInstall() && !fs.existsSync(desktopShortcutPath());
}

/**
 * Creates (or overwrites) a Desktop `.lnk` pointing at the running
 * executable. Squirrel-managed installs must go through Update.exe so the
 * shortcut keeps tracking future updates.
 */
export function createDesktopShortcut(): boolean {
  try {
    if (!isSupported()) {
      logWarn('shortcut', 'Desktop shortcut creation is unsupported on this platform or build');
      return false;
    }

    if (!isSquirrelManagedInstall()) {
      logWarn('shortcut', 'Desktop shortcut creation requires a Squirrel-managed installation', {
        execPath: process.execPath,
      });
      return false;
    }

    const updatePath = updateExePath();
    const exeName = path.basename(process.execPath);
    const result = spawnSync(updatePath, ['--createShortcut', exeName], {
      detached: true,
      stdio: 'ignore',
    });
    if (result.error) {
      logError('shortcut', 'Failed to start the desktop shortcut creation process via Update.exe', result.error);
      return false;
    }
    if (result.status === 0) {
      logInfo('shortcut', `Desktop shortcut created via ${updatePath}`, { exeName });
      return true;
    }
    logWarn('shortcut', 'Desktop shortcut creation reported failure via Update.exe', {
      updateExePath: updatePath,
      exeName,
      status: result.status,
      signal: result.signal,
    });
    return false;
  } catch (error) {
    logError('shortcut', 'Failed to create the desktop shortcut', error);
    return false;
  }
}
