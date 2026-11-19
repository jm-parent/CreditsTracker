import { useCallback, useEffect, useRef, useState } from 'react';
import { logError } from '../lib/logger';

export interface UseAgentTraceSessionCountResult {
  count: number | null;
  loading: boolean;
  error: Error | null;
  refresh(): Promise<void>;
}

export function useAgentTraceSessionCount(): UseAgentTraceSessionCountResult {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const requestGenerationRef = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const nextCount = await window.api.getAgentTraceSessionCount();
      if (!mountedRef.current || requestGenerationRef.current !== requestGeneration) {
        return;
      }

      setCount(nextCount);
      setError(null);
    } catch (err) {
      logError('useAgentTraceSessionCount', 'getAgentTraceSessionCount failed', err);
      if (!mountedRef.current || requestGenerationRef.current !== requestGeneration) {
        return;
      }

      setCount(null);
      setError(asError(err));
    } finally {
      if (mountedRef.current && requestGenerationRef.current === requestGeneration) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();

    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, [refresh]);

  return {
    count,
    loading,
    error,
    refresh,
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
