import { useEffect, useState } from 'react';
import { useUsageData } from './hooks/useUsageData';
import { EmptyState } from './components/EmptyState';
import { FilterBar } from './components/FilterBar';
import { SummaryCards } from './components/SummaryCards';
import { TimeSeriesChart } from './components/TimeSeriesChart';
import { BreakdownChart } from './components/BreakdownChart';
import { SessionsTable } from './components/SessionsTable';
import { Skeleton } from './components/ui/skeleton';
import type { FilterOptions, UsageFilters } from '../shared/types';

const EMPTY_OPTIONS: FilterOptions = { projects: [], models: [], minDate: null, maxDate: null };

export function App() {
  const [options, setOptions] = useState<FilterOptions>(EMPTY_OPTIONS);
  const [optionsError, setOptionsError] = useState<Error | null>(null);
  const [filters, setFilters] = useState<UsageFilters>({});
  const { data, loading, error } = useUsageData(filters);

  useEffect(() => {
    window.api
      .getFilterOptions()
      .then(setOptions)
      .catch((err) => setOptionsError(err instanceof Error ? err : new Error(String(err))));
  }, []);

  if ((optionsError || error) && !data) {
    return (
      <EmptyState
        title="Couldn't load Copilot CLI usage data."
        message="Make sure Copilot CLI has been used on this machine, then reopen the app."
      />
    );
  }

  return (
    <div className="app min-h-screen bg-background px-6 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-foreground">Credits Dashboard</h1>
      <FilterBar options={options} filters={filters} onChange={setFilters} />
      {error && data && (
        <p className="refresh-notice mt-4 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          Couldn't refresh — showing last known data.
        </p>
      )}
      {loading && !data && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {data && (
        <div className="mt-6 flex flex-col gap-6">
          <SummaryCards totals={data.totals} />
          <TimeSeriesChart data={data.timeSeries} />
          <BreakdownChart title="Credits by project" data={data.byProject} />
          <BreakdownChart title="Credits by model" data={data.byModel} />
          <SessionsTable rows={data.byProject} />
        </div>
      )}
    </div>
  );
}
