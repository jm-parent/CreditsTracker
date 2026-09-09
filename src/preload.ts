import { contextBridge, ipcRenderer } from 'electron';
import type {
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
} from './shared/types';

function serializeDetail(detail: unknown): string | undefined {
  if (detail === undefined || detail === null) {
    return undefined;
  }
  if (typeof detail === 'string') {
    return detail;
  }
  if (detail instanceof Error) {
    return detail.stack ?? `${detail.name}: ${detail.message}`;
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

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
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),
  getLogs: (): Promise<LogsSnapshot> => ipcRenderer.invoke('get-logs'),
  clearLogs: (): Promise<LogsSnapshot> => ipcRenderer.invoke('clear-logs'),
  openLogFile: (): Promise<string | null> => ipcRenderer.invoke('open-log-file'),
  log: (entry: RendererLogInput): Promise<void> =>
    ipcRenderer.invoke('log-message', {
      level: entry.level,
      scope: entry.scope,
      message: entry.message,
      // Errors and other non-cloneable values would break structured cloning
      // over IPC, so the detail is flattened to a string here.
      detail: serializeDetail(entry.detail),
    }),
});
