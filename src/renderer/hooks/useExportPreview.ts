import { useEffect, useState } from 'react';
import type { ExportPreview, UsageFilters } from '../../shared/types';
import { logError } from '../lib/logger';
import { validateExportFilters } from '../lib/export-periods';

export interface UseExportPreviewResult {
  data: ExportPreview | null;
  loading: boolean;
  error: Error | null;
}

export function useExportPreview(
  filters: UsageFilters,
  reloadToken = 0,
): UseExportPreviewResult {
  const [data, setData] = useState<ExportPreview | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const validationError = validateExportFilters(filters);
    if (validationError) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchPreview(): Promise<void> {
      setLoading(true);

      try {
        const result = await window.api.getExportPreview(filters);
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        logError('useExportPreview', 'getExportPreview failed', err);
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchPreview();

    return () => {
      cancelled = true;
    };
  }, [filters.project, filters.model, filters.from, filters.to, reloadToken]);

  return { data, loading, error };
}
