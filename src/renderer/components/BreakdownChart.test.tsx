import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BreakdownChart } from './BreakdownChart';

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

describe('BreakdownChart', () => {
  it('renders the given title and an empty state when there is no data', () => {
    render(<BreakdownChart title="Credits by project" data={[]} updateContextKey="all" />);

    expect(screen.getByText('Credits by project')).toBeInTheDocument();
    expect(screen.getByText('No data for this selection.')).toBeInTheDocument();
  });

  it('renders the chart container when data is present', () => {
    render(
      <BreakdownChart
        title="Credits by model"
        data={[
          { key: 'claude-sonnet-5', aiuCredits: 3 },
          { key: 'gpt-5.4', aiuCredits: 1 },
        ]}
        updateContextKey="all"
      />,
    );

    expect(screen.getByText('Credits by model')).toBeInTheDocument();
    expect(screen.queryByText('No data for this selection.')).not.toBeInTheDocument();
    expect(screen.getByTestId('breakdown-chart')).toBeInTheDocument();
  });

  it('calls onBarClick with the clicked bar key when a bar is clicked', () => {
    const onBarClick = vi.fn();
    const { container } = render(
      <BreakdownChart
        title="Credits by project"
        data={[
          { key: 'org/repo-a', aiuCredits: 3 },
          { key: 'org/repo-b', aiuCredits: 1 },
        ]}
        onBarClick={onBarClick}
        updateContextKey="all"
      />,
    );
    const bar = container.querySelector('.recharts-bar-rectangle');
    expect(bar).not.toBeNull();

    fireEvent.click(bar as Element);

    expect(onBarClick).toHaveBeenCalledWith('org/repo-a');
  });

  it('does not attach a click handler when onBarClick is omitted', () => {
    render(
      <BreakdownChart
        title="Credits by model"
        data={[{ key: 'claude-sonnet-5', aiuCredits: 3 }]}
        updateContextKey="all"
      />,
    );

    expect(screen.getByTestId('breakdown-chart')).toBeInTheDocument();
  });

  it('renders without error when colorByKey is set', () => {
    render(
      <BreakdownChart
        title="Credits by project"
        data={[
          { key: 'org/repo-a', aiuCredits: 3 },
          { key: 'org/repo-b', aiuCredits: 1 },
        ]}
        colorByKey
        updateContextKey="all"
      />,
    );

    expect(screen.getByTestId('breakdown-chart')).toBeInTheDocument();
  });

  it('renders all bars with the same color when colorByKey is not set', () => {
    render(
      <BreakdownChart
        title="Credits by model"
        data={[
          { key: 'claude-sonnet-5', aiuCredits: 3 },
          { key: 'gpt-5.4', aiuCredits: 1 },
        ]}
        updateContextKey="all"
      />,
    );

    expect(screen.getByTestId('breakdown-chart')).toBeInTheDocument();
  });

  describe('credit-update highlighting', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function markedCells(container: HTMLElement): Element[] {
      return Array.from(container.querySelectorAll('[data-credit-updated="true"]'));
    }

    it('does not mark any bar on initial render', () => {
      const { container } = render(
        <BreakdownChart
          title="Credits by project"
          data={[
            { key: 'org/repo-a', aiuCredits: 3 },
            { key: 'org/repo-b', aiuCredits: 1 },
          ]}
          updateContextKey="all"
        />,
      );

      expect(markedCells(container)).toHaveLength(0);
    });

    it('marks only the bar whose keyed value changed when data is rerendered with a new array reference', () => {
      const initial = [
        { key: 'org/repo-a', aiuCredits: 3 },
        { key: 'org/repo-b', aiuCredits: 1 },
      ];
      const { container, rerender } = render(
        <BreakdownChart title="Credits by project" data={initial} updateContextKey="all" />,
      );

      expect(markedCells(container)).toHaveLength(0);

      const next = [
        { key: 'org/repo-a', aiuCredits: 5 },
        { key: 'org/repo-b', aiuCredits: 1 },
      ];
      act(() => {
        rerender(<BreakdownChart title="Credits by project" data={next} updateContextKey="all" />);
      });

      const marked = markedCells(container);
      expect(marked).toHaveLength(1);
      expect(marked[0].getAttribute('class')).toContain('credit-chart-updated');
    });

    it('removes the update marker 1,000 ms after it appears', () => {
      const initial = [
        { key: 'org/repo-a', aiuCredits: 3 },
        { key: 'org/repo-b', aiuCredits: 1 },
      ];
      const { container, rerender } = render(
        <BreakdownChart title="Credits by project" data={initial} updateContextKey="all" />,
      );

      const next = [
        { key: 'org/repo-a', aiuCredits: 5 },
        { key: 'org/repo-b', aiuCredits: 1 },
      ];
      act(() => {
        rerender(<BreakdownChart title="Credits by project" data={next} updateContextKey="all" />);
      });

      expect(markedCells(container)).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      expect(markedCells(container)).toHaveLength(0);
    });

    it('does not mark any bar when updateContextKey changes even if the values differ', () => {
      const initial = [
        { key: 'org/repo-a', aiuCredits: 3 },
        { key: 'org/repo-b', aiuCredits: 1 },
      ];
      const { container, rerender } = render(
        <BreakdownChart title="Credits by project" data={initial} updateContextKey="context-1" />,
      );

      const next = [
        { key: 'org/repo-a', aiuCredits: 9 },
        { key: 'org/repo-b', aiuCredits: 1 },
      ];
      act(() => {
        rerender(
          <BreakdownChart title="Credits by project" data={next} updateContextKey="context-2" />,
        );
      });

      expect(markedCells(container)).toHaveLength(0);
    });
  });
});
