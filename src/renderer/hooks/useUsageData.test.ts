import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useUsageData } from './useUsageData';
import type { UsageResult } from '../../shared/types';

const sampleResult: UsageResult = {
  totals: { aiuCredits: 1, tokens: 10, requests: 1 },
  timeSeries: [{ date: '2026-09-01', aiuCredits: 1 }],
  byProject: [{ key: 'org/repo-a', aiuCredits: 1 }],
  byModel: [{ key: 'claude-sonnet-5', aiuCredits: 1 }],
};

beforeEach(() => {
  window.api = {
    getFilterOptions: vi.fn(),
    getUsage: vi.fn().mockResolvedValue(sampleResult),
    getProjectDetail: vi.fn(),
    getRawTablePage: vi.fn(),
    getHourlyDetail: vi.fn(),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useUsageData', () => {
  it('loads data on mount and exposes it once resolved', async () => {
    const { result } = renderHook(() => useUsageData({}));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(sampleResult);
    expect(result.current.error).toBeNull();
    expect(window.api.getUsage).toHaveBeenCalledWith({});
  });

  it('re-fetches when filters change', async () => {
    const { result, rerender } = renderHook(({ filters }) => useUsageData(filters), {
      initialProps: { filters: {} },
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    rerender({ filters: { project: 'org/repo-a' } });

    await waitFor(() => {
      expect(window.api.getUsage).toHaveBeenLastCalledWith({ project: 'org/repo-a' });
    });
  });

  it('exposes an error when the IPC call rejects', async () => {
    window.api.getUsage = vi.fn().mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useUsageData({}));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBeNull();
  });

  it('polls again after 15 seconds', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useUsageData({}));

      // First call happens on mount
      expect(window.api.getUsage).toHaveBeenCalledTimes(1);

      // Advance timers by 15 seconds to trigger the next poll
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      // Should have been called a second time
      expect(window.api.getUsage).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
