import type {
  FilterOptions,
  HourlyDetailParams,
  HourlyPoint,
  LogsSnapshot,
  MonthlyActivityParams,
  ProjectDetailResult,
  RawTableParams,
  RawTablePage,
  RendererLogInput,
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
      getAppVersion: () => Promise<string>;
      getLogs: () => Promise<LogsSnapshot>;
      clearLogs: () => Promise<LogsSnapshot>;
      openLogFile: () => Promise<string | null>;
      log: (entry: RendererLogInput) => Promise<void>;
    };
  }
}

export {};
