import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
