import { useEffect, useRef, useState } from 'react';
import { logError } from '../lib/logger';
import type { ProjectDetailResult, UsageFilters } from '../../shared/types';

interface UseProjectDetailResult {
  data: ProjectDetailResult | null;
  loading: boolean;
  error: Error | null;
}

export function useProjectDetail(project: string, filters: UsageFilters): UseProjectDetailResult {
  const [data, setData] = useState<ProjectDetailResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => {
    let cancelled = false;

    async function fetchDetail(): Promise<void> {
      setLoading(true);
      try {
        const result = await window.api.getProjectDetail({ ...filtersRef.current, project });
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        logError('useProjectDetail', `getProjectDetail failed for ${project}`, err);
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchDetail();

    return () => {
      cancelled = true;
    };
  }, [project, filters.project, filters.model, filters.from, filters.to]);

  return { data, loading, error };
}
