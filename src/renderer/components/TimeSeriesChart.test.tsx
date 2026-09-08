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

  it('calls onDayClick when clicking the grey column area beside a (possibly tiny) bar', () => {
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

    // Recharts renders this as a transparent rect spanning the full plot
    // height for each day's column (the grey area the hover cursor
    // highlights), separate from the visible `.recharts-bar-rectangle`.
    const backgrounds = container.querySelectorAll('.recharts-bar-background-rectangle');
    expect(backgrounds.length).toBeGreaterThan(0);

    fireEvent.click(backgrounds[0]);

    expect(onDayClick).toHaveBeenCalledWith('2026-09-01');
  });

  it('makes the grey column area clickable for every day, including ones where the first project series is zero', () => {
    // Recharts only renders a stacked series' background rectangle on days
    // where that specific series contributed a non-zero value, so relying
    // on a single project's series to cover every day's grey area would
    // silently drop days where that project happened to have no activity.
    const onDayClick = vi.fn();
    const data = [
      { date: '2026-09-01', aiuCredits: 3, byProject: { 'org/repo-a': 3 } },
      { date: '2026-09-02', aiuCredits: 5, byProject: { 'org/repo-b': 5 } },
      { date: '2026-09-03', aiuCredits: 1, byProject: { 'org/repo-c': 1 } },
    ];
    const { container } = render(<TimeSeriesChart data={data} onDayClick={onDayClick} />);

    const backgrounds = Array.from(
      container.querySelectorAll('.recharts-bar-background-rectangle'),
    );
    const clickedDates = new Set<string>();
    backgrounds.forEach((bg) => {
      onDayClick.mockClear();
      fireEvent.click(bg);
      onDayClick.mock.calls.forEach(([date]) => clickedDates.add(date));
    });

    expect(clickedDates).toEqual(new Set(data.map((point) => point.date)));
  });

  it('does not attach a click handler when onDayClick is omitted', () => {
    render(
      <TimeSeriesChart data={[{ date: '2026-09-01', aiuCredits: 1 }]} />,
    );

    expect(screen.getByTestId('time-series-chart')).toBeInTheDocument();
  });
});
