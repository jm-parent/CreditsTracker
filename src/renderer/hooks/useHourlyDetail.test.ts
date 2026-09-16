import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useHourlyDetail } from './useHourlyDetail';
import type { HourlyPoint } from '../../shared/types';

const points: HourlyPoint[] = [];

beforeEach(() => {
  window.api = {
    getFilterOptions: vi.fn(),
    getUsage: vi.fn(),
    getProjectDetail: vi.fn(),
    getRawTablePage: vi.fn(),
    getHourlyDetail: vi.fn().mockResolvedValue(points),
    getMonthlyActivity: vi.fn(),
  };
});

describe('useHourlyDetail', () => {
  it('loads hourly detail with the active project search and re-fetches when it changes', async () => {
    const { result, rerender } = renderHook(({ date, filters }) => useHourlyDetail(date, filters), {
      initialProps: { date: '2026-09-01', filters: { projectSearch: 'repo-a' } },
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(window.api.getHourlyDetail).toHaveBeenCalledWith({
      date: '2026-09-01',
      projectSearch: 'repo-a',
    });

    rerender({ date: '2026-09-01', filters: { projectSearch: 'repo-b' } });

    await waitFor(() => {
      expect(window.api.getHourlyDetail).toHaveBeenCalledTimes(2);
    });

    expect(window.api.getHourlyDetail).toHaveBeenLastCalledWith({
      date: '2026-09-01',
      projectSearch: 'repo-b',
    });
  });
});
