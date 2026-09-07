import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useProjectDetail } from './useProjectDetail';
import type { ProjectDetailResult } from '../../shared/types';

const detail: ProjectDetailResult = {
  project: 'org/repo-a',
  totals: { aiuCredits: 3, tokens: 120, requests: 2 },
  timeSeries: [{ date: '2026-09-01', aiuCredits: 3 }],
  conversations: [
    {
      sessionId: 's1',
      createdAt: '2026-09-01 10:00:00',
      summary: 'Fixed a bug',
      models: 'claude-sonnet-5',
      aiuCredits: 3,
      tokens: 120,
      requests: 2,
    },
  ],
};

beforeEach(() => {
  window.api = {
    getFilterOptions: vi.fn(),
    getUsage: vi.fn(),
    getProjectDetail: vi.fn().mockResolvedValue(detail),
    getRawTablePage: vi.fn(),
  };
});

describe('useProjectDetail', () => {
  it('fetches project detail on mount and exposes it as data', async () => {
    const { result } = renderHook(() => useProjectDetail('org/repo-a', {}));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(detail);
    expect(window.api.getProjectDetail).toHaveBeenCalledWith({ project: 'org/repo-a' });
  });

  it('re-fetches when the project or filters change', async () => {
    const { rerender } = renderHook(({ project, filters }) => useProjectDetail(project, filters), {
      initialProps: { project: 'org/repo-a', filters: {} },
    });
    await waitFor(() => expect(window.api.getProjectDetail).toHaveBeenCalledTimes(1));

    rerender({ project: 'org/repo-a', filters: { model: 'claude-sonnet-5' } });

    await waitFor(() => expect(window.api.getProjectDetail).toHaveBeenCalledTimes(2));
    expect(window.api.getProjectDetail).toHaveBeenLastCalledWith({
      project: 'org/repo-a',
      model: 'claude-sonnet-5',
    });
  });

  it('surfaces a rejected fetch as an error', async () => {
    window.api.getProjectDetail = vi.fn().mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useProjectDetail('org/repo-a', {}));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toEqual(new Error('boom'));
    expect(result.current.data).toBeNull();
  });
});
