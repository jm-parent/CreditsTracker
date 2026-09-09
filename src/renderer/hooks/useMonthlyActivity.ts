import { useEffect, useRef, useState } from 'react';
import type { MonthlyActivityParams, TimeSeriesPoint } from '../../shared/types';

const POLL_INTERVAL_MS = 5_000;

interface UseMonthlyActivityResult {
  data: TimeSeriesPoint[] | null;
  loading: boolean;
  error: Error | null;
}

export function useMonthlyActivity(params: MonthlyActivityParams): UseMonthlyActivityResult {
  const [data, setData] = useState<TimeSeriesPoint[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    let cancelled = false;

    async function fetchMonthlyActivity(): Promise<void> {
      setLoading(true);
      try {
        const result = await window.api.getMonthlyActivity(paramsRef.current);
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

    fetchMonthlyActivity();
    const intervalId = setInterval(fetchMonthlyActivity, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [params.year, params.month, params.project, params.model]);

  return { data, loading, error };
}
