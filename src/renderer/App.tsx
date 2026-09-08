import { useEffect, useState } from 'react';
import { useUsageData } from './hooks/useUsageData';
import { useHourlyDetail } from './hooks/useHourlyDetail';
import { EmptyState } from './components/EmptyState';
import { FilterBar } from './components/FilterBar';
import { Sidebar, type DashboardTab } from './components/Sidebar';
import { DailyConsumptionPage } from './components/DailyConsumptionPage';
import { ProjectsPage } from './components/ProjectsPage';
import { ModelsPage } from './components/ModelsPage';
import { ProjectDetailPage } from './components/ProjectDetailPage';
import { RawDataPage } from './components/RawDataPage';
import { HourlyDetailPanel } from './components/HourlyDetailPanel';
import { Skeleton } from './components/ui/skeleton';
import type { FilterOptions, UsageFilters } from '../shared/types';

const EMPTY_OPTIONS: FilterOptions = { projects: [], models: [], minDate: null, maxDate: null };

export function App() {
  const [options, setOptions] = useState<FilterOptions>(EMPTY_OPTIONS);
  const [optionsError, setOptionsError] = useState<Error | null>(null);
  const [filters, setFilters] = useState<UsageFilters>({});
  const [activeTab, setActiveTab] = useState<DashboardTab>('daily');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const { data, loading, error } = useUsageData(filters);
  const hourlyDetail = useHourlyDetail(selectedDate, filters);

  useEffect(() => {
    window.api
      .getFilterOptions()
      .then(setOptions)
      .catch((err) => setOptionsError(err instanceof Error ? err : new Error(String(err))));
  }, []);

  function handleTabChange(tab: DashboardTab): void {
    setActiveTab(tab);
    setSelectedProject(null);
    setSelectedDate(null);
  }

  if ((optionsError || error) && !data) {
    return (
      <EmptyState
        title="Couldn't load Copilot CLI usage data."
        message="Make sure Copilot CLI has been used on this machine, then reopen the app."
      />
    );
  }

  return (
    <div className="app flex h-screen bg-background">
      <Sidebar activeTab={activeTab} onTabChange={handleTabChange} />
      <div className="flex-1 overflow-y-auto px-6 py-8">
        {!selectedProject && (
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-2xl font-semibold text-foreground">Credits Dashboard</h1>
          </div>
        )}
        {activeTab === 'raw' && !selectedProject ? (
          <RawDataPage onBack={() => setActiveTab('daily')} />
        ) : (
          <>
            {!selectedProject && <FilterBar options={options} filters={filters} onChange={setFilters} />}
            {error && data && (
              <p className="refresh-notice mt-4 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
                Couldn't refresh — showing last known data.
              </p>
            )}
            {loading && !data && (
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            )}
            {data && selectedProject && (
              <div className="mt-6">
                <ProjectDetailPage
                  project={selectedProject}
                  filters={filters}
                  options={options}
                  onFiltersChange={setFilters}
                  onBack={() => setSelectedProject(null)}
                />
              </div>
            )}
            {data && !selectedProject && activeTab === 'daily' && (
              <div className="mt-6">
                <DailyConsumptionPage
                  totals={data.totals}
                  timeSeries={data.timeSeries}
                  onDayClick={setSelectedDate}
                />
              </div>
            )}
            {data && !selectedProject && activeTab === 'projects' && (
              <div className="mt-6">
                <ProjectsPage byProject={data.byProject} onProjectClick={setSelectedProject} />
              </div>
            )}
            {data && !selectedProject && activeTab === 'models' && (
              <div className="mt-6">
                <ModelsPage byModel={data.byModel} />
              </div>
            )}
          </>
        )}
      </div>
      {selectedDate && (
        <HourlyDetailPanel
          date={selectedDate}
          data={hourlyDetail.data}
          loading={hourlyDetail.loading}
          error={hourlyDetail.error}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
}
