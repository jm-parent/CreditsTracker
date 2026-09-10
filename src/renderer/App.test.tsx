import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { resetLogDedupeForTests } from './lib/logger';
import type { FilterOptions, ProjectDetailResult, UsageResult } from '../shared/types';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');

  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <actual.ResponsiveContainer width={600} height={240}>
        {children}
      </actual.ResponsiveContainer>
    ),
  };
});
const options: FilterOptions = {
  projects: ['org/repo-a'],
  models: ['claude-sonnet-5'],
  minDate: '2026-09-01',
  maxDate: '2026-09-07',
};

const usage: UsageResult = {
  totals: { aiuCredits: 3, tokens: 120, requests: 1 },
  timeSeries: [{ date: '2026-09-01', aiuCredits: 3 }],
  byProject: [{ key: 'org/repo-a', aiuCredits: 1.5 }],
  byModel: [{ key: 'claude-sonnet-5', aiuCredits: 1.5 }],
};

const projectDetail: ProjectDetailResult = {
  project: 'org/repo-a',
  totals: { aiuCredits: 1.5, tokens: 60, requests: 1 },
  timeSeries: [{ date: '2026-09-01', aiuCredits: 1.5 }],
  conversations: [
    {
      sessionId: 's1',
      createdAt: '2026-09-01 10:00:00',
      summary: 'Fixed the login bug',
      models: 'claude-sonnet-5',
      aiuCredits: 1.5,
      tokens: 60,
      requests: 1,
    },
  ],
};

beforeEach(() => {
  resetLogDedupeForTests();
  window.api = {
    getFilterOptions: vi.fn().mockResolvedValue(options),
    getUsage: vi.fn().mockResolvedValue(usage),
    getProjectDetail: vi.fn().mockResolvedValue(projectDetail),
    getRawTablePage: vi.fn().mockResolvedValue({
      columns: ['id'],
      rows: [],
      total: 0,
      page: 0,
      pageSize: 50,
    }),
    getHourlyDetail: vi.fn().mockResolvedValue([]),
    getMonthlyActivity: vi.fn().mockResolvedValue([]),
    getAppVersion: vi.fn().mockResolvedValue('1.4.1'),
    getUpdateState: vi.fn().mockResolvedValue({ status: 'up-to-date', currentVersion: '1.4.1' }),
    checkForUpdate: vi.fn().mockResolvedValue({ status: 'up-to-date', currentVersion: '1.4.1' }),
    downloadUpdate: vi.fn().mockResolvedValue({ status: 'downloading', currentVersion: '1.4.1' }),
    restartToUpdate: vi.fn().mockResolvedValue(undefined),
    onUpdateStateChange: vi.fn(() => () => {}),
    shouldPromptDesktopShortcut: vi.fn().mockResolvedValue(false),
    createDesktopShortcut: vi.fn().mockResolvedValue(true),
    dismissDesktopShortcutPrompt: vi.fn().mockResolvedValue(undefined),
    getLogs: vi.fn().mockResolvedValue({ entries: [], filePath: 'C:\\logs\\app.log' }),
    clearLogs: vi.fn().mockResolvedValue({ entries: [], filePath: 'C:\\logs\\app.log' }),
    openLogFile: vi.fn().mockResolvedValue('C:\\logs\\app.log'),
    log: vi.fn().mockResolvedValue(undefined),
  };
});

