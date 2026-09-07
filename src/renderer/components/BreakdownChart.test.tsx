import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
  };
});

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
      />,
    );

    expect(screen.getByTestId('breakdown-chart')).toBeInTheDocument();
  });
});
