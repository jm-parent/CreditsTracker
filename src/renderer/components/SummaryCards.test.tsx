import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryCards } from './SummaryCards';

describe('SummaryCards', () => {
  it('renders AIU credits, tokens, and request totals', () => {
    render(<SummaryCards totals={{ aiuCredits: 12.5, tokens: 3400, requests: 42 }} />);

    expect(screen.getByText('12.50')).toBeInTheDocument();
    expect(screen.getByText('AIU credits')).toBeInTheDocument();
    expect(screen.getByText('3.4k')).toBeInTheDocument();
    expect(screen.getByText('Tokens')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Requests')).toBeInTheDocument();
  });
});
