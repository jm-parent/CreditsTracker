import { useEffect, useState } from 'react';
import { useUsageData } from './hooks/useUsageData';
import { EmptyState } from './components/EmptyState';
import { FilterBar } from './components/FilterBar';
import { SummaryCards } from './components/SummaryCards';
import { TimeSeriesChart } from './components/TimeSeriesChart';
import { BreakdownChart } from './components/BreakdownChart';
import { SessionsTable } from './components/SessionsTable';
import type { FilterOptions, UsageFilters } from '../shared/types';

const EMPTY_OPTIONS: FilterOptions = { projects: [], models: [], minDate: null, maxDate: null };

export function App() {
  const [options, setOptions] = useState<FilterOptions>(EMPTY_OPTIONS);
  const [optionsError, setOptionsError] = useState<Error | null>(null);
  const [filters, setFilters] = useState<UsageFilters>({});
  const { data, error } = useUsageData(filters);

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
    <div className="app">
      <h1>Credits Dashboard</h1>
      <FilterBar options={options} filters={filters} onChange={setFilters} />
      {error && data && <p className="refresh-notice">Couldn't refresh — showing last known data.</p>}
      {data && (
        <>
          <SummaryCards totals={data.totals} />
          <TimeSeriesChart data={data.timeSeries} />
          <BreakdownChart title="Credits by project" data={data.byProject} />
          <BreakdownChart title="Credits by model" data={data.byModel} />
          <SessionsTable rows={data.byProject} />
        </>
      )}
    </div>
  );
}
