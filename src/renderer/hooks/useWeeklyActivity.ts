import { useEffect, useRef, useState } from 'react';
import type { UsageFilters, WeeklyActivityPoint } from '../../shared/types';

const POLL_INTERVAL_MS = 5_000;

interface UseWeeklyActivityResult {
  data: WeeklyActivityPoint[] | null;
  loading: boolean;
  error: Error | null;
}

export function useWeeklyActivity(filters: UsageFilters): UseWeeklyActivityResult {
  const [data, setData] = useState<WeeklyActivityPoint[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => {
    let cancelled = false;

    async function fetchWeeklyActivity(): Promise<void> {
      setLoading(true);
      try {
        const result = await window.api.getWeeklyActivity(filtersRef.current);
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchWeeklyActivity();
    const intervalId = setInterval(fetchWeeklyActivity, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [filters.project, filters.model, filters.from, filters.to]);

  return { data, loading, error };
}
