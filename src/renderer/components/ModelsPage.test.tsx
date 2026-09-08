import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ModelsPage } from './ModelsPage';

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

describe('ModelsPage', () => {
  it('renders derived summary values, the chart, and the model table', () => {
    const { container } = render(
      <ModelsPage
        byModel={[
          { key: 'claude-sonnet-5', aiuCredits: 3 },
          { key: 'gpt-5.4', aiuCredits: 1 },
        ]}
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
    const { container } = render(<ModelsPage byModel={[]} />);

    const summaryCards = container.querySelector('.summary-cards') as HTMLElement;
    expect(within(summaryCards).getByText('0')).toBeInTheDocument(); // count of models
    expect(screen.getByText('No data for this selection.')).toBeInTheDocument();
    expect(screen.getByText('No models for this selection.')).toBeInTheDocument();
  });
});
