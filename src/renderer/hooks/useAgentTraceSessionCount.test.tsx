import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from '../lib/logger';
import { createWindowApi } from '../test-utils/windowApi';
import { useAgentTraceSessionCount } from './useAgentTraceSessionCount';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAgentTraceSessionCount', () => {
  beforeEach(() => {
    logger.resetLogDedupeForTests();
    window.api = createWindowApi({
      getAgentTraceSessionCount: vi.fn().mockResolvedValue(12),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the real stored session count on mount', async () => {
    const { result } = renderHook(() => useAgentTraceSessionCount());

    expect(result.current.count).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.count).toBe(12);
    expect(result.current.error).toBeNull();
    expect(window.api.getAgentTraceSessionCount).toHaveBeenCalledTimes(1);
  });

  it('preserves a successful zero count instead of treating it like unavailable data', async () => {
    window.api.getAgentTraceSessionCount = vi.fn().mockResolvedValue(0);

    const { result } = renderHook(() => useAgentTraceSessionCount());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.count).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('exposes an unavailable state on failure without fabricating a zero count', async () => {
    const boom = new Error('count bridge failed');
    const logError = vi.spyOn(logger, 'logError').mockImplementation(() => undefined);
    window.api.getAgentTraceSessionCount = vi.fn().mockRejectedValue(boom);

    const { result } = renderHook(() => useAgentTraceSessionCount());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.count).toBeNull();
    expect(result.current.error).toEqual(boom);
    expect(logError).toHaveBeenCalledWith(
      'useAgentTraceSessionCount',
      'getAgentTraceSessionCount failed',
      boom,
    );
  });

  it('retries after a failed request and replaces the unavailable state with the refreshed count', async () => {
    const boom = new Error('count bridge failed');
    window.api.getAgentTraceSessionCount = vi
      .fn()
      .mockRejectedValueOnce(boom)
      .mockResolvedValueOnce(7);

    const { result } = renderHook(() => useAgentTraceSessionCount());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.count).toBeNull();
    expect(result.current.error).toEqual(boom);

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.count).toBe(7);
    expect(result.current.error).toBeNull();
    expect(window.api.getAgentTraceSessionCount).toHaveBeenCalledTimes(2);
  });

  it('ignores stale refresh results when a newer refresh resolves first', async () => {
    const initialRequest = createDeferred<number>();
    const staleRefresh = createDeferred<number>();
    const freshRefresh = createDeferred<number>();

    window.api.getAgentTraceSessionCount = vi
      .fn()
      .mockImplementationOnce(() => initialRequest.promise)
      .mockImplementationOnce(() => staleRefresh.promise)
      .mockImplementationOnce(() => freshRefresh.promise);

    const { result } = renderHook(() => useAgentTraceSessionCount());

    await act(async () => {
      initialRequest.resolve(1);
      await initialRequest.promise;
    });

    await waitFor(() => expect(result.current.count).toBe(1));

    let staleRefreshPromise!: Promise<void>;
    await act(async () => {
      staleRefreshPromise = result.current.refresh();
      await Promise.resolve();
    });

    let freshRefreshPromise!: Promise<void>;
    await act(async () => {
      freshRefreshPromise = result.current.refresh();
      await Promise.resolve();
    });

    await act(async () => {
      freshRefresh.resolve(9);
      await freshRefresh.promise;
      await freshRefreshPromise;
    });

    await waitFor(() => expect(result.current.count).toBe(9));
    expect(result.current.error).toBeNull();

    await act(async () => {
      staleRefresh.resolve(4);
      await staleRefresh.promise;
      await staleRefreshPromise;
    });

    expect(result.current.count).toBe(9);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
