import { ipcMain } from 'electron';
import { openDatabase, getFilterOptions, getUsage, getProjectDetail, getRawTablePage } from './db';
import type { RawTableParams, UsageFilters } from '../shared/types';

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

  ipcMain.handle('get-raw-table-page', (_event, params: RawTableParams) => {
    return getRawTablePage(db, params.table, params.page, params.pageSize);
  });
}
