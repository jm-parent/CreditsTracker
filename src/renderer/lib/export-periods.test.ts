import { describe, expect, it } from 'vitest';
import { getPresetFilters, validateExportFilters } from './export-periods';

describe('export periods', () => {
  const today = new Date(2026, 8, 16);
  const bounds = { minDate: '2026-08-01', maxDate: '2026-09-16' } as const;

  it('returns the inclusive previous six days for last seven days', () => {
    expect(getPresetFilters('last-7-days', today, bounds)).toEqual({
      from: '2026-09-10',
      to: '2026-09-16',
    });
  });

  it('clamps the current month and previous month to available bounds', () => {
    expect(getPresetFilters('this-month', today, bounds)).toEqual({
      from: '2026-09-01',
      to: '2026-09-16',
    });
    expect(getPresetFilters('previous-month', today, bounds)).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('returns no dates for all data and reports inverted ranges', () => {
    expect(getPresetFilters('all', today, bounds)).toEqual({});
    expect(validateExportFilters({ from: '2026-09-02', to: '2026-09-01' })).toBe(
      'Start date must be on or before end date.',
    );
    expect(validateExportFilters({ from: '2026-09-01', to: '2026-09-01' })).toBeNull();
  });
});
