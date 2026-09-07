import type { ChangeEvent } from 'react';
import type { FilterOptions, UsageFilters } from '../../shared/types';

interface FilterBarProps {
  options: FilterOptions;
  filters: UsageFilters;
  onChange: (filters: UsageFilters) => void;
}

export function FilterBar({ options, filters, onChange }: FilterBarProps) {
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
      <div className="flex flex-col gap-1">
        <label htmlFor="project-filter" className="text-xs font-medium text-muted-foreground">
          Project
        </label>
        <select
          id="project-filter"
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          value={filters.project ?? ''}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => update({ project: event.target.value || undefined })}
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

      <div className="flex flex-col gap-1">
        <label htmlFor="from-filter" className="text-xs font-medium text-muted-foreground">
          From
        </label>
        <input
          id="from-filter"
          type="date"
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          value={filters.from ?? ''}
          onChange={(event: ChangeEvent<HTMLInputElement>) => update({ from: event.target.value || undefined })}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="to-filter" className="text-xs font-medium text-muted-foreground">
          To
        </label>
        <input
          id="to-filter"
          type="date"
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          value={filters.to ?? ''}
          onChange={(event: ChangeEvent<HTMLInputElement>) => update({ to: event.target.value || undefined })}
        />
      </div>
    </div>
  );
}
