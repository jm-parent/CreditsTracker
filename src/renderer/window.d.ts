import type {
  FilterOptions,
  ProjectDetailResult,
  RawTableParams,
  RawTablePage,
  UsageFilters,
  UsageResult,
} from '../shared/types';

declare global {
  interface Window {
    api: {
      getFilterOptions: () => Promise<FilterOptions>;
      getUsage: (filters: UsageFilters) => Promise<UsageResult>;
      getProjectDetail: (params: UsageFilters & { project: string }) => Promise<ProjectDetailResult>;
      getRawTablePage: (params: RawTableParams) => Promise<RawTablePage>;
    };
  }
}

export {};
