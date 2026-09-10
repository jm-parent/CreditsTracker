import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityHeatmapPage } from './ActivityHeatmapPage';
import type { TimeSeriesPoint } from '../../shared/types';

const fixture: TimeSeriesPoint[] = [
  { date: '2026-09-01', aiuCredits: 12.3 },
  { date: '2026-09-15', aiuCredits: 0.5 },
];

describe('ActivityHeatmapPage', () => {
  it('renders the month/year header and one cell per day in the month', () => {
    render(
      <ActivityHeatmapPage
        year={2026}
        month={9}
        data={fixture}
        loading={false}
        error={null}
        onPrevMonth={vi.fn()}
        onNextMonth={vi.fn()}
        updateContextKey="2026-09"
      />,
    );

    expect(screen.getByText('September 2026')).toBeInTheDocument();
    // September 2026 has 30 days.
    expect(screen.getAllByRole('button', { name: /credits$/ })).toHaveLength(30);
  });

  it('exposes an accessible label for a known day', () => {
    render(
      <ActivityHeatmapPage
        year={2026}
        month={9}
        data={fixture}
        loading={false}
        error={null}
        onPrevMonth={vi.fn()}
        onNextMonth={vi.fn()}
        updateContextKey="2026-09"
      />,
    );

    expect(screen.getByLabelText('September 1, 2026: 12.30 credits')).toBeInTheDocument();
  });

  it('shows the busiest and quietest active days of the month', () => {
    render(
      <ActivityHeatmapPage
        year={2026}
        month={9}
        data={fixture}
        loading={false}
        error={null}
        onPrevMonth={vi.fn()}
        onNextMonth={vi.fn()}
        updateContextKey="2026-09"
      />,
    );

    expect(screen.getByText('Busiest day')).toBeInTheDocument();
    expect(screen.getByText('Sep 1')).toBeInTheDocument();
    expect(screen.getByText('Quietest active day')).toBeInTheDocument();
    expect(screen.getByText('Sep 15')).toBeInTheDocument();
  });

  it('shows an empty-state message when no day in the month has activity', () => {
    render(
      <ActivityHeatmapPage
        year={2026}
        month={9}
        data={[]}
        loading={false}
        error={null}
        onPrevMonth={vi.fn()}
        onNextMonth={vi.fn()}
        updateContextKey="2026-09"
      />,
    );

    expect(screen.getByText('No credit consumption recorded for this month.')).toBeInTheDocument();
    expect(screen.getAllByText('No activity')).toHaveLength(2);
  });

  it('uses five readable blue/cyan intensity levels for the legend and day cells', () => {
    render(
      <ActivityHeatmapPage
        year={2026}
        month={9}
        data={[
          { date: '2026-09-01', aiuCredits: 0 },
          { date: '2026-09-02', aiuCredits: 1 },
          { date: '2026-09-03', aiuCredits: 2 },
          { date: '2026-09-04', aiuCredits: 3 },
          { date: '2026-09-05', aiuCredits: 4 },
        ]}
        loading={false}
        error={null}
        onPrevMonth={vi.fn()}
        onNextMonth={vi.fn()}
        updateContextKey="2026-09"
      />,
    );

    const legend = screen.getByLabelText('Intensity scale from no activity to highest activity');
    const swatches = Array.from(legend.querySelectorAll('[data-intensity-level]'));

    expect(swatches).toHaveLength(5);
    expect(swatches.map((swatch) => swatch.getAttribute('data-intensity-level'))).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(swatches.map((swatch) => swatch.getAttribute('data-intensity-color'))).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'highest',
    ]);

    expect(screen.getByRole('button', { name: 'September 1, 2026: 0.00 credits' })).toHaveAttribute(
      'data-intensity-color',
      'none',
    );
    expect(screen.getByRole('button', { name: 'September 5, 2026: 4.00 credits' })).toHaveAttribute(
      'data-intensity-color',
      'highest',
    );
  });

  it('calls onPrevMonth and onNextMonth when navigation buttons are clicked', async () => {
    const user = userEvent.setup();
    const onPrevMonth = vi.fn();
    const onNextMonth = vi.fn();
    render(
      <ActivityHeatmapPage
        year={2026}
        month={9}
        data={fixture}
        loading={false}
        error={null}
        onPrevMonth={onPrevMonth}
        onNextMonth={onNextMonth}
        updateContextKey="2026-09"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await user.click(screen.getByRole('button', { name: 'Next month' }));

    expect(onPrevMonth).toHaveBeenCalledTimes(1);
    expect(onNextMonth).toHaveBeenCalledTimes(1);
  });

  describe('credit-update highlighting', () => {
    const septemberInitial: TimeSeriesPoint[] = [
      { date: '2026-09-01', aiuCredits: 12.3 },
      { date: '2026-09-15', aiuCredits: 0.5 },
    ];
    const septemberUpdated: TimeSeriesPoint[] = [
      { date: '2026-09-01', aiuCredits: 12.3 },
      { date: '2026-09-15', aiuCredits: 2 },
    ];
    const october: TimeSeriesPoint[] = [{ date: '2026-10-01', aiuCredits: 5 }];

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('marks only the changed day cell and shows a matching numeric delta for the affected summary card', () => {
      const { rerender } = render(
        <ActivityHeatmapPage
          year={2026}
          month={9}
          data={septemberInitial}
          loading={false}
          error={null}
          onPrevMonth={vi.fn()}
          onNextMonth={vi.fn()}
          updateContextKey="2026-09"
        />,
      );

      expect(
        screen.getByRole('button', { name: 'September 15, 2026: 0.50 credits' }),
      ).not.toHaveAttribute('data-credit-updated');

      act(() => {
        rerender(
          <ActivityHeatmapPage
            year={2026}
            month={9}
            data={septemberUpdated}
            loading={false}
            error={null}
            onPrevMonth={vi.fn()}
            onNextMonth={vi.fn()}
            updateContextKey="2026-09"
          />,
        );
      });

      expect(
        screen.getByRole('button', { name: 'September 15, 2026: 2.00 credits' }),
      ).toHaveAttribute('data-credit-updated', 'true');
      expect(
        screen.getByRole('button', { name: 'September 1, 2026: 12.30 credits' }),
      ).not.toHaveAttribute('data-credit-updated');

      // September 15 is the quietest active day both before and after the
      // change, so its own numeric delta (+1.50) must show on that summary
      // card via CreditValue.
      expect(screen.getByText('+1.50')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      expect(
        screen.getByRole('button', { name: 'September 15, 2026: 2.00 credits' }),
      ).not.toHaveAttribute('data-credit-updated');
      // The numeric delta lasts longer (1,500 ms) than the cell marker
      // (1,000 ms), so it must still be visible here.
      expect(screen.getByText('+1.50')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(screen.queryByText('+1.50')).not.toBeInTheDocument();
    });

    it('does not mark any cell when the first successful month response arrives', () => {
      const { container, rerender } = render(
        <ActivityHeatmapPage
          year={2026}
          month={9}
          data={null}
          loading
          error={null}
          onPrevMonth={vi.fn()}
          onNextMonth={vi.fn()}
          updateContextKey="2026-09"
        />,
      );

      act(() => {
        rerender(
          <ActivityHeatmapPage
            year={2026}
            month={9}
            data={septemberInitial}
            loading={false}
            error={null}
            onPrevMonth={vi.fn()}
            onNextMonth={vi.fn()}
            updateContextKey="2026-09"
          />,
        );
      });

      expect(container.querySelectorAll('[data-credit-updated="true"]')).toHaveLength(0);
      expect(container.querySelector('.credit-delta')).toBeNull();
    });

    it('highlights a day that receives its first consumption of the month', () => {
      const before: TimeSeriesPoint[] = [{ date: '2026-09-01', aiuCredits: 12.3 }];
      const after: TimeSeriesPoint[] = [
        { date: '2026-09-01', aiuCredits: 12.3 },
        { date: '2026-09-15', aiuCredits: 2 },
      ];

      const { rerender } = render(
        <ActivityHeatmapPage
          year={2026}
          month={9}
          data={before}
          loading={false}
          error={null}
          onPrevMonth={vi.fn()}
          onNextMonth={vi.fn()}
          updateContextKey="2026-09"
        />,
      );

      expect(
        screen.getByRole('button', { name: 'September 15, 2026: 0.00 credits' }),
      ).not.toHaveAttribute('data-credit-updated');

      act(() => {
        rerender(
          <ActivityHeatmapPage
            year={2026}
            month={9}
            data={after}
            loading={false}
            error={null}
            onPrevMonth={vi.fn()}
            onNextMonth={vi.fn()}
            updateContextKey="2026-09"
          />,
        );
      });

      expect(
        screen.getByRole('button', { name: 'September 15, 2026: 2.00 credits' }),
      ).toHaveAttribute('data-credit-updated', 'true');
      expect(
        screen.getByRole('button', { name: 'September 1, 2026: 12.30 credits' }),
      ).not.toHaveAttribute('data-credit-updated');
      expect(screen.getByText('+2.00')).toBeInTheDocument();
    });

    it('does not mark any October cell or summary value after navigating away from September', () => {
      const { container, rerender } = render(
        <ActivityHeatmapPage
          year={2026}
          month={9}
          data={septemberInitial}
          loading={false}
          error={null}
          onPrevMonth={vi.fn()}
          onNextMonth={vi.fn()}
          updateContextKey="2026-09"
        />,
      );

      act(() => {
        rerender(
          <ActivityHeatmapPage
            year={2026}
            month={9}
            data={septemberUpdated}
            loading={false}
            error={null}
            onPrevMonth={vi.fn()}
            onNextMonth={vi.fn()}
            updateContextKey="2026-09"
          />,
        );
      });

      expect(
        screen.getByRole('button', { name: 'September 15, 2026: 2.00 credits' }),
      ).toHaveAttribute('data-credit-updated', 'true');

      act(() => {
        rerender(
          <ActivityHeatmapPage
            year={2026}
            month={10}
            data={october}
            loading={false}
            error={null}
            onPrevMonth={vi.fn()}
            onNextMonth={vi.fn()}
            updateContextKey="2026-10"
          />,
        );
      });

      expect(screen.queryByText('+1.50')).not.toBeInTheDocument();
      expect(container.querySelectorAll('[data-credit-updated="true"]')).toHaveLength(0);
    });
  });
});
