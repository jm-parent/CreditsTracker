import { ipcMain } from 'electron';
import { openDatabase, getFilterOptions, getUsage, getProjectDetail } from './db';
import type { UsageFilters } from '../shared/types';

export function registerIpcHandlers(dbPath: string): void {
  const db = openDatabase(dbPath);

  ipcMain.handle('get-filter-options', () => {
    return getFilterOptions(db);
  });

  ipcMain.handle('get-usage', (_event, filters: UsageFilters) => {
    return getUsage(db, filters ?? {});
  });

  ipcMain.handle('get-project-detail', (_event, params: UsageFilters & { project: string }) => {
    return getProjectDetail(db, params);
  });
}
