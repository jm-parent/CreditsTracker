import { describe, it, expect, vi } from 'vitest';
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
      />,
    );

    expect(screen.getByText('Busiest day')).toBeInTheDocument();
    expect(screen.getByText('Sep 1')).toBeInTheDocument();
    expect(screen.getByText('Quietest active day')).toBeInTheDocument();
    expect(screen.getByText('Sep 15')).toBeInTheDocument();
  });

  it('shows the busiest and quietest credit values as plain numeric text', () => {
    render(
      <ActivityHeatmapPage
        year={2026}
        month={9}
        data={fixture}
        loading={false}
        error={null}
        onPrevMonth={vi.fn()}
        onNextMonth={vi.fn()}
      />,
    );

    expect(screen.getByText('12.30 credits')).toBeInTheDocument();
    expect(screen.getByText('0.50 credits')).toBeInTheDocument();
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
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await user.click(screen.getByRole('button', { name: 'Next month' }));

    expect(onPrevMonth).toHaveBeenCalledTimes(1);
    expect(onNextMonth).toHaveBeenCalledTimes(1);
  });

  describe('no live update feedback', () => {
    // The monthly heatmap intentionally has no update-indicator tracker: it
    // must never grow a `data-credit-updated` attribute, a
    // `credit-heatmap-updated` glow class, or a `+X`/`−X` CreditValue delta
    // when its data changes across a rerender, regardless of whether the day
    // in question already had activity, is gaining its first activity, or is
    // the busiest/quietest summary day.
    const septemberInitial: TimeSeriesPoint[] = [
      { date: '2026-09-01', aiuCredits: 12.3 },
      { date: '2026-09-15', aiuCredits: 0.5 },
    ];
    const septemberUpdated: TimeSeriesPoint[] = [
      { date: '2026-09-01', aiuCredits: 12.3 },
      { date: '2026-09-15', aiuCredits: 2 },
    ];

    it('never marks a changed day cell with data-credit-updated or a glow class', () => {
      const { container, rerender } = render(
        <ActivityHeatmapPage
          year={2026}
          month={9}
          data={septemberInitial}
          loading={false}
          error={null}
          onPrevMonth={vi.fn()}
          onNextMonth={vi.fn()}
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
          />,
        );
      });

      const updatedCell = screen.getByRole('button', { name: 'September 15, 2026: 2.00 credits' });
      expect(updatedCell).not.toHaveAttribute('data-credit-updated');
      expect(updatedCell.className).not.toMatch(/credit-heatmap-updated/);
      expect(container.querySelectorAll('[data-credit-updated]')).toHaveLength(0);
      expect(container.querySelectorAll('.credit-heatmap-updated')).toHaveLength(0);
    });

    it('never shows a +X/−X CreditValue delta on the busiest or quietest summary card', () => {
      const { rerender } = render(
        <ActivityHeatmapPage
          year={2026}
          month={9}
          data={septemberInitial}
          loading={false}
          error={null}
          onPrevMonth={vi.fn()}
          onNextMonth={vi.fn()}
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
          />,
        );
      });

      // September 15 (the quietest active day) changed from 0.50 to 2.00
      // credits — a +1.50 delta must never appear.
      expect(screen.queryByText('+1.50')).not.toBeInTheDocument();
      expect(screen.queryByText('−1.50')).not.toBeInTheDocument();
      expect(screen.getByText('2.00 credits')).toBeInTheDocument();
    });

    it('never highlights a day that receives its first consumption of the month', () => {
      const before: TimeSeriesPoint[] = [{ date: '2026-09-01', aiuCredits: 12.3 }];
      const after: TimeSeriesPoint[] = [
        { date: '2026-09-01', aiuCredits: 12.3 },
        { date: '2026-09-15', aiuCredits: 2 },
      ];

      const { container, rerender } = render(
        <ActivityHeatmapPage
          year={2026}
          month={9}
          data={before}
          loading={false}
          error={null}
          onPrevMonth={vi.fn()}
          onNextMonth={vi.fn()}
        />,
      );

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
          />,
        );
      });

      expect(
        screen.getByRole('button', { name: 'September 15, 2026: 2.00 credits' }),
      ).not.toHaveAttribute('data-credit-updated');
      expect(container.querySelectorAll('[data-credit-updated]')).toHaveLength(0);
      expect(screen.queryByText('+2.00')).not.toBeInTheDocument();
    });

    it('never marks anything after navigating between months', () => {
      const october: TimeSeriesPoint[] = [{ date: '2026-10-01', aiuCredits: 5 }];

      const { container, rerender } = render(
        <ActivityHeatmapPage
          year={2026}
          month={9}
          data={septemberUpdated}
          loading={false}
          error={null}
          onPrevMonth={vi.fn()}
          onNextMonth={vi.fn()}
        />,
      );

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
          />,
        );
      });

      expect(screen.queryByText('+1.50')).not.toBeInTheDocument();
      expect(container.querySelectorAll('[data-credit-updated]')).toHaveLength(0);
      expect(container.querySelectorAll('.credit-heatmap-updated')).toHaveLength(0);
    });
  });
});
