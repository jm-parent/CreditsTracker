import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TimeSeriesChart } from './TimeSeriesChart';

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

describe('TimeSeriesChart', () => {
  it('renders a chart title and an empty state when there is no data', () => {
    render(<TimeSeriesChart data={[]} />);

    expect(screen.getByText('Credits over time')).toBeInTheDocument();
    expect(screen.getByText('No data for this selection.')).toBeInTheDocument();
  });

  it('renders the chart container when data is present', () => {
    render(
      <TimeSeriesChart
        data={[
          { date: '2026-09-01', aiuCredits: 1 },
          { date: '2026-09-02', aiuCredits: 2 },
        ]}
      />,
    );

    expect(screen.getByText('Credits over time')).toBeInTheDocument();
    expect(screen.queryByText('No data for this selection.')).not.toBeInTheDocument();
    expect(screen.getByTestId('time-series-chart')).toBeInTheDocument();
  });

  it('renders without error when points include a per-project breakdown', () => {
    render(
      <TimeSeriesChart
        data={[
          {
            date: '2026-09-01',
            aiuCredits: 3,
            byProject: { 'org/repo-a': 1, 'org/repo-b': 2 },
          },
          {
            date: '2026-09-02',
            aiuCredits: 2,
            byProject: { 'org/repo-a': 2 },
          },
        ]}
      />,
    );

    expect(screen.getByTestId('time-series-chart')).toBeInTheDocument();
  });

  it('calls onDayClick with the clicked date when a bar is clicked', () => {
    const onDayClick = vi.fn();
    const { container } = render(
      <TimeSeriesChart
        data={[
          { date: '2026-09-01', aiuCredits: 3, byProject: { 'org/repo-a': 3 } },
          { date: '2026-09-02', aiuCredits: 2, byProject: { 'org/repo-a': 2 } },
        ]}
        onDayClick={onDayClick}
      />,
    );

    const bar = container.querySelector('.recharts-bar-rectangle');
    expect(bar).not.toBeNull();

    fireEvent.click(bar as Element);

    expect(onDayClick).toHaveBeenCalledWith('2026-09-01');
  });

  it('does not attach a click handler when onDayClick is omitted', () => {
    render(
      <TimeSeriesChart data={[{ date: '2026-09-01', aiuCredits: 1 }]} />,
    );

    expect(screen.getByTestId('time-series-chart')).toBeInTheDocument();
  });
});
