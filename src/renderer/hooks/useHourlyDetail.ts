import { useEffect, useState } from 'react';
import { logError } from '../lib/logger';
import type { HourlyDetailParams, HourlyPoint, UsageFilters } from '../../shared/types';

interface UseHourlyDetailResult {
  data: HourlyPoint[] | null;
  loading: boolean;
  error: Error | null;
}

export function useHourlyDetail(
  date: string | null,
  filters: UsageFilters,
): UseHourlyDetailResult {
  const [data, setData] = useState<HourlyPoint[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!date) {
      setData(null);
      setError(null);
      return;
    }

    let cancelled = false;

    async function fetchHourly(currentDate: string): Promise<void> {
      setLoading(true);
      try {
        const params: HourlyDetailParams = { ...filters, date: currentDate };
        const result = await window.api.getHourlyDetail(params);
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        logError('useHourlyDetail', `getHourlyDetail failed for ${currentDate}`, err);
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchHourly(date);

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, filters.project, filters.model, filters.from, filters.to]);

  return { data, loading, error };
}
