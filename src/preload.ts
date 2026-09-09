import { contextBridge, ipcRenderer } from 'electron';
import type {
  HourlyDetailParams,
  HourlyPoint,
  MonthlyActivityParams,
  ProjectDetailResult,
  RawTableParams,
  RawTablePage,
  TimeSeriesPoint,
  UsageFilters,
} from './shared/types';

contextBridge.exposeInMainWorld('api', {
  getFilterOptions: () => ipcRenderer.invoke('get-filter-options'),
  getUsage: (filters: UsageFilters) => ipcRenderer.invoke('get-usage', filters),
  getProjectDetail: (params: UsageFilters & { project: string }): Promise<ProjectDetailResult> =>
    ipcRenderer.invoke('get-project-detail', params),
  getRawTablePage: (params: RawTableParams): Promise<RawTablePage> =>
    ipcRenderer.invoke('get-raw-table-page', params),
  getHourlyDetail: (params: HourlyDetailParams): Promise<HourlyPoint[]> =>
    ipcRenderer.invoke('get-hourly-detail', params),
  getMonthlyActivity: (params: MonthlyActivityParams): Promise<TimeSeriesPoint[]> =>
    ipcRenderer.invoke('get-monthly-activity', params),
});
