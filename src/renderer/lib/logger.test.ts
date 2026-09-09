import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installGlobalErrorLogging, logError, logInfo, resetLogDedupeForTests } from './logger';

beforeEach(() => {
  resetLogDedupeForTests();
  window.api = { ...window.api, log: vi.fn().mockResolvedValue(undefined) } as typeof window.api;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('renderer logger', () => {
  it('forwards entries to the main process', () => {
    logInfo('App', 'Navigating to the "models" tab');

    expect(window.api.log).toHaveBeenCalledWith({
      level: 'info',
      scope: 'App',
      message: 'Navigating to the "models" tab',
      detail: undefined,
    });
  });

  it('drops repeated identical entries so polling failures do not flood the log', () => {
    logError('useUsageData', 'getUsage failed', new Error('db not found'));
    logError('useUsageData', 'getUsage failed', new Error('db not found'));

    expect(window.api.log).toHaveBeenCalledTimes(1);
  });

  it('never throws when the preload bridge is unavailable', () => {
    (window as unknown as { api: undefined }).api = undefined;

    expect(() => logInfo('App', 'no bridge')).not.toThrow();
  });

  it('logs uncaught renderer errors and unhandled rejections', () => {
    installGlobalErrorLogging(window);

    window.dispatchEvent(
      new ErrorEvent('error', { message: 'boom', error: new Error('boom') }),
    );

    expect(window.api.log).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', scope: 'window', message: 'boom' }),
    );
  });
});
