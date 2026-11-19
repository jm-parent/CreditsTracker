import { describe, it, expect } from 'vitest';
import { aggregateTimeSeriesByMonth } from './monthly-consumption';

describe('aggregateTimeSeriesByMonth', () => {
  it('sums daily credits and per-project credits into calendar months', () => {
    const result = aggregateTimeSeriesByMonth([
      { date: '2026-09-30', aiuCredits: 2, byProject: { 'org/repo-a': 2 } },
      { date: '2026-08-01', aiuCredits: 1, byProject: { 'org/repo-b': 1 } },
      { date: '2026-09-01', aiuCredits: 3, byProject: { 'org/repo-a': 1, 'org/repo-b': 2 } },
    ]);

    expect(result).toEqual([
      { date: '2026-08', aiuCredits: 1, byProject: { 'org/repo-b': 1 } },
      { date: '2026-09', aiuCredits: 5, byProject: { 'org/repo-a': 3, 'org/repo-b': 2 } },
    ]);
  });

  it('returns an empty series for no usage', () => {
    expect(aggregateTimeSeriesByMonth([])).toEqual([]);
  });
});