describe('App', () => {
  it('loads filter options and usage data, then renders the dashboard', async () => {
    const { container } = render(<App />);

    expect(await screen.findByText('3.00')).toBeInTheDocument();
    expect(await screen.findByText('v1.4.1')).toBeInTheDocument();
    const summaryCards = container.querySelector('.summary-cards') as HTMLElement;
    expect(within(summaryCards).getByText('AIU credits')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'org/repo-a' })).toBeInTheDocument();
  });

  it('keeps the dashboard usable when version lookup fails', async () => {
    window.api.getAppVersion = vi.fn().mockRejectedValue(new Error('IPC unavailable'));

    render(<App />);

    expect(await screen.findByText('3.00')).toBeInTheDocument();
    expect(screen.queryByText(/^v/)).not.toBeInTheDocument();
  });

  it('switches to the monthly activity heatmap when the sidebar entry is clicked', async () => {
    const now = new Date();
    const day = 1;
    const monthlyPoint = {
      date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      aiuCredits: 2,
    };
    window.api.getMonthlyActivity = vi.fn().mockResolvedValue([monthlyPoint]);
    const expectedLabel = new Date(now.getFullYear(), now.getMonth(), day).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('3.00');

    await user.click(screen.getByRole('button', { name: 'Monthly activity' }));

    expect(await screen.findByLabelText(`${expectedLabel}: 2.00 credits`)).toBeInTheDocument();
  });

  it('re-fetches usage when a filter changes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('3.00');

    await user.selectOptions(screen.getByLabelText('Project'), 'org/repo-a');

    expect(window.api.getUsage).toHaveBeenLastCalledWith({ project: 'org/repo-a' });
  });

  it('shows an empty state when the database is unreachable and no data has ever loaded', async () => {
    window.api.getFilterOptions = vi.fn().mockRejectedValue(new Error('db not found'));
    window.api.getUsage = vi.fn().mockRejectedValue(new Error('db not found'));

    render(<App />);

    expect(await screen.findByText("Couldn't load Copilot CLI usage data.")).toBeInTheDocument();
  });

  it('keeps the Logs page reachable when the database is unreachable', async () => {
    window.api.getFilterOptions = vi.fn().mockRejectedValue(new Error('db not found'));
    window.api.getUsage = vi.fn().mockRejectedValue(new Error('db not found'));
    window.api.getLogs = vi.fn().mockResolvedValue({
      entries: [
        {
          id: 1,
          timestamp: '2026-09-09T10:00:00.000Z',
          level: 'error',
          scope: 'db',
          message: 'db not found',
          source: 'main',
        },
      ],
      filePath: 'C:\\logs\\app.log',
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Couldn't load Copilot CLI usage data.");

    await user.click(screen.getByRole('button', { name: 'Logs' }));

    expect(await screen.findByRole('heading', { name: 'Application logs' })).toBeInTheDocument();
    expect(screen.getByText('db not found')).toBeInTheDocument();
  });

  it('logs failures and tab navigation through the bridge', async () => {
    window.api.getUsage = vi.fn().mockRejectedValue(new Error('db not found'));

    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'By model' }));

    expect(window.api.log).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'info', scope: 'App', message: 'Navigating to the "models" tab' }),
    );
    expect(window.api.log).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', scope: 'useUsageData' }),
    );
  });

  it('keeps showing the last successful data and a non-blocking notice when a later refresh fails', async () => {
    let callCount = 0;
    window.api.getUsage = vi.fn().mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? Promise.resolve(usage) : Promise.reject(new Error('transient failure'));
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('3.00');

    // Changing a filter triggers useUsageData's second fetch, which is mocked to reject above.
    await user.selectOptions(screen.getByLabelText('Model'), 'claude-sonnet-5');

    expect(await screen.findByText("Couldn't refresh — showing last known data.")).toBeInTheDocument();
    expect(screen.getByText('3.00')).toBeInTheDocument();
  });

  it('shows a loading skeleton before the first successful data fetch', async () => {
    let resolveUsage: (value: UsageResult) => void = () => {};
    window.api.getUsage = vi.fn().mockImplementation(
      () =>
        new Promise<UsageResult>((resolve) => {
          resolveUsage = resolve;
        }),
    );

    render(<App />);

    expect(screen.getAllByRole('status', { name: 'Loading' }).length).toBeGreaterThan(0);

    resolveUsage(usage);
    expect(await screen.findByText('3.00')).toBeInTheDocument();
    expect(screen.queryAllByRole('status', { name: 'Loading' })).toHaveLength(0);
  });

  it('navigates to the project detail page when a project bar is clicked and back again', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('3.00');

    await user.click(screen.getByRole('button', { name: 'By project' }));

    const projectChartCard = screen.getByText('Credits by project').closest('.chart-card') as HTMLElement;
    expect(projectChartCard).not.toBeNull();

    const projectChart = within(projectChartCard).getByTestId('breakdown-chart');
    const bar = projectChart.querySelector('.recharts-bar-rectangle');
    expect(bar).not.toBeNull();

    await user.click(bar as Element);

    expect(await screen.findByRole('heading', { name: 'org/repo-a' })).toBeInTheDocument();
    expect(screen.getByText('Fixed the login bug')).toBeInTheDocument();
    expect(window.api.getProjectDetail).toHaveBeenCalledWith({ project: 'org/repo-a' });
    expect(screen.queryByRole('heading', { name: 'Credits Dashboard' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back/i }));

    expect(await screen.findByText('Credits by project')).toBeInTheDocument();
    expect(screen.queryByText('Fixed the login bug')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Credits Dashboard' })).toBeInTheDocument();
  });

  it('navigates to the raw data page when "Raw data" is clicked and back again', async () => {
    window.api.getRawTablePage = vi.fn().mockResolvedValue({
      columns: ['id', 'cwd'],
      rows: [{ id: 's1', cwd: 'C:/repo-a' }],
      total: 1,
      page: 0,
      pageSize: 50,
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('3.00');

    await user.click(screen.getByRole('button', { name: 'Raw data' }));

    expect(await screen.findByRole('heading', { name: 'Raw data' })).toBeInTheDocument();
    expect(screen.getByText('s1')).toBeInTheDocument();
    expect(screen.queryByText('Credits by project')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '← Back' }));

    expect(await screen.findByText('3.00')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Raw data' })).not.toBeInTheDocument();
  });

  it('shows the models tab with a breakdown chart and table', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('3.00');

    await user.click(screen.getByRole('button', { name: 'By model' }));

    expect(await screen.findByText('Credits by model')).toBeInTheDocument();
    expect(screen.getByText('% of total')).toBeInTheDocument();
  });

  it('clears an open hourly detail panel when switching tabs', async () => {
    window.api.getHourlyDetail = vi.fn().mockResolvedValue([
      { hour: '10:00', aiuCredits: 3, byProject: { 'org/repo-a': 3 } },
    ]);

    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('3.00');

    const timeSeriesChart = screen.getByTestId('time-series-chart');
    const bar = timeSeriesChart.querySelector('.recharts-bar-rectangle');
    expect(bar).not.toBeNull();
    await user.click(bar as Element);

    const hourlyDialog = await screen.findByRole('dialog', { name: /hourly detail/i });
    expect(within(hourlyDialog).getByText('10:00')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'By project' }));

    expect(screen.queryByRole('dialog', { name: /hourly detail/i })).not.toBeInTheDocument();
  });

  it('clears an open project detail view when switching tabs', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('3.00');

    await user.click(screen.getByRole('button', { name: 'By project' }));

    const projectChartCard = screen.getByText('Credits by project').closest('.chart-card') as HTMLElement;
    const projectChart = within(projectChartCard).getByTestId('breakdown-chart');
    const bar = projectChart.querySelector('.recharts-bar-rectangle');
    await user.click(bar as Element);

    expect(await screen.findByRole('heading', { name: 'org/repo-a' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Daily consumption' }));

    expect(screen.queryByRole('heading', { name: 'org/repo-a' })).not.toBeInTheDocument();
    expect(await screen.findByText('Credits over time')).toBeInTheDocument();
  });

  it('does not animate a credit delta when a filter change starts a new update context', async () => {
    window.api.getUsage = vi
      .fn()
      .mockResolvedValueOnce(usage)
      .mockResolvedValueOnce({
        ...usage,
        totals: { aiuCredits: 9, tokens: 300, requests: 5 },
      });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('3.00');

    await user.selectOptions(screen.getByLabelText('Project'), 'org/repo-a');

    expect(await screen.findByText('9.00')).toBeInTheDocument();
    expect(screen.queryByText('+6.00')).not.toBeInTheDocument();
  });

  it('does not animate deltas when a tab is opened before a filtered refresh resolves', async () => {
    const filteredUsage: UsageResult = {
      totals: { aiuCredits: 9, tokens: 300, requests: 5 },
      timeSeries: [{ date: '2026-09-01', aiuCredits: 9 }],
      byProject: [{ key: 'org/repo-a', aiuCredits: 4.5 }],
      byModel: [{ key: 'claude-sonnet-5', aiuCredits: 4.5 }],
    };
    let resolveFiltered: (value: UsageResult) => void = () => {};
    let callCount = 0;
    window.api.getUsage = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve(usage);
      }
      return new Promise<UsageResult>((resolve) => {
        resolveFiltered = resolve;
      });
    });

    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByText('3.00');

    await user.selectOptions(screen.getByLabelText('Project'), 'org/repo-a');
    // The filtered request is still pending, so the by-project tab mounts on
    // the unfiltered response that is still displayed.
    await user.click(screen.getByRole('button', { name: 'By project' }));
    expect((await screen.findAllByText('1.50')).length).toBeGreaterThan(0);

    await act(async () => {
      resolveFiltered(filteredUsage);
    });

    expect((await screen.findAllByText('4.50')).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('+3.00')).toHaveLength(0);
    expect(container.querySelectorAll('[data-credit-updated="true"]')).toHaveLength(0);
  });
});
