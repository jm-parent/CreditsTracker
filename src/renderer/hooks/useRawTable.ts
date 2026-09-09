import { useEffect, useState } from 'react';
import { logError } from '../lib/logger';
import type { RawTableName, RawTablePage } from '../../shared/types';

interface UseRawTableResult {
  data: RawTablePage | null;
  loading: boolean;
  error: Error | null;
}

const PAGE_SIZE = 50;

export function useRawTable(table: RawTableName, page: number): UseRawTableResult {
  const [data, setData] = useState<RawTablePage | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchPage(): Promise<void> {
      setLoading(true);
      try {
        const result = await window.api.getRawTablePage({ table, page, pageSize: PAGE_SIZE });
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        logError('useRawTable', `getRawTablePage failed for ${table} (page ${page})`, err);
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchPage();

    return () => {
      cancelled = true;
    };
  }, [table, page]);

  return { data, loading, error };
}
