import { contextBridge, ipcRenderer } from 'electron';
import type { ProjectDetailResult, UsageFilters } from './shared/types';

contextBridge.exposeInMainWorld('api', {
  getFilterOptions: () => ipcRenderer.invoke('get-filter-options'),
  getUsage: (filters: UsageFilters) => ipcRenderer.invoke('get-usage', filters),
  getProjectDetail: (params: UsageFilters & { project: string }): Promise<ProjectDetailResult> =>
    ipcRenderer.invoke('get-project-detail', params),
});
