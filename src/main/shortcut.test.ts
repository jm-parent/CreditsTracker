import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, shell } from 'electron';
import { spawnSync } from 'node:child_process';
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
  shell: {
    writeShortcutLink: vi.fn(() => true),
  },
}));

vi.mock('node:child_process', () => {
  const spawnSync = vi.fn();
  return {
    spawnSync,
    default: { spawnSync },
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
  setExecPath(path.join(installRoot, 'CreditsTracker', 'CreditsTracker.exe'));
  fs.mkdirSync(path.dirname(process.execPath), { recursive: true });
});

afterEach(() => {
  fs.rmSync(path.dirname(desktopDir), { recursive: true, force: true });
});

describe('shouldPromptForDesktopShortcut', () => {
  it('returns true for a portable, packaged, unprompted install', () => {
    expect(shouldPromptForDesktopShortcut()).toBe(true);
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
    const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
    fs.writeFileSync(updateExe, '');

    expect(shouldPromptForDesktopShortcut()).toBe(true);
  });

  it('returns false while the Desktop shortcut exists and true again after it is removed', () => {
    const shortcutPath = path.join(desktopDir, 'Credits Tracker.lnk');
    fs.writeFileSync(shortcutPath, '');
    expect(shouldPromptForDesktopShortcut()).toBe(false);

    fs.rmSync(shortcutPath);
    expect(shouldPromptForDesktopShortcut()).toBe(true);
  });
});

describe('createDesktopShortcut', () => {
  it('uses shell.writeShortcutLink for portable installs and suppresses the prompt while it exists', () => {
    const mockWriteShortcutLink = shell.writeShortcutLink as unknown as ReturnType<typeof vi.fn>;
    mockWriteShortcutLink.mockImplementation((shortcutPath: string) => {
      fs.writeFileSync(shortcutPath, '');
      return true;
    });

    const result = createDesktopShortcut();

    expect(result).toBe(true);
    expect(spawnSync).not.toHaveBeenCalled();
    expect(shell.writeShortcutLink).toHaveBeenCalledWith(
      path.join(desktopDir, 'Credits Tracker.lnk'),
      'create',
      expect.objectContaining({
        target: process.execPath,
        cwd: path.dirname(process.execPath),
        icon: process.execPath,
      }),
    );
    expect(shouldPromptForDesktopShortcut()).toBe(false);
  });

  it('uses Update.exe for Squirrel-managed installs and creates the shortcut there', () => {
    const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
    fs.writeFileSync(updateExe, '');
    const spawnSyncMock = spawnSync as unknown as ReturnType<typeof vi.fn>;
    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      fs.writeFileSync(path.join(desktopDir, 'Credits Tracker.lnk'), '');
      return { status: 0, signal: null, error: undefined } as never;
    });

    const result = createDesktopShortcut();

    expect(result).toBe(true);
    expect(spawnSync).toHaveBeenCalledWith(
      updateExe,
      ['--createShortcut', 'CreditsTracker.exe'],
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    );
    expect(shell.writeShortcutLink).not.toHaveBeenCalled();
    expect(shouldPromptForDesktopShortcut()).toBe(false);
  });

  it('returns false when shell.writeShortcutLink throws', () => {
    (shell.writeShortcutLink as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('boom');
    });

    const result = createDesktopShortcut();

    expect(result).toBe(false);
    expect(shouldPromptForDesktopShortcut()).toBe(true);
  });

  it('returns false when Update.exe reports a failure', () => {
    const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
    fs.writeFileSync(updateExe, '');
    const spawnSyncMock = spawnSync as unknown as ReturnType<typeof vi.fn>;
    spawnSyncMock.mockReturnValue({ status: 1, signal: null, error: undefined } as never);

    const result = createDesktopShortcut();

    expect(result).toBe(false);
    expect(shell.writeShortcutLink).not.toHaveBeenCalled();
    expect(shouldPromptForDesktopShortcut()).toBe(true);
  });
});
