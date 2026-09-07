import { contextBridge, ipcRenderer } from 'electron';
import type { UsageFilters } from './shared/types';

contextBridge.exposeInMainWorld('api', {
  getFilterOptions: () => ipcRenderer.invoke('get-filter-options'),
  getUsage: (filters: UsageFilters) => ipcRenderer.invoke('get-usage', filters),
});
