import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createTauriApi, installTransport, isTauriRuntime } from './transport';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

function tauriWindow(): Window {
  return { __TAURI_INTERNALS__: {}, api: { marker: 'preload' } } as unknown as Window;
}

describe('renderer transport', () => {
  it('replaces window.api with the Tauri transport only inside the Tauri shell', () => {
    const electronWindow = { api: { marker: 'preload' } } as unknown as Window;
    installTransport(electronWindow);
    expect(electronWindow.api).toEqual({ marker: 'preload' });

    const shell = tauriWindow();
    expect(isTauriRuntime(shell)).toBe(true);
    installTransport(shell);
    expect(typeof shell.api.getUsage).toBe('function');
  });

  it('invokes the Rust command named after the channel with the same payload', async () => {
    invokeMock.mockResolvedValueOnce({ totals: {} });
    const api = createTauriApi();

    await api.getUsage({ project: 'alpha', from: '2026-01-01' });

    expect(invokeMock).toHaveBeenCalledWith('get_usage', {
      filters: { project: 'alpha', from: '2026-01-01' },
    });
  });

  it('rejects with an Error carrying the message Tauri returns as a string', async () => {
    invokeMock.mockRejectedValueOnce('db is locked');

    await expect(createTauriApi().getFilterOptions()).rejects.toThrow('db is locked');
  });

  it('flattens log details to strings so they survive the IPC boundary', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const error = new Error('boom');

    await createTauriApi().log({ level: 'error', scope: 'window', message: 'boom', detail: error });

    expect(invokeMock).toHaveBeenCalledWith('log_message', {
      entry: { level: 'error', scope: 'window', message: 'boom', detail: error.stack },
    });
  });
});
