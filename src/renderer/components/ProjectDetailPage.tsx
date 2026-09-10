import { useProjectDetail } from '../hooks/useProjectDetail';
import { FilterBar } from './FilterBar';
import { SummaryCards } from './SummaryCards';
import { TimeSeriesChart } from './TimeSeriesChart';
import { ConversationsTable } from './ConversationsTable';
import { Skeleton } from './ui/skeleton';
import type { FilterOptions, UsageFilters } from '../../shared/types';

interface ProjectDetailPageProps {
  project: string;
  filters: UsageFilters;
  options: FilterOptions;
  onFiltersChange: (filters: UsageFilters) => void;
  onBack: () => void;
}

export function ProjectDetailPage({
  project,
  filters,
  options,
  onFiltersChange,
  onBack,
}: ProjectDetailPageProps) {
  const { data, loading, error } = useProjectDetail(project, filters);
  const updateContextKey = JSON.stringify({
    project,
    model: filters.model ?? null,
    from: filters.from ?? null,
    to: filters.to ?? null,
  });

  return (
    <div className="project-detail-page flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          ← Back
        </button>
        <h2 className="text-xl font-semibold text-foreground">{project}</h2>
      </div>

      <FilterBar options={options} filters={filters} onChange={onFiltersChange} showProjectFilter={false} />

      {error && !data && (
        <p className="text-sm text-muted-foreground">Couldn't load details for this project.</p>
      )}

      {error && data && (
        <p className="refresh-notice rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          Couldn't refresh — showing last known data.
        </p>
      )}

      {loading && !data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {data && (
        <>
          <SummaryCards totals={data.totals} updateContextKey={updateContextKey} />
          <TimeSeriesChart data={data.timeSeries} />
          <ConversationsTable conversations={data.conversations} updateContextKey={updateContextKey} />
        </>
      )}
    </div>
  );
}
