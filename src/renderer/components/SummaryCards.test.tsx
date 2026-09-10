import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { SummaryCards } from './SummaryCards';

describe('SummaryCards', () => {
  it('renders AIU credits, tokens, and request totals', () => {
    render(
      <SummaryCards totals={{ aiuCredits: 12.5, tokens: 3400, requests: 42 }} updateContextKey="all" />,
    );

    expect(screen.getByText('12.50')).toBeInTheDocument();
    expect(screen.getByText('AIU credits')).toBeInTheDocument();
    expect(screen.getByText('3.4k')).toBeInTheDocument();
    expect(screen.getByText('Tokens')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Requests')).toBeInTheDocument();
  });

  it('shows a credit delta when the totals change, and clears it after a context reset', () => {
    const first = { aiuCredits: 10, tokens: 100, requests: 1 };
    const { rerender } = render(<SummaryCards totals={first} updateContextKey="all" />);
    expect(screen.queryByText('+2.50')).not.toBeInTheDocument();

    const second = { aiuCredits: 12.5, tokens: 200, requests: 2 };
    rerender(<SummaryCards totals={second} updateContextKey="all" />);
    expect(screen.getByText('+2.50')).toBeInTheDocument();
    expect(screen.queryByText('+100.00')).not.toBeInTheDocument();

    const third = { aiuCredits: 5, tokens: 50, requests: 1 };
    rerender(<SummaryCards totals={third} updateContextKey="workspace" />);
    expect(screen.queryByText('+2.50')).not.toBeInTheDocument();
    expect(screen.queryByText('−7.50')).not.toBeInTheDocument();
  });

  it('clears the credit delta 1,500 ms after it appears (stable totals reference per render)', () => {
    vi.useFakeTimers();
    try {
      const first = { aiuCredits: 10, tokens: 100, requests: 1 };
      const { rerender } = render(<SummaryCards totals={first} updateContextKey="all" />);

      const second = { aiuCredits: 12.5, tokens: 200, requests: 2 };
      rerender(<SummaryCards totals={second} updateContextKey="all" />);

      expect(screen.getByText('+2.50')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1_500);
      });

      expect(screen.queryByText('+2.50')).not.toBeInTheDocument();
      expect(screen.getByText('12.50')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
