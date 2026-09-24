import { contextBridge, ipcRenderer } from 'electron';
import type {
  AgentTraceCollectionStatus,
  AgentTraceSelection,
  AgentTraceSession,
  ExportPreview,
  ExportRequest,
  ExportResult,
  HourlyDetailParams,
  HourlyPoint,
  LogsSnapshot,
  MonthlyActivityParams,
  ProjectDetailResult,
  RawTableParams,
  RawTablePage,
  RendererLogInput,
  TimeSeriesPoint,
  UpdateState,
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
  getExportPreview: (filters: UsageFilters): Promise<ExportPreview> =>
    ipcRenderer.invoke('get-export-preview', filters),
  exportHtml: (request: ExportRequest): Promise<ExportResult> =>
    ipcRenderer.invoke('export-html', request),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),
  getUpdateState: (): Promise<UpdateState> => ipcRenderer.invoke('get-update-state'),
  checkForUpdate: (): Promise<UpdateState> => ipcRenderer.invoke('check-for-update'),
  downloadUpdate: (): Promise<UpdateState> => ipcRenderer.invoke('download-update'),
  restartToUpdate: (): Promise<void> => ipcRenderer.invoke('restart-to-update'),
  // Returns an unsubscribe function so React effects can detach the listener
  // on unmount instead of leaking one per mount.
  onUpdateStateChange: (listener: (state: UpdateState) => void): (() => void) => {
    const handler = (_event: unknown, state: UpdateState) => listener(state);
    ipcRenderer.on('update-state-changed', handler);
    return () => {
      ipcRenderer.removeListener('update-state-changed', handler);
    };
  },
  shouldPromptDesktopShortcut: (): Promise<boolean> => ipcRenderer.invoke('should-prompt-desktop-shortcut'),
  createDesktopShortcut: (): Promise<boolean> => ipcRenderer.invoke('create-desktop-shortcut'),
  getAgentTraceCollectionStatus: (): Promise<AgentTraceCollectionStatus> =>
    ipcRenderer.invoke('get-agent-trace-collection-status'),
  setAgentTraceCollectionEnabled: (enabled: boolean): Promise<AgentTraceCollectionStatus> =>
    ipcRenderer.invoke('set-agent-trace-collection-enabled', enabled),
  getAgentTraceSession: (selection: AgentTraceSelection): Promise<AgentTraceSession> =>
    ipcRenderer.invoke('get-agent-trace-session', selection),
  clearAgentTraceData: (): Promise<void> => ipcRenderer.invoke('clear-agent-trace-data'),
  getLogs: (): Promise<LogsSnapshot> => ipcRenderer.invoke('get-logs'),
  clearLogs: (): Promise<LogsSnapshot> => ipcRenderer.invoke('clear-logs'),
  openLogFile: (): Promise<string | null> => ipcRenderer.invoke('open-log-file'),
  openExternalUrl: (url: string): Promise<void> => ipcRenderer.invoke('open-external-url', url),
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
