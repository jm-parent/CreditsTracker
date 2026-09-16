import type { ChangeEvent } from 'react';
import type { FilterOptions, UsageFilters } from '../../shared/types';
import type { ExportPeriodPreset } from '../lib/export-periods';

export interface ExportFiltersProps {
  options: FilterOptions;
  filters: UsageFilters;
  preset: ExportPeriodPreset;
  onFiltersChange: (filters: UsageFilters) => void;
  onPresetChange: (preset: ExportPeriodPreset) => void;
}

const PRESET_OPTIONS: Array<{ id: ExportPeriodPreset; label: string }> = [
  { id: 'all', label: 'All dates' },
  { id: 'last-7-days', label: 'Last 7 days' },
  { id: 'this-month', label: 'This month' },
  { id: 'previous-month', label: 'Previous month' },
];

function normalizeFilters(filters: UsageFilters): UsageFilters {
  const next = { ...filters };
  (Object.keys(next) as Array<keyof UsageFilters>).forEach((key) => {
    if (!next[key]) {
      delete next[key];
    }
  });
  return next;
}

export function ExportFilters({
  options,
  filters,
  preset,
  onFiltersChange,
  onPresetChange,
}: ExportFiltersProps) {
  function update(partial: Partial<UsageFilters>): void {
    onFiltersChange(normalizeFilters({ ...filters, ...partial }));
  }

  return (
    <div className="export-filters flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap gap-2">
        {PRESET_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onPresetChange(option.id)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              preset === option.id
                ? 'bg-primary text-primary-foreground'
                : 'border border-border text-foreground hover:bg-muted'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="export-project-filter" className="text-xs font-medium text-muted-foreground">
            Project
          </label>
          <select
            id="export-project-filter"
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            value={filters.project ?? ''}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              update({ project: event.target.value || undefined })
            }
          >
            <option value="">All projects</option>
            {options.projects.map((project) => (
              <option key={project} value={project}>
                {project}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="export-model-filter" className="text-xs font-medium text-muted-foreground">
            Model
          </label>
          <select
            id="export-model-filter"
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            value={filters.model ?? ''}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => update({ model: event.target.value || undefined })}
          >
            <option value="">All models</option>
            {options.models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="export-from" className="text-xs font-medium text-muted-foreground">
            From
          </label>
          <input
            id="export-from"
            type="date"
            value={filters.from ?? ''}
            min={options.minDate ?? undefined}
            max={options.maxDate ?? undefined}
            onChange={(event: ChangeEvent<HTMLInputElement>) => update({ from: event.target.value || undefined })}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="export-to" className="text-xs font-medium text-muted-foreground">
            To
          </label>
          <input
            id="export-to"
            type="date"
            value={filters.to ?? ''}
            min={options.minDate ?? undefined}
            max={options.maxDate ?? undefined}
            onChange={(event: ChangeEvent<HTMLInputElement>) => update({ to: event.target.value || undefined })}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>
    </div>
  );
}
