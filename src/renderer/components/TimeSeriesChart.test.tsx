import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
    // jsdom does not implement SVGPathElement.getTotalLength, which Recharts'
    // default bar entrance animation relies on, so animated bars never mount
    // a <path> in tests. Disabling animation here only affects the test
    // environment; production continues to use Recharts' default animation.
    Bar: (props: React.ComponentProps<typeof actual.Bar>) => (
      <actual.Bar isAnimationActive={false} {...props} />
    ),
  };
});

describe('TimeSeriesChart', () => {
  it('renders a chart title and an empty state when there is no data', () => {
    render(<TimeSeriesChart data={[]} updateContextKey="all" />);

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
        updateContextKey="all"
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
        updateContextKey="all"
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
        updateContextKey="all"
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
        updateContextKey="all"
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
    const { container } = render(
      <TimeSeriesChart data={data} onDayClick={onDayClick} updateContextKey="all" />,
    );

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
      <TimeSeriesChart data={[{ date: '2026-09-01', aiuCredits: 1 }]} updateContextKey="all" />,
    );

    expect(screen.getByTestId('time-series-chart')).toBeInTheDocument();
  });

  describe('credit-update highlighting', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function markedCells(container: HTMLElement): Element[] {
      // Recharts' stacked Bar reuses each data entry's props to build both the
      // visible segment and its invisible full-column background click
      // target (via `background={{ fill: 'transparent' }}`), so our
      // `data-credit-updated` attribute unavoidably leaks onto that
      // background rectangle too. It never gets the `credit-chart-updated`
      // class though (Recharts always overrides className on the background
      // rect), so it stays transparent and never animates. Requiring both
      // the attribute and the class scopes this query to the actually
      // highlighted segment.
      return Array.from(
        container.querySelectorAll('.credit-chart-updated[data-credit-updated="true"]'),
      );
    }

    it('does not mark any bar on initial render', () => {
      const { container } = render(
        <TimeSeriesChart
          data={[
            {
              date: '2026-09-01',
              aiuCredits: 3,
              byProject: { 'org/repo-a': 1, 'org/repo-b': 2 },
            },
          ]}
          updateContextKey="all"
        />,
      );

      expect(markedCells(container)).toHaveLength(0);
    });

    it('marks only the segment whose project contribution changed on a given date', () => {
      const initial = [
        {
          date: '2026-09-01',
          aiuCredits: 3,
          byProject: { 'org/repo-a': 1, 'org/repo-b': 2 },
        },
      ];
      const { container, rerender } = render(
        <TimeSeriesChart data={initial} updateContextKey="all" />,
      );

      expect(markedCells(container)).toHaveLength(0);

      const next = [
        {
          date: '2026-09-01',
          aiuCredits: 4,
          byProject: { 'org/repo-a': 2, 'org/repo-b': 2 },
        },
      ];
      act(() => {
        rerender(<TimeSeriesChart data={next} updateContextKey="all" />);
      });

      const marked = markedCells(container);
      expect(marked).toHaveLength(1);
      expect(marked[0].getAttribute('class')).toContain('credit-chart-updated');
    });

    it('removes all update markers 1,000 ms after they appear', () => {
      const initial = [
        {
          date: '2026-09-01',
          aiuCredits: 3,
          byProject: { 'org/repo-a': 1, 'org/repo-b': 2 },
        },
      ];
      const { container, rerender } = render(
        <TimeSeriesChart data={initial} updateContextKey="all" />,
      );

      const next = [
        {
          date: '2026-09-01',
          aiuCredits: 4,
          byProject: { 'org/repo-a': 2, 'org/repo-b': 2 },
        },
      ];
      act(() => {
        rerender(<TimeSeriesChart data={next} updateContextKey="all" />);
      });

      expect(markedCells(container)).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      expect(markedCells(container)).toHaveLength(0);
    });

    it('does not mark any segment when updateContextKey changes even if the values differ', () => {
      const initial = [
        {
          date: '2026-09-01',
          aiuCredits: 3,
          byProject: { 'org/repo-a': 1, 'org/repo-b': 2 },
        },
      ];
      const { container, rerender } = render(
        <TimeSeriesChart data={initial} updateContextKey="context-1" />,
      );

      const next = [
        {
          date: '2026-09-01',
          aiuCredits: 9,
          byProject: { 'org/repo-a': 7, 'org/repo-b': 2 },
        },
      ];
      act(() => {
        rerender(<TimeSeriesChart data={next} updateContextKey="context-2" />);
      });

      expect(markedCells(container)).toHaveLength(0);
    });
  });
});
