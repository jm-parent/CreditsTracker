import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityHeatmapPage } from './ActivityHeatmapPage';
import type { WeeklyActivityPoint } from '../../shared/types';

const fixture: WeeklyActivityPoint[] = [
  { weekday: 1, hour: 14, aiuCredits: 12.3 },
  { weekday: 3, hour: 9, aiuCredits: 0.5 },
];

describe('ActivityHeatmapPage', () => {
  it('renders a 7x24 grid of cells', () => {
    render(<ActivityHeatmapPage data={fixture} loading={false} error={null} />);

    const cells = screen.getAllByRole('button');
    expect(cells).toHaveLength(7 * 24);
  });

  it('exposes an accessible label for a known cell', () => {
    render(<ActivityHeatmapPage data={fixture} loading={false} error={null} />);

    expect(screen.getByLabelText('Mon, 14:00: 12.30 credits')).toBeInTheDocument();
  });

  it('shows the busiest and quietest active windows', () => {
    render(<ActivityHeatmapPage data={fixture} loading={false} error={null} />);

    expect(screen.getByText('Busiest window')).toBeInTheDocument();
    expect(screen.getByText('Mon, 14:00')).toBeInTheDocument();
    expect(screen.getByText('Quietest active window')).toBeInTheDocument();
    expect(screen.getByText('Wed, 09:00')).toBeInTheDocument();
  });

  it('shows an empty-state message when every bucket is zero', () => {
    render(<ActivityHeatmapPage data={[]} loading={false} error={null} />);

    expect(
      screen.getByText('No credit consumption recorded for the current filters.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('No activity')).toHaveLength(2);
  });
});
