import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DailyConsumptionPage } from './DailyConsumptionPage';

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

describe('DailyConsumptionPage', () => {
  it('renders summary cards and the time series chart', () => {
    render(
      <DailyConsumptionPage
        totals={{ aiuCredits: 3, tokens: 120, requests: 1 }}
        timeSeries={[{ date: '2026-09-01', aiuCredits: 3 }]}
        onDayClick={vi.fn()}
        updateContextKey="all"
      />,
    );

    expect(screen.getByText('3.00')).toBeInTheDocument();
    expect(screen.getByText('AIU credits')).toBeInTheDocument();
    expect(screen.getByText('Credits over time')).toBeInTheDocument();
    expect(screen.getByTestId('time-series-chart')).toBeInTheDocument();
  });
});
