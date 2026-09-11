import { app } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { logError, logInfo, logWarn } from './logger';

/**
 * Name used by an earlier (buggy) version of this file that assumed
 * Squirrel names the shortcut after the product ("Credits Tracker.lnk")
 * rather than after the packaged executable's basename. Kept only so an
 * install that somehow already has that file isn't re-prompted.
 */
const LEGACY_SHORTCUT_NAME = 'Credits Tracker.lnk';

/** Basename (with extension) of the currently running packaged executable, e.g. `credits-tracker.exe`. */
function exeBasename(): string {
  return path.basename(process.execPath);
}

/**
 * Squirrel names the `.lnk` it creates after the target executable's
 * basename with its extension replaced by `.lnk` (e.g. `credits-tracker.exe`
 * -> `credits-tracker.lnk`), not after the product name. This must track
 * whatever the packaged executable is actually named, since Electron
 * Packager derives that name from `package.json` and it can change.
 */
function shortcutNameForExe(exeName: string): string {
  return `${path.basename(exeName, path.extname(exeName))}.lnk`;
}

function desktopDir(): string {
  return app.getPath('desktop');
}

function desktopShortcutPath(): string {
  return path.join(desktopDir(), shortcutNameForExe(exeBasename()));
}

function legacyDesktopShortcutPath(): string {
  return path.join(desktopDir(), LEGACY_SHORTCUT_NAME);
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
 * shortcut is absent. The legacy name is also checked so an install that
 * already has it (from before this naming bug was fixed) isn't re-prompted.
 */
export function shouldPromptForDesktopShortcut(): boolean {
  return (
    isSupported() &&
    isSquirrelManagedInstall() &&
    !fs.existsSync(desktopShortcutPath()) &&
    !fs.existsSync(legacyDesktopShortcutPath())
  );
}

/**
 * Creates the Desktop `.lnk` pointing at the running executable by asking
 * the adjacent Squirrel `Update.exe` to do it. `spawn` (not `spawnSync`) is
 * required here: this is called from an IPC handler on the main process,
 * and blocking that process would freeze every other IPC call (including
 * the renderer's polling) until Update.exe exits. The returned promise
 * settles once Update.exe exits and the expected shortcut has been
 * verified on disk, rather than trusting its exit code alone.
 */
export function createDesktopShortcut(): Promise<boolean> {
  if (!isSupported()) {
    logWarn('shortcut', 'Desktop shortcut creation is unsupported on this platform or build');
    return Promise.resolve(false);
  }

  if (!isSquirrelManagedInstall()) {
    logWarn('shortcut', 'Desktop shortcut creation requires a Squirrel-managed installation', {
      execPath: process.execPath,
    });
    return Promise.resolve(false);
  }

  const updatePath = updateExePath();
  const exeName = exeBasename();

  return new Promise((resolve) => {
    try {
      // No --shortcut-locations flag: Squirrel's default refreshes both the
      // Desktop and Start Menu shortcuts, which is what we want here, and
      // passing the flag explicitly risks Update.exe's argument parser
      // rejecting or ignoring the whole invocation depending on the
      // Squirrel.Windows version.
      const child = spawn(updatePath, ['--createShortcut', exeName], { stdio: 'ignore' });

      child.on('error', (error) => {
        logError('shortcut', 'Failed to start the desktop shortcut creation process via Update.exe', error);
        resolve(false);
      });

      child.on('exit', (code, signal) => {
        if (code !== 0) {
          logWarn('shortcut', 'Desktop shortcut creation reported failure via Update.exe', {
            updateExePath: updatePath,
            exeName,
            status: code,
            signal,
          });
          resolve(false);
          return;
        }

        // Update.exe can exit 0 without actually having written the
        // shortcut (e.g. an unexpected Squirrel.Windows behavior change),
        // so the exit code alone is not trusted: the Desktop is re-checked
        // for the file before reporting success.
        const created = fs.existsSync(desktopShortcutPath());
        if (created) {
          logInfo('shortcut', `Desktop shortcut created via ${updatePath}`, { exeName });
        } else {
          logWarn('shortcut', 'Update.exe exited successfully but the expected Desktop shortcut was not found', {
            updateExePath: updatePath,
            exeName,
            expectedPath: desktopShortcutPath(),
          });
        }
        resolve(created);
      });
    } catch (error) {
      logError('shortcut', 'Failed to start the desktop shortcut creation process', error);
      resolve(false);
    }
  });
}
