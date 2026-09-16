import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { FilterOptions, UsageFilters } from '../../shared/types';

const PROJECT_SEARCH_DEBOUNCE_MS = 300;

interface FilterBarProps {
  options: FilterOptions;
  filters: UsageFilters;
  onChange: (filters: UsageFilters) => void;
  showProjectFilter?: boolean;
}

export function FilterBar({ options, filters, onChange, showProjectFilter = true }: FilterBarProps) {
  const [projectSearchInput, setProjectSearchInput] = useState(filters.projectSearch ?? '');
  const filtersRef = useRef(filters);
  const onChangeRef = useRef(onChange);
  const projectSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committedProjectSearchRef = useRef(filters.projectSearch ?? '');

  filtersRef.current = filters;
  onChangeRef.current = onChange;

  useEffect(() => {
    const nextProjectSearch = filters.projectSearch ?? '';
    if (nextProjectSearch === committedProjectSearchRef.current) {
      return;
    }

    committedProjectSearchRef.current = nextProjectSearch;
    setProjectSearchInput(nextProjectSearch);
    if (projectSearchTimerRef.current !== null) {
      clearTimeout(projectSearchTimerRef.current);
      projectSearchTimerRef.current = null;
    }
  }, [filters.projectSearch]);

  useEffect(() => {
    return () => {
      if (projectSearchTimerRef.current !== null) {
        clearTimeout(projectSearchTimerRef.current);
      }
    };
  }, []);

  function update(partial: Partial<UsageFilters>): void {
    const next: UsageFilters = { ...filters, ...partial };
    (Object.keys(next) as Array<keyof UsageFilters>).forEach((key) => {
      if (!next[key]) {
        delete next[key];
      }
    });
    onChange(next);
  }

  function handleProjectSearchChange(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value;
    setProjectSearchInput(value);

    if (projectSearchTimerRef.current !== null) {
      clearTimeout(projectSearchTimerRef.current);
    }

    projectSearchTimerRef.current = setTimeout(() => {
      projectSearchTimerRef.current = null;
      const projectSearch = value.trim() ? value : undefined;
      const next: UsageFilters = { ...filtersRef.current, projectSearch };
      (Object.keys(next) as Array<keyof UsageFilters>).forEach((key) => {
        if (!next[key]) {
          delete next[key];
        }
      });
      committedProjectSearchRef.current = projectSearch ?? '';
      onChangeRef.current(next);
    }, PROJECT_SEARCH_DEBOUNCE_MS);
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
            value={projectSearchInput}
            onChange={handleProjectSearchChange}
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
