import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { app } from 'electron';
import { spawn } from 'node:child_process';
import { createDesktopShortcut, shouldPromptForDesktopShortcut } from './shortcut';

let desktopDir: string;
let installRoot: string;

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: vi.fn((name: string) => {
      throw new Error(`unexpected app.getPath("${name}") call before test setup`);
    }),
  },
}));

vi.mock('node:child_process', () => {
  const spawn = vi.fn();
  return {
    spawn,
    default: { spawn },
  };
});

vi.mock('./logger', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform });
}

function setExecPath(execPath: string): void {
  Object.defineProperty(process, 'execPath', { configurable: true, value: execPath });
}

/** Fake `ChildProcess` good enough to drive the `spawn(...).on('error'|'exit', ...)` flow under test. */
class FakeChildProcess extends EventEmitter {}

beforeEach(() => {
  vi.clearAllMocks();
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'credits-tracker-shortcut-test-'));
  desktopDir = path.join(testRoot, 'Desktop');
  fs.mkdirSync(desktopDir, { recursive: true });
  installRoot = path.join(testRoot, 'Install');

  (app as unknown as { isPackaged: boolean }).isPackaged = true;
  (app.getPath as unknown as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
    if (name === 'desktop') return desktopDir;
    throw new Error(`unexpected app.getPath("${name}") call`);
  });

  setPlatform('win32');
  // Electron Packager names the packaged executable after package.json's
  // `name` ("credits-tracker"), lowercase and hyphenated — not after the
  // product's display name ("Credits Tracker"). Squirrel's Update.exe in
  // turn names the shortcut it creates after that executable's basename
  // (`credits-tracker.lnk`), so tests must exercise that real naming
  // instead of an assumed display-name-based one.
  setExecPath(path.join(installRoot, 'app-1.9.0', 'credits-tracker.exe'));
  fs.mkdirSync(path.dirname(process.execPath), { recursive: true });
});

afterEach(() => {
  fs.rmSync(path.dirname(desktopDir), { recursive: true, force: true });
});

function writeUpdateExe(): string {
  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  fs.writeFileSync(updateExe, '');
  return updateExe;
}

describe('shouldPromptForDesktopShortcut', () => {
  it('returns false for a packaged install that is not Squirrel-managed', () => {
    expect(shouldPromptForDesktopShortcut()).toBe(false);
  });

  it('returns false when not packaged', () => {
    (app as unknown as { isPackaged: boolean }).isPackaged = false;
    expect(shouldPromptForDesktopShortcut()).toBe(false);
  });

  it('returns false on a non-Windows platform', () => {
    setPlatform('darwin');
    expect(shouldPromptForDesktopShortcut()).toBe(false);
  });

  it('returns true when a Squirrel-managed install has no Desktop shortcut', () => {
    writeUpdateExe();

    expect(shouldPromptForDesktopShortcut()).toBe(true);
  });

  it('returns false while the Squirrel-named Desktop shortcut exists and true again after it is removed', () => {
    writeUpdateExe();
    // This is the actual name Squirrel's Update.exe writes for this exe,
    // not "Credits Tracker.lnk".
    const shortcutPath = path.join(desktopDir, 'credits-tracker.lnk');
    fs.writeFileSync(shortcutPath, '');
    expect(shouldPromptForDesktopShortcut()).toBe(false);

    fs.rmSync(shortcutPath);
    expect(shouldPromptForDesktopShortcut()).toBe(true);
  });

  it('returns false when only the legacy display-name shortcut exists', () => {
    writeUpdateExe();
    const legacyShortcutPath = path.join(desktopDir, 'Credits Tracker.lnk');
    fs.writeFileSync(legacyShortcutPath, '');

    expect(shouldPromptForDesktopShortcut()).toBe(false);
  });
});

describe('createDesktopShortcut', () => {
  it('resolves false when Update.exe is unavailable', async () => {
    const result = await createDesktopShortcut();

    expect(result).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    expect(shouldPromptForDesktopShortcut()).toBe(false);
  });

  it('uses Update.exe with the running executable basename for Squirrel-managed installs', async () => {
    const updateExe = writeUpdateExe();
    const child = new FakeChildProcess();
    const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        fs.writeFileSync(path.join(desktopDir, 'credits-tracker.lnk'), '');
        child.emit('exit', 0, null);
      });
      return child;
    });

    const result = await createDesktopShortcut();

    expect(result).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      updateExe,
      ['--createShortcut', 'credits-tracker.exe'],
      expect.objectContaining({ stdio: 'ignore' }),
    );
    expect(shouldPromptForDesktopShortcut()).toBe(false);
  });

  it('resolves false when Update.exe reports a nonzero exit code', async () => {
    writeUpdateExe();
    const child = new FakeChildProcess();
    const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => child.emit('exit', 1, null));
      return child;
    });

    const result = await createDesktopShortcut();

    expect(result).toBe(false);
    expect(shouldPromptForDesktopShortcut()).toBe(true);
  });

  it('resolves false when Update.exe exits 0 but the expected Desktop shortcut was not actually written', async () => {
    writeUpdateExe();
    const child = new FakeChildProcess();
    const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;
    spawnMock.mockImplementation(() => {
      // Exit code 0 without ever writing the .lnk file: the exit code alone
      // must not be trusted as proof the shortcut exists.
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    });

    const result = await createDesktopShortcut();

    expect(result).toBe(false);
    expect(shouldPromptForDesktopShortcut()).toBe(true);
  });

  it('resolves false when spawning Update.exe fails', async () => {
    writeUpdateExe();
    const child = new FakeChildProcess();
    const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => child.emit('error', new Error('ENOENT')));
      return child;
    });

    const result = await createDesktopShortcut();

    expect(result).toBe(false);
  });
});
