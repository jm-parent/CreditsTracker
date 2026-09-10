import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, shell } from 'electron';
import {
  createDesktopShortcut,
  dismissDesktopShortcutPrompt,
  shouldPromptForDesktopShortcut,
} from './shortcut';

let userDataDir: string;
let desktopDir: string;

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'credits-tracker-shortcut-test-'));
  userDataDir = path.join(root, 'userData');
  desktopDir = path.join(root, 'Desktop');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(desktopDir, { recursive: true });

  (app as unknown as { isPackaged: boolean }).isPackaged = true;
  (app.getPath as unknown as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
    if (name === 'userData') return userDataDir;
    if (name === 'desktop') return desktopDir;
    throw new Error(`unexpected app.getPath("${name}") call`);
  });

  setPlatform('win32');
  // A portable install: the exe sits directly in its own folder with no
  // sibling Update.exe, unlike a Squirrel-managed install.
  setExecPath(path.join(root, 'CreditsTracker', 'CreditsTracker.exe'));
  fs.mkdirSync(path.dirname(process.execPath), { recursive: true });
});

afterEach(() => {
  fs.rmSync(path.dirname(userDataDir), { recursive: true, force: true });
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

  it('returns false when Squirrel manages the install (Update.exe sibling present)', () => {
    const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
    fs.writeFileSync(updateExe, '');
    expect(shouldPromptForDesktopShortcut()).toBe(false);
  });

  it('returns false and marks prompted when a shortcut already exists on the Desktop', () => {
    fs.writeFileSync(path.join(desktopDir, 'Credits Tracker.lnk'), '');
    expect(shouldPromptForDesktopShortcut()).toBe(false);
    // The flag is now persisted, so even removing the shortcut afterwards
    // must not bring the prompt back.
    fs.rmSync(path.join(desktopDir, 'Credits Tracker.lnk'));
    expect(shouldPromptForDesktopShortcut()).toBe(false);
  });

  it('returns false after the prompt has already been answered', () => {
    dismissDesktopShortcutPrompt();
    expect(shouldPromptForDesktopShortcut()).toBe(false);
  });
});

describe('createDesktopShortcut', () => {
  it('writes a shortcut targeting the running executable and marks the prompt handled', () => {
    const result = createDesktopShortcut();

    expect(result).toBe(true);
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

  it('still marks the prompt handled when shell.writeShortcutLink throws', () => {
    (shell.writeShortcutLink as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('boom');
    });

    const result = createDesktopShortcut();

    expect(result).toBe(false);
    expect(shouldPromptForDesktopShortcut()).toBe(false);
  });
});

describe('dismissDesktopShortcutPrompt', () => {
  it('suppresses further prompts without creating a shortcut', () => {
    dismissDesktopShortcutPrompt();

    expect(shouldPromptForDesktopShortcut()).toBe(false);
    expect(shell.writeShortcutLink).not.toHaveBeenCalled();
  });
});
