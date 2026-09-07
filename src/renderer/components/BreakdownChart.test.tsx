import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BreakdownChart } from './BreakdownChart';

describe('BreakdownChart', () => {
  it('renders the given title and an empty state when there is no data', () => {
    render(<BreakdownChart title="Credits by project" data={[]} />);

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
      />,
    );

    expect(screen.getByText('Credits by model')).toBeInTheDocument();
    expect(screen.queryByText('No data for this selection.')).not.toBeInTheDocument();
    expect(screen.getByTestId('breakdown-chart')).toBeInTheDocument();
  });
});
