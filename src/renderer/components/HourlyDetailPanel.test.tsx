import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HourlyDetailPanel } from './HourlyDetailPanel';

describe('HourlyDetailPanel', () => {
  it('renders a loading state', () => {
    render(
      <HourlyDetailPanel date="2026-09-07" data={null} loading error={null} onClose={vi.fn()} />,
    );

    expect(screen.getByText('Hourly detail — 2026-09-07')).toBeInTheDocument();
  });

  it('renders an error state', () => {
    render(
      <HourlyDetailPanel
        date="2026-09-07"
        data={null}
        loading={false}
        error={new Error('boom')}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Couldn't load hourly detail.")).toBeInTheDocument();
  });

  it('renders an empty state when there is no data for the day', () => {
    render(
      <HourlyDetailPanel date="2026-09-07" data={[]} loading={false} error={null} onClose={vi.fn()} />,
    );

    expect(screen.getByText('No data for this day.')).toBeInTheDocument();
  });

  it('renders the chart when hourly data is present', () => {
    render(
      <HourlyDetailPanel
        date="2026-09-07"
        data={[
          { hour: '10:00', aiuCredits: 3, byProject: { 'org/repo-a': 2, 'org/repo-b': 1 } },
          { hour: '11:00', aiuCredits: 1, byProject: { 'org/repo-a': 1 } },
        ]}
        loading={false}
        error={null}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('hourly-detail-chart')).toBeInTheDocument();
  });

  it('calls onClose when the Close button or the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(
      <HourlyDetailPanel date="2026-09-07" data={[]} loading={false} error={null} onClose={onClose} />,
    );

    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
