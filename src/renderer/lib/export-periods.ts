import type { FilterOptions, UsageFilters } from '../../shared/types';

export type ExportPeriodPreset = 'all' | 'last-7-days' | 'this-month' | 'previous-month';

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function shiftLocalDate(value: string, days: number): string {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
}

function getEmptyClampedRange(
  range: Pick<UsageFilters, 'from' | 'to'>,
  bounds: Pick<FilterOptions, 'minDate' | 'maxDate'>,
): Pick<UsageFilters, 'from' | 'to'> {
  if (bounds.minDate && range.to && parseLocalDate(range.to) < parseLocalDate(bounds.minDate)) {
    const sentinel = shiftLocalDate(bounds.minDate, -1);
    return { from: sentinel, to: sentinel };
  }

  if (bounds.maxDate && range.from && parseLocalDate(range.from) > parseLocalDate(bounds.maxDate)) {
    const sentinel = shiftLocalDate(bounds.maxDate, 1);
    return { from: sentinel, to: sentinel };
  }

  if (bounds.maxDate) {
    const sentinel = shiftLocalDate(bounds.maxDate, 1);
    return { from: sentinel, to: sentinel };
  }

  if (bounds.minDate) {
    const sentinel = shiftLocalDate(bounds.minDate, -1);
    return { from: sentinel, to: sentinel };
  }

  return {
    from: '1970-01-01',
    to: '1970-01-01',
  };
}

function clampRange(
  range: Pick<UsageFilters, 'from' | 'to'>,
  bounds: Pick<FilterOptions, 'minDate' | 'maxDate'>,
): Pick<UsageFilters, 'from' | 'to'> {
  if (!range.from || !range.to) {
    return range;
  }

  let from = parseLocalDate(range.from);
  let to = parseLocalDate(range.to);

  if (bounds.minDate) {
    const minDate = parseLocalDate(bounds.minDate);
    if (from < minDate) {
      from = minDate;
    }
  }

  if (bounds.maxDate) {
    const maxDate = parseLocalDate(bounds.maxDate);
    if (to > maxDate) {
      to = maxDate;
    }
  }

  if (from > to) {
    return getEmptyClampedRange(range, bounds);
  }

  return {
    from: toLocalDateString(from),
    to: toLocalDateString(to),
  };
}

export function getPresetFilters(
  preset: ExportPeriodPreset,
  today: Date,
  bounds: Pick<FilterOptions, 'minDate' | 'maxDate'>,
): Pick<UsageFilters, 'from' | 'to'> {
  switch (preset) {
    case 'all':
      return {};
    case 'last-7-days':
      return clampRange(
        {
          from: toLocalDateString(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)),
          to: toLocalDateString(today),
        },
        bounds,
      );
    case 'this-month':
      return clampRange(
        {
          from: toLocalDateString(new Date(today.getFullYear(), today.getMonth(), 1)),
          to: toLocalDateString(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
        },
        bounds,
      );
    case 'previous-month':
      return clampRange(
        {
          from: toLocalDateString(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
          to: toLocalDateString(new Date(today.getFullYear(), today.getMonth(), 0)),
        },
        bounds,
      );
  }
}

export function validateExportFilters(filters: UsageFilters): string | null {
  if (!filters.from || !filters.to) {
    return null;
  }

  return filters.from <= filters.to ? null : 'Start date must be on or before end date.';
}
