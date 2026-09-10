import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { app } from 'electron';
import { spawn } from 'node:child_process';
import { handleSquirrelEvent } from './squirrel-events';

vi.mock('electron', () => ({
  app: { quit: vi.fn() },
}));

vi.mock('node:child_process', () => {
  const spawn = vi.fn();
  return { spawn, default: { spawn } };
});

vi.mock('./logger', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

function fakeChildProcess(): EventEmitter & { unref: () => void } {
  const child = new EventEmitter() as EventEmitter & { unref: () => void };
  child.unref = vi.fn();
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fakeChildProcess());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('handleSquirrelEvent', () => {
  it('ignores argv without a squirrel event', () => {
    const handled = handleSquirrelEvent(['node', 'main.js'], 'C:\\App\\app-1.0.0\\App.exe');

    expect(handled).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('spawns Update.exe --createShortcut with the default shortcut locations on --squirrel-install', () => {
    const execPath = 'C:\\Users\\me\\AppData\\Local\\CreditsTracker\\app-1.8.0\\CreditsTracker.exe';
    const handled = handleSquirrelEvent(['C:\\...\\CreditsTracker.exe', '--squirrel-install'], execPath);

    expect(handled).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      path.resolve(path.dirname(execPath), '..', 'Update.exe'),
      ['--createShortcut', 'CreditsTracker.exe'],
      { detached: true },
    );
  });

  it('handles --squirrel-updated the same way', () => {
    const execPath = 'C:\\App\\app-1.9.0\\App.exe';
    const handled = handleSquirrelEvent(['--squirrel-updated'], execPath);

    expect(handled).toBe(true);
    expect(spawn).toHaveBeenCalledWith(expect.any(String), ['--createShortcut', 'App.exe'], { detached: true });
  });

  it('quits the app after a delay instead of immediately, giving Update.exe time to finish', () => {
    handleSquirrelEvent(['--squirrel-install'], 'C:\\App\\app-1.0.0\\App.exe');

    expect(app.quit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(app.quit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  it('still schedules the quit when spawn throws synchronously', () => {
    (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('spawn failed');
    });

    const handled = handleSquirrelEvent(['--squirrel-install'], 'C:\\App\\app-1.0.0\\App.exe');

    expect(handled).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(app.quit).toHaveBeenCalledTimes(1);
  });
});
