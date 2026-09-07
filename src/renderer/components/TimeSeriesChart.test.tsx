import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimeSeriesChart } from './TimeSeriesChart';

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
});
