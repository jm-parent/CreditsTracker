import { app } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';

const shortcutEvents = new Set(['--squirrel-install', '--squirrel-updated']);

export function handleSquirrelEvent(
  argv: string[] = process.argv,
  execPath: string = process.execPath,
): boolean {
  if (!argv.some((arg) => shortcutEvents.has(arg))) {
    return false;
  }

  const updateExePath = path.resolve(path.dirname(execPath), '..', 'Update.exe');
  const shortcutProcess = spawn(
    updateExePath,
    [
      '--createShortcut',
      path.basename(execPath),
      '--shortcut-locations',
      'Desktop,StartMenu',
    ],
    { detached: true },
  );

  shortcutProcess.unref();
  app.quit();
  return true;
}
