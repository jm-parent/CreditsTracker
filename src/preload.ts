import { contextBridge, ipcRenderer } from 'electron';
import type {
  HourlyDetailParams,
  HourlyPoint,
  ProjectDetailResult,
  RawTableParams,
  RawTablePage,
  UsageFilters,
  WeeklyActivityPoint,
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
  getWeeklyActivity: (filters: UsageFilters): Promise<WeeklyActivityPoint[]> =>
    ipcRenderer.invoke('get-weekly-activity', filters),
});
