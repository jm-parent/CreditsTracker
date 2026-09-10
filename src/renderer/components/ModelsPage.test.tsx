import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ModelsPage } from './ModelsPage';
import { getColorForKey } from '../lib/colors';

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

describe('ModelsPage', () => {
  it('renders derived summary values, the chart, and the model table', () => {
    const { container } = render(
      <ModelsPage
        byModel={[
          { key: 'claude-sonnet-5', aiuCredits: 3 },
          { key: 'gpt-5.4', aiuCredits: 1 },
        ]}
        updateContextKey="all"
      />,
    );

    const summaryCards = container.querySelector('.summary-cards') as HTMLElement;
    expect(within(summaryCards).getByText('2')).toBeInTheDocument(); // count of models
    expect(within(summaryCards).getByText('4.00')).toBeInTheDocument(); // total credits
    expect(within(summaryCards).getByText('claude-sonnet-5')).toBeInTheDocument(); // top model
    expect(screen.getByText('Credits by model')).toBeInTheDocument();
    expect(screen.getByText('% of total')).toBeInTheDocument();
  });

  it('renders an empty state without crashing when there are no models', () => {
    const { container } = render(<ModelsPage byModel={[]} updateContextKey="all" />);

    const summaryCards = container.querySelector('.summary-cards') as HTMLElement;
    expect(within(summaryCards).getByText('0')).toBeInTheDocument(); // count of models
    expect(screen.getByText('No data for this selection.')).toBeInTheDocument();
    expect(screen.getByText('No models for this selection.')).toBeInTheDocument();
  });

  it('retains stable keyed colors for the model chart bars', () => {
    const { container } = render(
      <ModelsPage
        byModel={[
          { key: 'claude-sonnet-5', aiuCredits: 3 },
          { key: 'gpt-5.4', aiuCredits: 1 },
        ]}
        updateContextKey="all"
      />,
    );

    const rectangles = container.querySelectorAll('.recharts-rectangle');
    expect(rectangles).toHaveLength(2);
    expect(rectangles[0]).toHaveAttribute('fill', getColorForKey('claude-sonnet-5'));
    expect(rectangles[1]).toHaveAttribute('fill', getColorForKey('gpt-5.4'));
  });
});
