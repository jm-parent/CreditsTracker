import type { BreakdownPoint, TimeSeriesPoint } from '../../shared/types';

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

/** Total credits per project across the given points, highest first. */
export function sumByProject(points: TimeSeriesPoint[]): BreakdownPoint[] {
  const totals = new Map<string, number>();
  for (const point of points) {
    for (const [project, credits] of Object.entries(point.byProject ?? {})) {
      totals.set(project, (totals.get(project) ?? 0) + credits);
    }
  }

  return Array.from(totals, ([key, aiuCredits]) => ({ key, aiuCredits })).sort(
    (a, b) => b.aiuCredits - a.aiuCredits,
  );
}

/**
 * Turns per-project totals into one chart category per project: the project
 * key takes the x-axis slot and its bar holds only that project's credits.
 */
export function toProjectBars(projects: BreakdownPoint[]): TimeSeriesPoint[] {
  return projects.map(({ key, aiuCredits }) => ({
    date: key,
    aiuCredits,
    byProject: { [key]: aiuCredits },
  }));
}
