import { useState } from 'react';
import type { ExportPreview, FilterOptions, UsageFilters } from '../../shared/types';
import { useExportPreview } from '../hooks/useExportPreview';
import { formatTokens } from '../lib/format';
import { getPresetFilters, type ExportPeriodPreset, validateExportFilters } from '../lib/export-periods';
import { logError } from '../lib/logger';
import { ExportFilters } from './ExportFilters';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Skeleton } from './ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

export interface ExportPageProps {
  options: FilterOptions;
}

function normalizeFilters(filters: UsageFilters): UsageFilters {
  const next = { ...filters };
  (Object.keys(next) as Array<keyof UsageFilters>).forEach((key) => {
    if (!next[key]) {
      delete next[key];
    }
  });
  return next;
}

function isEmptyPreview(preview: ExportPreview): boolean {
  return preview.sessionCount === 0 && preview.byModel.length === 0 && preview.daily.length === 0;
}

function formatCredits(value: number): string {
  return value.toFixed(2);
}

function formatShare(value: number): string {
  return `${value.toFixed(2)}%`;
}

const DATE_PRESETS: ExportPeriodPreset[] = ['last-7-days', 'this-month', 'previous-month'];

function getMatchingPreset(filters: UsageFilters, options: FilterOptions): ExportPeriodPreset {
  for (const candidate of DATE_PRESETS) {
    const candidateRange = getPresetFilters(candidate, new Date(), options);
    if (filters.from === candidateRange.from && filters.to === candidateRange.to) {
      return candidate;
    }
  }

  return 'all';
}

export function ExportPage({ options }: ExportPageProps) {
  const [filters, setFilters] = useState<UsageFilters>({});
  const [preset, setPreset] = useState<ExportPeriodPreset>('all');
  const [reloadToken, setReloadToken] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const { data, loading, error } = useExportPreview(filters, reloadToken);
  const previewData = error ? null : data;
  const validationMessage = validateExportFilters(filters);
  const empty = previewData ? isEmptyPreview(previewData) : false;
  const exportDisabled =
    exporting || Boolean(validationMessage) || loading || Boolean(error) || !previewData || empty;

  function handleFiltersChange(nextFilters: UsageFilters): void {
    const dateChanged = nextFilters.from !== filters.from || nextFilters.to !== filters.to;
    const normalizedFilters = normalizeFilters(nextFilters);
    setFilters(normalizedFilters);
    if (dateChanged) {
      setPreset(getMatchingPreset(normalizedFilters, options));
    }
  }

  function handlePresetChange(nextPreset: ExportPeriodPreset): void {
    const range = getPresetFilters(nextPreset, new Date(), options);
    setFilters(
      normalizeFilters({
        project: filters.project,
        model: filters.model,
        ...range,
      }),
    );
    setPreset(nextPreset);
  }

  async function handleExport(): Promise<void> {
    setExporting(true);
    setExportMessage(null);
    setExportError(null);

    try {
      const result = await window.api.exportHtml({
        filters,
        suggestedName: 'copilot-usage.html',
      });

      if (result.cancelled) {
        return;
      }

      setExportMessage(
        `Exported ${result.htmlPath ?? 'copilot-usage.html'} (${result.summaryRows ?? 0} summary rows, ${result.sessionRows ?? 0} session rows).`,
      );
    } catch (err) {
      logError('ExportPage', 'HTML export failed', err);
      setExportError('Could not export the HTML report. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="export-page flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-foreground">HTML export</h2>

      <ExportFilters
        options={options}
        filters={filters}
        preset={preset}
        onFiltersChange={handleFiltersChange}
        onPresetChange={handlePresetChange}
      />

      {validationMessage && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
          {validationMessage}
        </p>
      )}

      {exportError && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
          {exportError}
        </p>
      )}

      {exportMessage && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground"
        >
          {exportMessage}
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted px-4 py-3"
        >
          <p className="text-sm text-muted-foreground">Couldn't load the export preview.</p>
          <button
            type="button"
            onClick={() => setReloadToken((token) => token + 1)}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-background"
          >
            Retry preview
          </button>
        </div>
      )}

      {loading && !data && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {previewData && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardContent className="flex flex-col gap-1 p-4">
                <span className="text-2xl font-semibold text-foreground">
                  {formatCredits(previewData.totals.aiuCredits)}
                </span>
                <span className="text-sm text-muted-foreground">AIU credits</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex flex-col gap-1 p-4">
                <span className="text-2xl font-semibold text-foreground">{formatTokens(previewData.totals.tokens)}</span>
                <span className="text-sm text-muted-foreground">Tokens</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex flex-col gap-1 p-4">
                <span className="text-2xl font-semibold text-foreground">{previewData.totals.requests}</span>
                <span className="text-sm text-muted-foreground">Requests</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex flex-col gap-1 p-4">
                <span className="text-2xl font-semibold text-foreground">{previewData.sessionCount}</span>
                <span className="text-sm text-muted-foreground">Sessions</span>
              </CardContent>
            </Card>
          </div>

          {empty ? (
            <p className="text-sm text-muted-foreground">No usage for this selection.</p>
          ) : (
            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Usage by model</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Model</TableHead>
                        <TableHead>AIU credits</TableHead>
                        <TableHead>% of period</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewData.byModel.map((row) => (
                        <TableRow key={row.model}>
                          <TableCell>{row.model}</TableCell>
                          <TableCell>{formatCredits(row.aiuCredits)}</TableCell>
                          <TableCell>{formatShare(row.sharePercent)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Usage by day</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {previewData.activeDays} active day{previewData.activeDays === 1 ? '' : 's'} in this period.
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>AIU credits</TableHead>
                        <TableHead>Tokens</TableHead>
                        <TableHead>Requests</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewData.daily.map((row) => (
                        <TableRow key={row.date}>
                          <TableCell>{row.date}</TableCell>
                          <TableCell>{formatCredits(row.aiuCredits)}</TableCell>
                          <TableCell>{formatTokens(row.tokens)}</TableCell>
                          <TableCell>{row.requests}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exportDisabled}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? 'Exporting…' : 'Export HTML report'}
        </button>
      </div>
    </div>
  );
}
