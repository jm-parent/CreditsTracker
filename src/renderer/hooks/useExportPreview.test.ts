import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportPreview } from '../../shared/types';
import * as logger from '../lib/logger';
import { createWindowApi } from '../test-utils/windowApi';
import { useExportPreview } from './useExportPreview';

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

const preview: ExportPreview = {
  totals: { aiuCredits: 4, tokens: 100, requests: 2 },
  sessionCount: 1,
  activeDays: 1,
  byModel: [{ model: 'gpt-5.4', aiuCredits: 4, sharePercent: 100 }],
  daily: [{ date: '2026-09-01', aiuCredits: 4, tokens: 100, requests: 2 }],
};

beforeEach(() => {
  logger.resetLogDedupeForTests();
  window.api = createWindowApi({
    getExportPreview: vi.fn().mockResolvedValue(preview),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useExportPreview', () => {
  it('requests a preview for the current filters and exposes the result', async () => {
    const { result } = renderHook(() => useExportPreview({ model: 'gpt-5.4' }));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.data).toEqual(preview));

    expect(window.api.getExportPreview).toHaveBeenCalledWith({ model: 'gpt-5.4' });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('logs a rejected request and exposes the error', async () => {
    const boom = new Error('boom');
    window.api.getExportPreview = vi.fn().mockRejectedValue(boom);
    const logError = vi.spyOn(logger, 'logError').mockImplementation(() => undefined);

    const { result } = renderHook(() => useExportPreview({ model: 'gpt-5.4' }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toEqual(boom);
    expect(logError).toHaveBeenCalledWith('useExportPreview', 'getExportPreview failed', boom);
  });

  it('does not commit a stale response after the filters change', async () => {
    const first = createDeferred<ExportPreview>();
    const second = createDeferred<ExportPreview>();
    const stalePreview: ExportPreview = {
      ...preview,
      totals: { aiuCredits: 1, tokens: 25, requests: 1 },
    };
    const freshPreview: ExportPreview = {
      ...preview,
      totals: { aiuCredits: 2, tokens: 50, requests: 1 },
      byModel: [{ model: 'claude-sonnet-5', aiuCredits: 2, sharePercent: 100 }],
    };

    window.api.getExportPreview = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result, rerender } = renderHook(
      ({ filters }) => useExportPreview(filters),
      { initialProps: { filters: { model: 'gpt-5.4' } } },
    );

    rerender({ filters: { model: 'claude-sonnet-5' } });

    await act(async () => {
      first.resolve(stalePreview);
      await first.promise;
    });

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      second.resolve(freshPreview);
      await second.promise;
    });

    await waitFor(() => expect(result.current.data).toEqual(freshPreview));
    expect(result.current.error).toBeNull();
  });

  it('clears the current preview for an invalid range without requesting a new one', async () => {
    const { result, rerender } = renderHook(
      ({ filters }) => useExportPreview(filters),
      { initialProps: { filters: { from: '2026-09-01', to: '2026-09-02' } } },
    );

    await waitFor(() => expect(result.current.data).toEqual(preview));

    rerender({ filters: { from: '2026-09-02', to: '2026-09-01' } });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(window.api.getExportPreview).toHaveBeenCalledTimes(1);
  });

  it('retries the same filters when the reload token changes', async () => {
    const { rerender } = renderHook(
      ({ reloadToken }) => useExportPreview({ model: 'gpt-5.4' }, reloadToken),
      { initialProps: { reloadToken: 0 } },
    );

    await waitFor(() => expect(window.api.getExportPreview).toHaveBeenCalledTimes(1));

    rerender({ reloadToken: 1 });

    await waitFor(() => expect(window.api.getExportPreview).toHaveBeenCalledTimes(2));
  });
});
