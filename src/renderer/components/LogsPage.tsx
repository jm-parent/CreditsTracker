import { useMemo, useState } from 'react';
import { useLogs } from '../hooks/useLogs';
import { Skeleton } from './ui/skeleton';
import { logError, logInfo } from '../lib/logger';
import type { LogEntry, LogLevel } from '../../shared/types';

const LEVELS: Array<{ id: LogLevel | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'debug', label: 'Debug' },
  { id: 'info', label: 'Info' },
  { id: 'warn', label: 'Warnings' },
  { id: 'error', label: 'Errors' },
];

/** Levels ordered by severity, used by the "minimum level" filter. */
const SEVERITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const LEVEL_CLASSES: Record<LogLevel, string> = {
  debug: 'text-muted-foreground',
  info: 'text-foreground',
  warn: 'text-amber-600 dark:text-amber-400',
  error: 'text-red-600 dark:text-red-400',
};

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

function toPlainText(entries: LogEntry[]): string {
  return entries
    .map(
      (entry) =>
        `${entry.timestamp} ${entry.level.toUpperCase()} [${entry.source}/${entry.scope}] ${entry.message}` +
        (entry.detail ? `\n    ${entry.detail.replace(/\n/g, '\n    ')}` : ''),
    )
    .join('\n');
}

export function LogsPage() {
  const [minLevel, setMinLevel] = useState<LogLevel | 'all'>('all');
  const [search, setSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [copied, setCopied] = useState(false);
  const { data, loading, error, refresh, clear } = useLogs(autoRefresh);

  const entries = data?.entries ?? [];

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries
      .filter((entry) => minLevel === 'all' || SEVERITY[entry.level] >= SEVERITY[minLevel])
      .filter(
        (entry) =>
          !needle ||
          entry.message.toLowerCase().includes(needle) ||
          entry.scope.toLowerCase().includes(needle) ||
          (entry.detail ?? '').toLowerCase().includes(needle),
      )
      .slice()
      .reverse();
  }, [entries, minLevel, search]);

  const errorCount = entries.filter((entry) => entry.level === 'error').length;
  const warnCount = entries.filter((entry) => entry.level === 'warn').length;

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(toPlainText(visible));
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
      logInfo('LogsPage', `Copied ${visible.length} log entries to the clipboard`);
    } catch (err) {
      logError('LogsPage', 'Failed to copy logs to the clipboard', err);
    }
  }

  async function handleOpenFile(): Promise<void> {
    try {
      await window.api.openLogFile();
    } catch (err) {
      logError('LogsPage', 'Failed to reveal the log file', err);
    }
  }

  async function handleCheckForUpdates(): Promise<void> {
    try {
      await window.api.checkForUpdate();
      await refresh();
    } catch (err) {
      logError('LogsPage', 'Failed to check for updates from the Logs page', err);
    }
  }

  return (
    <div className="logs-page flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-foreground">Application logs</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCheckForUpdates}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            Check for updates
          </button>
          <button
            type="button"
            onClick={() => refresh()}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={handleOpenFile}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            Open log folder
          </button>
          <button
            type="button"
            onClick={() => clear()}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          {LEVELS.map((level) => (
            <button
              key={level.id}
              type="button"
              onClick={() => setMinLevel(level.id)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                minLevel === level.id
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border text-foreground hover:bg-muted'
              }`}
            >
              {level.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search logs"
          aria-label="Search logs"
          className="min-w-48 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(event) => setAutoRefresh(event.target.checked)}
          />
          Auto-refresh
        </label>
      </div>

      <p className="text-sm text-muted-foreground">
        {entries.length} entries ({errorCount} errors, {warnCount} warnings)
        {data?.filePath ? ` — file: ${data.filePath}` : ' — file logging unavailable'}
      </p>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Couldn't load logs: {error.message}</p>}

      {loading && !data && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      )}

      {data && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">No log entries match the current filters.</p>
      )}

      {visible.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {visible.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-1 px-3 py-2 font-mono text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">{formatTimestamp(entry.timestamp)}</span>
                <span className={`font-semibold uppercase ${LEVEL_CLASSES[entry.level]}`}>{entry.level}</span>
                <span className="text-muted-foreground">
                  [{entry.source}/{entry.scope}]
                </span>
                <span className="text-foreground">{entry.message}</span>
              </div>
              {entry.detail && (
                <pre className="overflow-x-auto whitespace-pre-wrap text-muted-foreground">{entry.detail}</pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
