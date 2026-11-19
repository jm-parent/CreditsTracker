import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { CreditValue } from './CreditValue';
import { TimeSeriesChart } from './TimeSeriesChart';
import { getColorForKey } from '../lib/colors';
import { aggregateTimeSeriesByMonth, sumByProject, toProjectBars } from '../lib/monthly-consumption';
import type { TimeSeriesPoint } from '../../shared/types';

export interface MonthlyConsumptionPageProps {
  /** Daily usage series for the current filters; aggregated per month here. */
  timeSeries: TimeSeriesPoint[];
  /** 'YYYY-MM' month to scope the chart to, or null for every month. */
  selectedMonth: string | null;
  updateContextKey: string;
}

export function MonthlyConsumptionPage({ timeSeries, selectedMonth, updateContextKey }: MonthlyConsumptionPageProps) {
  const monthlySeries = aggregateTimeSeriesByMonth(timeSeries);

  const scopedPoints = selectedMonth
    ? timeSeries.filter((point) => point.date.slice(0, 7) === selectedMonth)
    : timeSeries;
  const projectTotals = sumByProject(scopedPoints);
  const chartData = selectedMonth ? toProjectBars(projectTotals) : monthlySeries;
  const chartTitle = selectedMonth ? `Credits per project — ${selectedMonth}` : 'Credits per month';

  return (
    <div className="monthly-consumption-page flex flex-col gap-6">
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
