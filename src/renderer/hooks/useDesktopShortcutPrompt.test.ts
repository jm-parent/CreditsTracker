import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLogDedupeForTests } from '../lib/logger';
import { useDesktopShortcutPrompt } from './useDesktopShortcutPrompt';

function createWindowApi(): Window['api'] {
  return {
    getFilterOptions: vi.fn(),
    getUsage: vi.fn(),
    getProjectDetail: vi.fn(),
    getRawTablePage: vi.fn(),
    getHourlyDetail: vi.fn(),
    getMonthlyActivity: vi.fn(),
    getAppVersion: vi.fn(),
    getUpdateState: vi.fn(),
    checkForUpdate: vi.fn(),
    downloadUpdate: vi.fn(),
    restartToUpdate: vi.fn(),
    onUpdateStateChange: vi.fn(() => () => {}),
    shouldPromptDesktopShortcut: vi.fn().mockResolvedValue(false),
    createDesktopShortcut: vi.fn().mockResolvedValue(true),
    getLogs: vi.fn(),
    clearLogs: vi.fn(),
    openLogFile: vi.fn(),
    log: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  resetLogDedupeForTests();
  window.api = createWindowApi();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDesktopShortcutPrompt', () => {
  it('opens when the Desktop shortcut is missing', async () => {
    window.api.shouldPromptDesktopShortcut = vi.fn().mockResolvedValue(true);

    const { result } = renderHook(() => useDesktopShortcutPrompt());

    await waitFor(() => expect(result.current.open).toBe(true));
  });

  it('dismisses only for the current mount and prompts again on a new mount', async () => {
    window.api.shouldPromptDesktopShortcut = vi.fn().mockResolvedValue(true);

    const first = renderHook(() => useDesktopShortcutPrompt());
    await waitFor(() => expect(first.result.current.open).toBe(true));

    act(() => first.result.current.dismiss());

    expect(first.result.current.open).toBe(false);
    first.unmount();

    const second = renderHook(() => useDesktopShortcutPrompt());
    await waitFor(() => expect(second.result.current.open).toBe(true));
    expect(window.api.shouldPromptDesktopShortcut).toHaveBeenCalledTimes(2);
  });

  it('keeps the toast open with an error when creation reports failure', async () => {
    window.api.shouldPromptDesktopShortcut = vi.fn().mockResolvedValue(true);
    window.api.createDesktopShortcut = vi.fn().mockResolvedValue(false);

    const { result } = renderHook(() => useDesktopShortcutPrompt());
    await waitFor(() => expect(result.current.open).toBe(true));

    act(() => result.current.create());

    await waitFor(() =>
      expect(result.current.error).toBe('Could not create the shortcut. Please try again.'),
    );
    expect(result.current.open).toBe(true);
    expect(result.current.creating).toBe(false);
  });

  it('clears the error and closes after a successful retry', async () => {
    window.api.shouldPromptDesktopShortcut = vi.fn().mockResolvedValue(true);
    window.api.createDesktopShortcut = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const { result } = renderHook(() => useDesktopShortcutPrompt());
    await waitFor(() => expect(result.current.open).toBe(true));

    act(() => result.current.create());

    await waitFor(() =>
      expect(result.current.error).toBe('Could not create the shortcut. Please try again.'),
    );

    act(() => result.current.create());

    expect(result.current.error).toBeNull();

    await waitFor(() => expect(result.current.open).toBe(false));
    expect(result.current.creating).toBe(false);
    expect(window.api.createDesktopShortcut).toHaveBeenCalledTimes(2);
  });

  it('closes the toast after the shortcut is created', async () => {
    window.api.shouldPromptDesktopShortcut = vi.fn().mockResolvedValue(true);
    window.api.createDesktopShortcut = vi.fn().mockResolvedValue(true);

    const { result } = renderHook(() => useDesktopShortcutPrompt());
    await waitFor(() => expect(result.current.open).toBe(true));

    act(() => result.current.create());

    await waitFor(() => expect(result.current.open).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.creating).toBe(false);
  });

  it('keeps the toast open with the same retryable error when creation rejects', async () => {
    window.api.shouldPromptDesktopShortcut = vi.fn().mockResolvedValue(true);
    window.api.createDesktopShortcut = vi.fn().mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useDesktopShortcutPrompt());
    await waitFor(() => expect(result.current.open).toBe(true));

    act(() => result.current.create());

    await waitFor(() =>
      expect(result.current.error).toBe('Could not create the shortcut. Please try again.'),
    );
    expect(result.current.open).toBe(true);
    expect(result.current.creating).toBe(false);
  });
});
