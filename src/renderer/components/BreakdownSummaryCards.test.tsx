import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
      />,
    );

    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
