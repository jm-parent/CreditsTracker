import type {
  FilterOptions,
  HourlyDetailParams,
  HourlyPoint,
  MonthlyActivityParams,
  ProjectDetailResult,
  RawTableParams,
  RawTablePage,
  TimeSeriesPoint,
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
      getHourlyDetail: (params: HourlyDetailParams) => Promise<HourlyPoint[]>;
      getMonthlyActivity: (params: MonthlyActivityParams) => Promise<TimeSeriesPoint[]>;
    };
  }
}

export {};
