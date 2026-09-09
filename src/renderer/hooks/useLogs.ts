import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogsSnapshot } from '../../shared/types';

interface UseLogsResult {
  data: LogsSnapshot | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  clear: () => Promise<void>;
}

/** Poll interval used while the Logs page is open and auto-refresh is on. */
const POLL_INTERVAL_MS = 2_000;

export function useLogs(autoRefresh: boolean): UseLogsResult {
  const [data, setData] = useState<LogsSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const cancelledRef = useRef(false);

  const apply = useCallback((snapshot: LogsSnapshot) => {
    if (!cancelledRef.current) {
      setData(snapshot);
      setError(null);
    }
  }, []);

  const fail = useCallback((err: unknown) => {
    if (!cancelledRef.current) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await window.api.getLogs());
    } catch (err) {
      fail(err);
    } finally {
      if (!cancelledRef.current) {
        setLoading(false);
      }
    }
  }, [apply, fail]);

  const clear = useCallback(async () => {
    try {
      apply(await window.api.clearLogs());
    } catch (err) {
      fail(err);
    }
  }, [apply, fail]);

  useEffect(() => {
    cancelledRef.current = false;
    refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }
    const timer = setInterval(() => {
      refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, refresh]);

  return { data, loading, error, refresh, clear };
}
