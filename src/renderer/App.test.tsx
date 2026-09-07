import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
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
  };
});

describe('App', () => {
  it('loads filter options and usage data, then renders the dashboard', async () => {
    const { container } = render(<App />);

    expect(await screen.findByText('3.00')).toBeInTheDocument();
    const summaryCards = container.querySelector('.summary-cards') as HTMLElement;
    expect(within(summaryCards).getByText('AIU credits')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'org/repo-a' })).toBeInTheDocument();
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

    expect(await screen.findByText('Credits by project')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Raw data' })).not.toBeInTheDocument();
  });
});
