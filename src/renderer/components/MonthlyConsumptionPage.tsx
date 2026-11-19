import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { CreditValue } from './CreditValue';
import { TimeSeriesChart } from './TimeSeriesChart';
import { getColorForKey } from '../lib/colors';
import { aggregateTimeSeriesByMonth } from '../lib/monthly-consumption';
import type { BreakdownPoint, TimeSeriesPoint } from '../../shared/types';

export interface MonthlyConsumptionPageProps {
  /** Daily usage series for the current filters; aggregated per month here. */
  timeSeries: TimeSeriesPoint[];
  /** Per-project totals for the current filters, shown in the legend. */
  byProject: BreakdownPoint[];
  updateContextKey: string;
}

export function MonthlyConsumptionPage({ timeSeries, byProject, updateContextKey }: MonthlyConsumptionPageProps) {
  const monthlySeries = aggregateTimeSeriesByMonth(timeSeries);
  const projectTotals = byProject
    .filter((project) => Boolean(project.key))
    .sort((a, b) => b.aiuCredits - a.aiuCredits);

  return (
    <div className="monthly-consumption-page flex flex-col gap-6">
      <TimeSeriesChart
        data={monthlySeries}
        updateContextKey={updateContextKey}
        title="Credits per month"
      />
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
