import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LogsPage } from './LogsPage';
import type { LogEntry, LogsSnapshot } from '../../shared/types';

const entries: LogEntry[] = [
  {
    id: 1,
    timestamp: '2026-09-09T10:00:00.000Z',
    level: 'info',
    scope: 'startup',
    message: 'Credits Tracker starting',
    source: 'main',
  },
  {
    id: 2,
    timestamp: '2026-09-09T10:00:01.000Z',
    level: 'error',
    scope: 'ModelsPage',
    message: 'Rendering failed: cannot read properties of undefined',
    detail: 'Error: cannot read properties of undefined\n    at ModelTable',
    source: 'renderer',
  },
];

const snapshot: LogsSnapshot = { entries, filePath: 'C:\\Users\\me\\AppData\\Roaming\\app\\logs\\app.log' };

beforeEach(() => {
  window.api = {
    ...window.api,
    getLogs: vi.fn().mockResolvedValue(snapshot),
    clearLogs: vi.fn().mockResolvedValue({ entries: [], filePath: snapshot.filePath }),
    openLogFile: vi.fn().mockResolvedValue(snapshot.filePath),
    checkForUpdate: vi.fn().mockResolvedValue({ status: 'up-to-date', currentVersion: '1.6.0' }),
    log: vi.fn().mockResolvedValue(undefined),
  } as typeof window.api;
});

describe('LogsPage', () => {
  it('lists log entries newest first with their detail', async () => {
    render(<LogsPage />);

    expect(await screen.findByText('Rendering failed: cannot read properties of undefined')).toBeInTheDocument();
    expect(screen.getByText(/at ModelTable/)).toBeInTheDocument();
    const messages = screen.getAllByText(/Credits Tracker starting|Rendering failed/);
    expect(messages[0].textContent).toContain('Rendering failed');
  });

  it('shows the log file path and the error/warning counts', async () => {
    render(<LogsPage />);

    expect(await screen.findByText(/2 entries \(1 errors, 0 warnings\)/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(snapshot.filePath!.replace(/\\/g, '\\\\')))).toBeInTheDocument();
  });

  it('filters by minimum level', async () => {
    const user = userEvent.setup();
    render(<LogsPage />);
    await screen.findByText('Credits Tracker starting');

    await user.click(screen.getByRole('button', { name: 'Errors' }));

    expect(screen.queryByText('Credits Tracker starting')).not.toBeInTheDocument();
    expect(screen.getByText('Rendering failed: cannot read properties of undefined')).toBeInTheDocument();
  });

  it('filters by search text', async () => {
    const user = userEvent.setup();
    render(<LogsPage />);
    await screen.findByText('Credits Tracker starting');

    await user.type(screen.getByLabelText('Search logs'), 'ModelTable');

    expect(screen.queryByText('Credits Tracker starting')).not.toBeInTheDocument();
    expect(screen.getByText('Rendering failed: cannot read properties of undefined')).toBeInTheDocument();
  });

  it('clears logs through the bridge', async () => {
    const user = userEvent.setup();
    render(<LogsPage />);
    await screen.findByText('Credits Tracker starting');

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(window.api.clearLogs).toHaveBeenCalled();
    expect(await screen.findByText(/No log entries match the current filters./)).toBeInTheDocument();
  });

  it('reveals the log file when asked', async () => {
    const user = userEvent.setup();
    render(<LogsPage />);
    await screen.findByText('Credits Tracker starting');

    await user.click(screen.getByRole('button', { name: 'Open log folder' }));

    expect(window.api.openLogFile).toHaveBeenCalled();
  });

  it('checks for updates and refreshes logs when asked', async () => {
    const user = userEvent.setup();
    render(<LogsPage />);
    await screen.findByText('Credits Tracker starting');

    await user.click(screen.getByRole('button', { name: 'Check for updates' }));

    expect(window.api.checkForUpdate).toHaveBeenCalled();
    expect(window.api.getLogs).toHaveBeenCalledTimes(2);
  });

  it('surfaces a message when logs cannot be read', async () => {
    window.api.getLogs = vi.fn().mockRejectedValue(new Error('IPC unavailable'));

    render(<LogsPage />);

    expect(await screen.findByText(/Couldn't load logs: IPC unavailable/)).toBeInTheDocument();
  });
});
