import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRawTable } from './useRawTable';
import type { RawTableName, RawTablePage } from '../../shared/types';

const page: RawTablePage = {
  columns: ['id', 'cwd'],
  rows: [{ id: 's1', cwd: 'C:/repo-a' }],
  total: 1,
  page: 0,
  pageSize: 50,
};

beforeEach(() => {
  window.api = {
    getFilterOptions: vi.fn(),
    getUsage: vi.fn(),
    getProjectDetail: vi.fn(),
    getRawTablePage: vi.fn().mockResolvedValue(page),
    getHourlyDetail: vi.fn(),
    getMonthlyActivity: vi.fn(),
  };
});

describe('useRawTable', () => {
  it('fetches a page for the given table on mount', async () => {
    const { result } = renderHook(() => useRawTable('sessions', 0));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(page);
    expect(window.api.getRawTablePage).toHaveBeenCalledWith({
      table: 'sessions',
      page: 0,
      pageSize: 50,
    });
  });

  it('re-fetches when the table or page changes', async () => {
    const { rerender } = renderHook(
      ({ table, page: p }: { table: RawTableName; page: number }) => useRawTable(table, p),
      {
        initialProps: { table: 'sessions', page: 0 },
      },
    );
    await waitFor(() => expect(window.api.getRawTablePage).toHaveBeenCalledTimes(1));

    rerender({ table: 'assistant_usage_events', page: 0 });
    await waitFor(() => expect(window.api.getRawTablePage).toHaveBeenCalledTimes(2));

    rerender({ table: 'assistant_usage_events', page: 1 });
    await waitFor(() => expect(window.api.getRawTablePage).toHaveBeenCalledTimes(3));
  });

  it('surfaces a rejected fetch as an error', async () => {
    window.api.getRawTablePage = vi.fn().mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useRawTable('sessions', 0));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toEqual(new Error('boom'));
    expect(result.current.data).toBeNull();
  });
});
