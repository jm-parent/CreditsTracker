import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLogs,
  configureLogFile,
  getLogEntries,
  getLogFilePath,
  logError,
  logInfo,
  logOnce,
  recordRendererLog,
  resetLoggerForTests,
} from './logger';

let tempDir: string;

beforeEach(() => {
  resetLoggerForTests();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'credits-tracker-logs-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
  resetLoggerForTests();
});

describe('logger', () => {
  it('buffers entries with level, scope, source and timestamp', () => {
    logInfo('startup', 'App started');

    const [entry] = getLogEntries();
    expect(entry).toMatchObject({ level: 'info', scope: 'startup', message: 'App started', source: 'main' });
    expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);
  });

  it('serializes an Error detail into its stack trace', () => {
    logError('db', 'Query failed', new Error('boom'));

    expect(getLogEntries()[0].detail).toContain('boom');
  });

  it('serializes an object detail as JSON', () => {
    logInfo('startup', 'Config', { dbPath: 'C:/db.sqlite' });

    expect(getLogEntries()[0].detail).toBe('{"dbPath":"C:/db.sqlite"}');
  });

  it('tags renderer entries and falls back to info for unknown levels', () => {
    recordRendererLog({ level: 'bogus' as never, scope: 'ModelsPage', message: 'render failed' });

    expect(getLogEntries()[0]).toMatchObject({ level: 'info', source: 'renderer', scope: 'ModelsPage' });
  });

  it('appends entries to the configured log file', () => {
    const filePath = path.join(tempDir, 'app.log');
    configureLogFile(filePath);

    logError('ipc', 'get-usage failed', new Error('db locked'));

    expect(getLogFilePath()).toBe(filePath);
    const contents = fs.readFileSync(filePath, 'utf8');
    expect(contents).toContain('ERROR [main/ipc] get-usage failed');
    expect(contents).toContain('db locked');
  });

  it('clears the buffer and truncates the file', () => {
    const filePath = path.join(tempDir, 'app.log');
    configureLogFile(filePath);
    logInfo('startup', 'App started');

    clearLogs();

    expect(getLogEntries()).toHaveLength(0);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('');
  });

  it('keeps logging in memory when the log file cannot be written', () => {
    configureLogFile(path.join(tempDir, 'app.log'));
    vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('EPERM');
    });

    logInfo('startup', 'App started');

    expect(getLogEntries()).toHaveLength(1);
  });

  it('logOnce only emits the first entry for a given key', () => {
    logOnce('db-built:1:2', 'info', 'db', 'Merged database rebuilt');
    logOnce('db-built:1:2', 'info', 'db', 'Merged database rebuilt');
    logOnce('db-built:3:4', 'info', 'db', 'Merged database rebuilt');

    expect(getLogEntries()).toHaveLength(2);
  });
});
