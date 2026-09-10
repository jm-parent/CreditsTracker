import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Children, isValidElement } from 'react';
import { TimeSeriesChart } from './TimeSeriesChart';
import { getColorForKey } from '../lib/colors';

const barAnimationState = vi.hoisted(() => ({ suppressLabels: false }));

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
    Bar: ({ children, ...props }: React.ComponentProps<typeof actual.Bar>) => {
      const renderedChildren = barAnimationState.suppressLabels
        ? Children.toArray(children).filter(
            (child) => !isValidElement(child) || child.type !== actual.LabelList,
          )
        : children;
      return (
        <actual.Bar isAnimationActive={false} {...props}>
          {renderedChildren}
        </actual.Bar>
      );
    },
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

  describe('credit drop labels', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      barAnimationState.suppressLabels = false;
      vi.useRealTimers();
    });

    function dropLabels(container: HTMLElement): Element[] {
      return Array.from(container.querySelectorAll('[data-credit-drop="true"]'));
    }

    it('does not render a credit-drop label on initial render', () => {
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

      expect(dropLabels(container)).toHaveLength(0);
    });

    it('renders a distinct, colored, offset label for each project that changed on the same date', () => {
      const initial = [
        {
          date: '2026-09-10',
          aiuCredits: 3,
          byProject: { 'org/repo-a': 1, 'org/repo-b': 2 },
        },
      ];
      const { container, rerender } = render(
        <TimeSeriesChart data={initial} updateContextKey="all" />,
      );

      expect(dropLabels(container)).toHaveLength(0);

      const next = [
        {
          date: '2026-09-10',
          aiuCredits: 8,
          byProject: { 'org/repo-a': 3, 'org/repo-b': 5 },
        },
      ];
      act(() => {
        rerender(<TimeSeriesChart data={next} updateContextKey="all" />);
      });

      const drops = dropLabels(container);
      expect(drops).toHaveLength(2);

      const texts = drops.map((drop) => drop.textContent);
      expect(texts).toContain('+2.00');
      expect(texts).toContain('+3.00');

      const colors = drops.map((drop) => drop.getAttribute('fill'));
      expect(colors).toContain(getColorForKey('org/repo-a'));
      expect(colors).toContain(getColorForKey('org/repo-b'));

      const xPositions = drops.map((drop) => Number(drop.getAttribute('x')));
      expect(Math.abs(xPositions[1] - xPositions[0])).toBe(3);

      expect(container.querySelector('.credit-chart-updated')).toBeNull();
    });

    it('renders a cyan credit-drop label for the single-series fallback', () => {
      const initial = [{ date: '2026-09-01', aiuCredits: 3 }];
      const { container, rerender } = render(
        <TimeSeriesChart data={initial} updateContextKey="all" />,
      );

      expect(dropLabels(container)).toHaveLength(0);

      const next = [{ date: '2026-09-01', aiuCredits: 5 }];
      act(() => {
        rerender(<TimeSeriesChart data={next} updateContextKey="all" />);
      });

      const drops = dropLabels(container);
      expect(drops).toHaveLength(1);
      expect(drops[0]).toHaveTextContent('+2.00');
      expect(drops[0]).toHaveAttribute('fill', '#22d3ee');
    });

    it('associates a sparse project change with the matching date column', () => {
      const initial = [
        { date: '2026-09-01', aiuCredits: 0, byProject: { 'org/repo-a': 0 } },
        { date: '2026-09-02', aiuCredits: 2, byProject: { 'org/repo-a': 2 } },
        { date: '2026-09-03', aiuCredits: 3, byProject: { 'org/repo-a': 3 } },
      ];
      const { container, rerender } = render(
        <TimeSeriesChart data={initial} updateContextKey="all" />,
      );

      act(() => {
        rerender(
          <TimeSeriesChart
            data={[
              initial[0],
              { date: '2026-09-02', aiuCredits: 4, byProject: { 'org/repo-a': 4 } },
              initial[2],
            ]}
            updateContextKey="all"
          />,
        );
      });

      const drop = container.querySelector('[data-credit-drop="true"]');
      expect(drop).not.toBeNull();

      const changedDateTick = Array.from(
        container.querySelectorAll('.recharts-cartesian-axis-tick-value'),
      ).find((tick) => tick.textContent === '2026-09-02');
      expect(changedDateTick).not.toBeUndefined();
      expect(drop).toHaveAttribute('x', changedDateTick?.getAttribute('x'));
    });

    it('keeps an existing project drop on its segment when a new project joins the stack', () => {
      const initial = [
        { date: '2026-09-01', aiuCredits: 3, byProject: { 'org/repo-b': 3 } },
      ];
      const { container, rerender } = render(
        <TimeSeriesChart data={initial} updateContextKey="all" />,
      );

      act(() => {
        rerender(
          <TimeSeriesChart
            data={[
              {
                date: '2026-09-01',
                aiuCredits: 6,
                byProject: { 'org/repo-a': 2, 'org/repo-b': 4 },
              },
            ]}
            updateContextKey="all"
          />,
        );
      });

      const projectBColor = getColorForKey('org/repo-b');
      const projectBBar = container.querySelector(
        `.recharts-rectangle[fill="${projectBColor}"]`,
      );
      const projectBDrop = container.querySelector(
        `[data-credit-drop="true"][fill="${projectBColor}"]`,
      );
      expect(projectBBar).not.toBeNull();
      expect(projectBDrop).toHaveTextContent('+1.00');
      expect(Number(projectBDrop?.getAttribute('y'))).toBe(
        Math.max(12, Number(projectBBar?.getAttribute('y')) - 6),
      );
    });

    it('removes all credit-drop labels 1,200 ms after they appear', () => {
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

      expect(dropLabels(container)).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(1_199);
      });

      expect(dropLabels(container)).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(dropLabels(container)).toHaveLength(0);
    });

    it('does not render a credit-drop label when updateContextKey changes even if the values differ', () => {
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

      expect(dropLabels(container)).toHaveLength(0);
    });
  });
});
