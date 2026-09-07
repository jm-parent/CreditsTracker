import type { FilterOptions, UsageFilters, UsageResult } from '../shared/types';

declare global {
  interface Window {
    api: {
      getFilterOptions: () => Promise<FilterOptions>;
      getUsage: (filters: UsageFilters) => Promise<UsageResult>;
    };
  }
}

export {};
