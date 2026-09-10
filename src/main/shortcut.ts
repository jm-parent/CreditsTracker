import { app, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { logError, logInfo, logWarn } from './logger';

const SHORTCUT_NAME = 'Credits Tracker.lnk';
const PROMPT_FLAG_FILE = 'desktop-shortcut-prompt.json';

function flagFilePath(): string {
  return path.join(app.getPath('userData'), PROMPT_FLAG_FILE);
}

function desktopShortcutPath(): string {
  return path.join(app.getPath('desktop'), SHORTCUT_NAME);
}

/**
 * Squirrel-installed builds already get a Desktop shortcut created on
 * install/update by squirrel-events.ts (via `Update.exe --createShortcut`),
 * pointed at the stable launcher shim rather than the versioned exe path
 * inside `app-x.y.z` (which moves on every update). Detected by the presence
 * of `Update.exe` one directory above the running executable, which only
 * exists in a Squirrel install layout — never in the portable zip build.
 */
function isSquirrelManaged(): boolean {
  try {
    const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
    return fs.existsSync(updateExe);
  } catch {
    return false;
  }
}

/**
 * Only the portable Windows zip build needs the first-launch prompt: a
 * Squirrel install already manages its own shortcut, and unpackaged dev runs
 * have no stable exe path to point a shortcut at.
 */
function isSupported(): boolean {
  return process.platform === 'win32' && app.isPackaged && !isSquirrelManaged();
}

function hasBeenPrompted(): boolean {
  try {
    return fs.existsSync(flagFilePath());
  } catch {
    return false;
  }
}

function markPrompted(): void {
  try {
    fs.mkdirSync(path.dirname(flagFilePath()), { recursive: true });
    fs.writeFileSync(flagFilePath(), JSON.stringify({ promptedAt: new Date().toISOString() }), 'utf8');
  } catch (error) {
    logWarn('shortcut', 'Failed to persist the desktop shortcut prompt flag', error);
  }
}

/**
 * Whether the first-launch dialog offering to create a Desktop shortcut
 * should be shown. Only true once per install: the flag file recorded by
 * {@link createDesktopShortcut} or {@link dismissDesktopShortcutPrompt}
 * suppresses it afterwards, and a shortcut found on the Desktop already
 * (created manually, or by a previous run) also suppresses it without
 * requiring a decision.
 */
export function shouldPromptForDesktopShortcut(): boolean {
  if (!isSupported()) return false;
  if (hasBeenPrompted()) return false;
  if (fs.existsSync(desktopShortcutPath())) {
    markPrompted();
    return false;
  }
  return true;
}

/**
 * Creates (or overwrites) a Desktop `.lnk` pointing at the running
 * executable, using Electron's built-in Windows shortcut writer — no
 * external process needed. Always marks the prompt as handled, even on
 * failure, so the dialog isn't shown again on the next launch.
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
    markPrompted();
    return created;
  } catch (error) {
    logError('shortcut', 'Failed to create the desktop shortcut', error);
    markPrompted();
    return false;
  }
}

/** Records the user's "no thanks" answer so the prompt isn't shown again. */
export function dismissDesktopShortcutPrompt(): void {
  markPrompted();
}
