import { vi } from 'vitest';

export function createWindowApi(overrides: Partial<Window['api']> = {}): Window['api'] {
  return {
    getFilterOptions: vi.fn().mockResolvedValue({
      projects: [],
      models: [],
      minDate: null,
      maxDate: null,
    }),
    getUsage: vi.fn().mockResolvedValue({
      totals: { aiuCredits: 0, tokens: 0, requests: 0 },
      timeSeries: [],
      byProject: [],
      byModel: [],
    }),
    getProjectDetail: vi.fn().mockResolvedValue({
      project: '',
      totals: { aiuCredits: 0, tokens: 0, requests: 0 },
      timeSeries: [],
      conversations: [],
    }),
    getRawTablePage: vi.fn().mockResolvedValue({
      columns: [],
      rows: [],
      total: 0,
      page: 0,
      pageSize: 50,
    }),
    getHourlyDetail: vi.fn().mockResolvedValue([]),
    getMonthlyActivity: vi.fn().mockResolvedValue([]),
    getExportPreview: vi.fn().mockResolvedValue({
      totals: { aiuCredits: 0, tokens: 0, requests: 0 },
      sessionCount: 0,
      activeDays: 0,
      byModel: [],
      daily: [],
    }),
    exportHtml: vi.fn().mockResolvedValue({ cancelled: true }),
    getAppVersion: vi.fn().mockResolvedValue('1.0.0'),
    getUpdateState: vi.fn().mockResolvedValue({ status: 'up-to-date', currentVersion: '1.0.0' }),
    checkForUpdate: vi.fn().mockResolvedValue({ status: 'up-to-date', currentVersion: '1.0.0' }),
    downloadUpdate: vi.fn().mockResolvedValue({ status: 'downloading', currentVersion: '1.0.0' }),
    restartToUpdate: vi.fn().mockResolvedValue(undefined),
    onUpdateStateChange: vi.fn(() => () => {}),
    shouldPromptDesktopShortcut: vi.fn().mockResolvedValue(false),
    createDesktopShortcut: vi.fn().mockResolvedValue(true),
    getLogs: vi.fn().mockResolvedValue({ entries: [], filePath: null }),
    clearLogs: vi.fn().mockResolvedValue({ entries: [], filePath: null }),
    openLogFile: vi.fn().mockResolvedValue(null),
    openExternalUrl: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
