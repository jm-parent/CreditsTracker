import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWeeklyActivity } from './useWeeklyActivity';
import type { WeeklyActivityPoint } from '../../shared/types';

const sampleResult: WeeklyActivityPoint[] = [
  { weekday: 1, hour: 14, aiuCredits: 2.5 },
  { weekday: 3, hour: 9, aiuCredits: 1 },
];

beforeEach(() => {
  window.api = {
    getFilterOptions: vi.fn(),
    getUsage: vi.fn(),
    getProjectDetail: vi.fn(),
    getRawTablePage: vi.fn(),
    getHourlyDetail: vi.fn(),
    getWeeklyActivity: vi.fn().mockResolvedValue(sampleResult),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useWeeklyActivity', () => {
  it('loads data on mount and exposes it once resolved', async () => {
    const { result } = renderHook(() => useWeeklyActivity({}));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(sampleResult);
    expect(result.current.error).toBeNull();
    expect(window.api.getWeeklyActivity).toHaveBeenCalledWith({});
  });

  it('re-fetches when filters change', async () => {
    const { result, rerender } = renderHook(({ filters }) => useWeeklyActivity(filters), {
      initialProps: { filters: {} },
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    rerender({ filters: { project: 'org/repo-a' } });

    await waitFor(() => {
      expect(window.api.getWeeklyActivity).toHaveBeenLastCalledWith({ project: 'org/repo-a' });
    });
  });

  it('exposes an error when the IPC call rejects', async () => {
    window.api.getWeeklyActivity = vi.fn().mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useWeeklyActivity({}));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBeNull();
  });

  it('polls again after 5 seconds', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useWeeklyActivity({}));

      expect(window.api.getWeeklyActivity).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });

      expect(window.api.getWeeklyActivity).toHaveBeenCalledTimes(2);
      void result;
    } finally {
      vi.useRealTimers();
    }
  });
});
