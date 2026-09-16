import type { ChangeEvent } from 'react';
import type { FilterOptions, UsageFilters } from '../../shared/types';

interface FilterBarProps {
  options: FilterOptions;
  filters: UsageFilters;
  onChange: (filters: UsageFilters) => void;
  showProjectFilter?: boolean;
}

export function FilterBar({ options, filters, onChange, showProjectFilter = true }: FilterBarProps) {
  function update(partial: Partial<UsageFilters>): void {
    const next: UsageFilters = { ...filters, ...partial };
    (Object.keys(next) as Array<keyof UsageFilters>).forEach((key) => {
      if (!next[key]) {
        delete next[key];
      }
    });
    onChange(next);
  }

  return (
    <div className="filter-bar flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card p-4">
      {showProjectFilter && (
        <div className="flex flex-col gap-1">
          <label htmlFor="project-filter" className="text-xs font-medium text-muted-foreground">
            Project path
          </label>
          <input
            id="project-filter"
            type="text"
            placeholder="Search project path"
            className="min-w-64 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            value={filters.projectSearch ?? ''}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              update({ projectSearch: event.target.value.trim() ? event.target.value : undefined })
            }
          />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="model-filter" className="text-xs font-medium text-muted-foreground">
          Model
        </label>
        <select
          id="model-filter"
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
    </div>
  );
}
