import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import type { FilterOptions, UsageResult } from '../shared/types';



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

beforeEach(() => {
  window.api = {
    getFilterOptions: vi.fn().mockResolvedValue(options),
    getUsage: vi.fn().mockResolvedValue(usage),
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
});
