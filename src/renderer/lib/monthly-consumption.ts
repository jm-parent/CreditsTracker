import type { TimeSeriesPoint } from '../../shared/types';

/**
 * Groups daily usage points into calendar months ('YYYY-MM'), summing the
 * total and per-project credits of every day that falls in the same month.
 */
export function aggregateTimeSeriesByMonth(timeSeries: TimeSeriesPoint[]): TimeSeriesPoint[] {
  const months = new Map<string, { aiuCredits: number; byProject: Record<string, number> }>();

  for (const point of timeSeries) {
    const month = point.date.slice(0, 7);
    const entry = months.get(month) ?? { aiuCredits: 0, byProject: {} };
    entry.aiuCredits += point.aiuCredits;
    for (const [project, credits] of Object.entries(point.byProject ?? {})) {
      entry.byProject[project] = (entry.byProject[project] ?? 0) + credits;
    }
    months.set(month, entry);
  }

  return Array.from(months.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entry]) => ({ date, ...entry }));
}
