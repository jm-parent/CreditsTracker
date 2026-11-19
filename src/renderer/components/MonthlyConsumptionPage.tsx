import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { CreditValue } from './CreditValue';
import { TimeSeriesChart } from './TimeSeriesChart';
import { getColorForKey } from '../lib/colors';
import { aggregateTimeSeriesByMonth, sumByProject, toProjectBars } from '../lib/monthly-consumption';
import type { TimeSeriesPoint } from '../../shared/types';

export interface MonthlyConsumptionPageProps {
  /** Daily usage series for the current filters; aggregated per month here. */
  timeSeries: TimeSeriesPoint[];
  updateContextKey: string;
}

export function MonthlyConsumptionPage({ timeSeries, updateContextKey }: MonthlyConsumptionPageProps) {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const monthlySeries = aggregateTimeSeriesByMonth(timeSeries);
  const monthOptions = monthlySeries.map((point) => point.date);
  // Falls back to all months when the filters no longer contain the selected month.
  const activeMonth = selectedMonth && monthOptions.includes(selectedMonth) ? selectedMonth : null;

  const scopedPoints = activeMonth
    ? timeSeries.filter((point) => point.date.slice(0, 7) === activeMonth)
    : timeSeries;
  const projectTotals = sumByProject(scopedPoints);
  const chartData = activeMonth ? toProjectBars(projectTotals) : monthlySeries;
  const chartTitle = activeMonth ? `Credits per project — ${activeMonth}` : 'Credits per month';

  return (
    <div className="monthly-consumption-page flex flex-col gap-6">
      <div className="filter-bar flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="month-filter" className="text-xs font-medium text-muted-foreground">
            Month
          </label>
          <select
            id="month-filter"
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            value={activeMonth ?? ''}
            onChange={(event) => setSelectedMonth(event.target.value || null)}
          >
            <option value="">All months</option>
            {monthOptions.map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </select>
        </div>
      </div>
      <TimeSeriesChart data={chartData} updateContextKey={updateContextKey} title={chartTitle} />
      <Card>
        <CardHeader>
          <CardTitle>Total per project</CardTitle>
        </CardHeader>
        <CardContent>
          {projectTotals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No project usage for this selection.</p>
          ) : (
            <ul aria-label="Total credits per project" className="flex flex-col gap-2 text-sm">
              {projectTotals.map((project) => (
                <li key={project.key} className="flex items-center justify-between gap-4">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-3 w-3 shrink-0 rounded-sm"
                      style={{ backgroundColor: getColorForKey(project.key) }}
                    />
                    <span className="truncate text-foreground">{project.key}</span>
                  </span>
                  <CreditValue value={project.aiuCredits} className="font-medium text-foreground" />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
