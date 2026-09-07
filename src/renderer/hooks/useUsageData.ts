import { useEffect, useRef, useState } from 'react';
import type { UsageFilters, UsageResult } from '../../shared/types';

const POLL_INTERVAL_MS = 15_000;

interface UseUsageDataResult {
  data: UsageResult | null;
  loading: boolean;
  error: Error | null;
}

export function useUsageData(filters: UsageFilters): UseUsageDataResult {
  const [data, setData] = useState<UsageResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => {
    let cancelled = false;

    async function fetchUsage(): Promise<void> {
      setLoading(true);
      try {
        const result = await window.api.getUsage(filtersRef.current);
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

    fetchUsage();
    const intervalId = setInterval(fetchUsage, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [filters.project, filters.model, filters.from, filters.to]);

  return { data, loading, error };
}
