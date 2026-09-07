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
    <div className="filter-bar">
      <label htmlFor="project-filter">Project</label>
      <select
        id="project-filter"
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

      <label htmlFor="model-filter">Model</label>
      <select
        id="model-filter"
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

      <label htmlFor="from-filter">From</label>
      <input
        id="from-filter"
        type="date"
        value={filters.from ?? ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => update({ from: event.target.value || undefined })}
      />

      <label htmlFor="to-filter">To</label>
      <input
        id="to-filter"
        type="date"
        value={filters.to ?? ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => update({ to: event.target.value || undefined })}
      />
    </div>
  );
}
