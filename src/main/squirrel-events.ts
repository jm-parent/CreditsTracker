import { app } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { logError, logInfo } from './logger';

const shortcutEvents = new Set(['--squirrel-install', '--squirrel-updated']);

/**
 * Squirrel expects the app to quit shortly after handling its event, but not
 * immediately: `Update.exe --createShortcut` is spawned detached and needs a
 * brief window to actually start and write the .lnk files before the parent
 * process (this app) disappears. Quitting right after `spawn()` returns (as
 * this used to do) let the app exit before the shortcut was written on some
 * machines, silently leaving no Desktop/Start Menu shortcut behind. This
 * matches the delay used by the canonical `electron-squirrel-startup`
 * package.
 */
const QUIT_DELAY_MS = 1_000;

export function handleSquirrelEvent(
  argv: string[] = process.argv,
  execPath: string = process.execPath,
): boolean {
  if (!argv.some((arg) => shortcutEvents.has(arg))) {
    return false;
  }

  const updateExePath = path.resolve(path.dirname(execPath), '..', 'Update.exe');
  const exeName = path.basename(execPath);
  logInfo('squirrel', `Handling squirrel event, creating shortcuts via ${updateExePath}`, { exeName });

  try {
    // No --shortcut-locations flag: Squirrel's default (Desktop + Start
    // Menu) is what we want, and passing it explicitly risks Update.exe's
    // argument parser rejecting or ignoring the whole invocation depending
    // on the Squirrel.Windows version, which would fail silently since the
    // process is detached.
    const shortcutProcess = spawn(updateExePath, ['--createShortcut', exeName], { detached: true });
    shortcutProcess.on('error', (error) => {
      logError('squirrel', 'Failed to spawn Update.exe to create shortcuts', error);
    });
    shortcutProcess.unref();
  } catch (error) {
    logError('squirrel', 'Failed to start the shortcut creation process', error);
  }

  setTimeout(() => app.quit(), QUIT_DELAY_MS);
  return true;
}
