import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Children, isValidElement } from 'react';
import { BreakdownChart } from './BreakdownChart';
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

  it('colors each rectangle by its own stable key for a By Model chart when colorByKey is set', () => {
    const { container } = render(
      <BreakdownChart
        title="Credits by model"
        data={[
          { key: 'claude-sonnet-5', aiuCredits: 3 },
          { key: 'gpt-5.4', aiuCredits: 1 },
        ]}
        colorByKey
        updateContextKey="all"
      />,
    );

    const rectangles = container.querySelectorAll('.recharts-rectangle');
    expect(rectangles).toHaveLength(2);
    expect(rectangles[0]).toHaveAttribute('fill', getColorForKey('claude-sonnet-5'));
    expect(rectangles[1]).toHaveAttribute('fill', getColorForKey('gpt-5.4'));
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

      expect(dropLabels(container)).toHaveLength(0);
    });

    it('renders a credit-drop label with the keyed color for the project whose credits increased', () => {
      const initial = [
        { key: 'org/repo-a', aiuCredits: 3 },
        { key: 'org/repo-b', aiuCredits: 1 },
      ];
      const { container, rerender } = render(
        <BreakdownChart title="Credits by project" data={initial} colorByKey updateContextKey="all" />,
      );

      expect(dropLabels(container)).toHaveLength(0);

      const next = [
        { key: 'org/repo-a', aiuCredits: 5 },
        { key: 'org/repo-b', aiuCredits: 1 },
      ];
      act(() => {
        rerender(
          <BreakdownChart title="Credits by project" data={next} colorByKey updateContextKey="all" />,
        );
      });

      const drop = container.querySelector('[data-credit-drop="true"]');
      expect(drop).toHaveTextContent('+2.00');
      expect(drop).toHaveAttribute('fill', getColorForKey('org/repo-a'));
      expect(container.querySelector('.credit-chart-updated')).toBeNull();
    });

    it('renders a credit drop while Recharts suppresses bar labels during animation', () => {
      const initial = [{ key: 'org/repo-a', aiuCredits: 3 }];
      const { container, rerender } = render(
        <BreakdownChart
          title="Credits by project"
          data={initial}
          colorByKey
          updateContextKey="all"
        />,
      );

      barAnimationState.suppressLabels = true;
      act(() => {
        rerender(
          <BreakdownChart
            title="Credits by project"
            data={[{ key: 'org/repo-a', aiuCredits: 5 }]}
            colorByKey
            updateContextKey="all"
          />,
        );
      });

      expect(container.querySelector('[data-credit-drop="true"]')).toHaveTextContent('+2.00');
    });

    it('renders an orange credit-drop label for a negative correction', () => {
      const initial = [
        { key: 'org/repo-a', aiuCredits: 3 },
        { key: 'org/repo-b', aiuCredits: 1 },
      ];
      const { container, rerender } = render(
        <BreakdownChart title="Credits by project" data={initial} colorByKey updateContextKey="all" />,
      );

      const next = [
        { key: 'org/repo-a', aiuCredits: 2 },
        { key: 'org/repo-b', aiuCredits: 1 },
      ];
      act(() => {
        rerender(
          <BreakdownChart title="Credits by project" data={next} colorByKey updateContextKey="all" />,
        );
      });

      const drop = container.querySelector('[data-credit-drop="true"]');
      expect(drop).toHaveTextContent('−1.00');
      expect(drop).toHaveAttribute('fill', '#fb923c');
      expect(drop).toHaveClass('credit-drop-negative');
    });

    it('removes the credit-drop label 1,200 ms after it appears', () => {
      const initial = [
        { key: 'org/repo-a', aiuCredits: 3 },
        { key: 'org/repo-b', aiuCredits: 1 },
      ];
      const { container, rerender } = render(
        <BreakdownChart title="Credits by project" data={initial} colorByKey updateContextKey="all" />,
      );

      const next = [
        { key: 'org/repo-a', aiuCredits: 5 },
        { key: 'org/repo-b', aiuCredits: 1 },
      ];
      act(() => {
        rerender(
          <BreakdownChart title="Credits by project" data={next} colorByKey updateContextKey="all" />,
        );
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
        { key: 'org/repo-a', aiuCredits: 3 },
        { key: 'org/repo-b', aiuCredits: 1 },
      ];
      const { container, rerender } = render(
        <BreakdownChart
          title="Credits by project"
          data={initial}
          colorByKey
          updateContextKey="context-1"
        />,
      );

      const next = [
        { key: 'org/repo-a', aiuCredits: 9 },
        { key: 'org/repo-b', aiuCredits: 1 },
      ];
      act(() => {
        rerender(
          <BreakdownChart
            title="Credits by project"
            data={next}
            colorByKey
            updateContextKey="context-2"
          />,
        );
      });

      expect(dropLabels(container)).toHaveLength(0);
    });
  });
});
