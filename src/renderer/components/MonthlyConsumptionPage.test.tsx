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
  it('charts credits per month and lists the total credits of each project', () => {
    render(
      <MonthlyConsumptionPage
        timeSeries={[
          { date: '2026-08-15', aiuCredits: 2, byProject: { 'org/repo-b': 2 } },
          { date: '2026-09-01', aiuCredits: 3, byProject: { 'org/repo-a': 1, 'org/repo-b': 2 } },
          { date: '2026-09-02', aiuCredits: 2, byProject: { 'org/repo-a': 2 } },
        ]}
        byProject={[
          { key: 'org/repo-a', aiuCredits: 3 },
          { key: 'org/repo-b', aiuCredits: 4 },
        ]}
        updateContextKey="all"
      />,
    );

    expect(screen.getByText('Credits per month')).toBeInTheDocument();
    expect(screen.getByTestId('time-series-chart')).toBeInTheDocument();

    const legend = screen.getByRole('list', { name: 'Total credits per project' });
    const items = within(legend).getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual(['org/repo-b4.00', 'org/repo-a3.00']);
  });

  it('shows an empty message when no project has usage', () => {
    render(<MonthlyConsumptionPage timeSeries={[]} byProject={[]} updateContextKey="all" />);

    expect(screen.getByText('No project usage for this selection.')).toBeInTheDocument();
  });
});
