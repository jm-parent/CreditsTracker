import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMonthlyActivity } from './useMonthlyActivity';
import type { TimeSeriesPoint } from '../../shared/types';

const sampleResult: TimeSeriesPoint[] = [
  { date: '2026-09-01', aiuCredits: 2.5 },
  { date: '2026-09-15', aiuCredits: 1 },
];

beforeEach(() => {
  window.api = {
    getFilterOptions: vi.fn(),
    getUsage: vi.fn(),
    getProjectDetail: vi.fn(),
    getRawTablePage: vi.fn(),
    getHourlyDetail: vi.fn(),
    getMonthlyActivity: vi.fn().mockResolvedValue(sampleResult),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useMonthlyActivity', () => {
  it('loads data on mount and exposes it once resolved', async () => {
    const { result } = renderHook(() => useMonthlyActivity({ year: 2026, month: 9 }));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(sampleResult);
    expect(result.current.error).toBeNull();
    expect(window.api.getMonthlyActivity).toHaveBeenCalledWith({ year: 2026, month: 9 });
  });

  it('re-fetches when the month or filters change', async () => {
    const { result, rerender } = renderHook(({ params }) => useMonthlyActivity(params), {
      initialProps: { params: { year: 2026, month: 9 } },
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    rerender({ params: { year: 2026, month: 10 } });

    await waitFor(() => {
      expect(window.api.getMonthlyActivity).toHaveBeenLastCalledWith({ year: 2026, month: 10 });
    });
  });

  it('exposes an error when the IPC call rejects', async () => {
    window.api.getMonthlyActivity = vi.fn().mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useMonthlyActivity({ year: 2026, month: 9 }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBeNull();
  });

  it('polls again after 5 seconds', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useMonthlyActivity({ year: 2026, month: 9 }));

      expect(window.api.getMonthlyActivity).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });

      expect(window.api.getMonthlyActivity).toHaveBeenCalledTimes(2);
      void result;
    } finally {
      vi.useRealTimers();
    }
  });
});
