import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MonthlyConsumptionPage } from './MonthlyConsumptionPage';

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

describe('MonthlyConsumptionPage', () => {
  const timeSeries = [
    { date: '2026-08-15', aiuCredits: 2, byProject: { 'org/repo-b': 2 } },
    { date: '2026-09-01', aiuCredits: 3, byProject: { 'org/repo-a': 1, 'org/repo-b': 2 } },
    { date: '2026-09-02', aiuCredits: 2, byProject: { 'org/repo-a': 2 } },
  ];

  it('charts credits per month and lists the total credits of each project', () => {
    render(<MonthlyConsumptionPage timeSeries={timeSeries} updateContextKey="all" />);

    expect(screen.getByText('Credits per month')).toBeInTheDocument();
    expect(screen.getByTestId('time-series-chart')).toBeInTheDocument();

    const legend = screen.getByRole('list', { name: 'Total credits per project' });
    const items = within(legend).getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual(['org/repo-b4.00', 'org/repo-a3.00']);
  });

  it('scopes the chart and project totals to the selected month', () => {
    render(<MonthlyConsumptionPage timeSeries={timeSeries} selectedMonth="2026-09" updateContextKey="all" />);

    expect(screen.getByText('Credits per project — 2026-09')).toBeInTheDocument();
    const legend = screen.getByRole('list', { name: 'Total credits per project' });
    const items = within(legend).getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual(['org/repo-a3.00', 'org/repo-b2.00']);
  });

  it('shows an empty message when no project has usage', () => {
    render(<MonthlyConsumptionPage timeSeries={[]} updateContextKey="all" />);

    expect(screen.getByText('No project usage for this selection.')).toBeInTheDocument();
  });
});
