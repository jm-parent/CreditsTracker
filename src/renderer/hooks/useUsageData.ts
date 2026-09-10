import { useEffect, useRef, useState } from 'react';
import { logError } from '../lib/logger';
import type { UsageFilters, UsageResult } from '../../shared/types';

const POLL_INTERVAL_MS = 5_000;

interface UseUsageDataResult {
  data: UsageResult | null;
  loading: boolean;
  error: Error | null;
  /** Filters that produced `data`, or null before the first successful fetch. */
  dataFilters: UsageFilters | null;
}

/**
 * `data` and `dataFilters` are stored together so a displayed result can never
 * be attributed to filters it was not fetched with, which would make a
 * cross-filter difference look like incoming usage.
 */
interface UsageSnapshot {
  data: UsageResult;
  filters: UsageFilters;
}

export function useUsageData(filters: UsageFilters): UseUsageDataResult {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => {
    let cancelled = false;

    async function fetchUsage(): Promise<void> {
      setLoading(true);
      const requestFilters = filtersRef.current;
      try {
        const result = await window.api.getUsage(requestFilters);
        if (!cancelled) {
          setSnapshot({ data: result, filters: requestFilters });
          setError(null);
        }
      } catch (err) {
        logError('useUsageData', 'getUsage failed', err);
        if (!cancelled) {
          // The last successful snapshot stays visible on a transient failure.
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

  return {
    data: snapshot?.data ?? null,
    loading,
    error,
    dataFilters: snapshot?.filters ?? null,
  };
}
