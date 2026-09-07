import { ipcMain } from 'electron';
import { openDatabase, getFilterOptions, getUsage, getProjectDetail, getRawTablePage, getHourlyDetail } from './db';
import type { HourlyDetailParams, RawTableParams, UsageFilters } from '../shared/types';

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

  ipcMain.handle('get-hourly-detail', (_event, params: HourlyDetailParams) => {
    return getHourlyDetail(db, params);
  });
}
