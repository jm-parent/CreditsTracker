import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BreakdownSummaryCards } from './BreakdownSummaryCards';

describe('BreakdownSummaryCards', () => {
  it('renders the count, total credits, and top entry', () => {
    render(
      <BreakdownSummaryCards
        countLabel="Projects"
        count={3}
        totalCredits={12.5}
        topLabel="Top project"
        topKey="org/repo-a"
        topCredits={7.25}
        updateContextKey="all"
      />,
    );

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('12.50')).toBeInTheDocument();
    expect(screen.getByText('Total credits')).toBeInTheDocument();
    expect(screen.getByText('org/repo-a')).toBeInTheDocument();
    expect(screen.getByText('7.25')).toBeInTheDocument();
    expect(screen.getByText('Top project')).toBeInTheDocument();
  });

  it('renders a placeholder when there is no top entry', () => {
    render(
      <BreakdownSummaryCards
        countLabel="Models"
        count={0}
        totalCredits={0}
        topLabel="Top model"
        topKey=""
        topCredits={0}
        updateContextKey="all"
      />,
    );

    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows the total and top-credit deltas independently when values change', () => {
    const { rerender } = render(
      <BreakdownSummaryCards
        countLabel="Projects"
        count={2}
        totalCredits={4}
        topLabel="Top project"
        topKey="org/repo-a"
        topCredits={3}
        updateContextKey="all"
      />,
    );

    rerender(
      <BreakdownSummaryCards
        countLabel="Projects"
        count={2}
        totalCredits={6}
        topLabel="Top project"
        topKey="org/repo-a"
        topCredits={4}
        updateContextKey="all"
      />,
    );

    expect(screen.getByText('+2.00')).toBeInTheDocument();
    expect(screen.getByText('+1.00')).toBeInTheDocument();
  });

  it('establishes a fresh baseline for a newly promoted top entry instead of comparing unrelated entities', () => {
    const { rerender, container } = render(
      <BreakdownSummaryCards
        countLabel="Projects"
        count={2}
        totalCredits={4}
        topLabel="Top project"
        topKey="org/repo-a"
        topCredits={3}
        updateContextKey="all"
      />,
    );

    rerender(
      <BreakdownSummaryCards
        countLabel="Projects"
        count={2}
        totalCredits={9}
        topLabel="Top project"
        topKey="org/repo-b"
        topCredits={5}
        updateContextKey="all"
      />,
    );

    const topCard = container.querySelectorAll('.summary-card')[2] as HTMLElement;
    expect(within(topCard).getByText('org/repo-b')).toBeInTheDocument();
    expect(within(topCard).getByText('5.00')).toBeInTheDocument();
    expect(within(topCard).queryByText(/^[+−]/)).not.toBeInTheDocument();
  });

  it('clears deltas when the update context key changes', () => {
    const { rerender } = render(
      <BreakdownSummaryCards
        countLabel="Projects"
        count={2}
        totalCredits={4}
        topLabel="Top project"
        topKey="org/repo-a"
        topCredits={3}
        updateContextKey="all"
      />,
    );

    rerender(
      <BreakdownSummaryCards
        countLabel="Projects"
        count={2}
        totalCredits={9}
        topLabel="Top project"
        topKey="org/repo-a"
        topCredits={5}
        updateContextKey="workspace"
      />,
    );

    expect(screen.queryByText('+5.00')).not.toBeInTheDocument();
    expect(screen.queryByText('+2.00')).not.toBeInTheDocument();
  });
});
