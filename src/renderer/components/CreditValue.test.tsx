import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CreditValue } from './CreditValue';

describe('CreditValue', () => {
  it('renders the final value, change, and suffix', () => {
    render(<CreditValue value={12.5} change={{ delta: 2.5, animationKey: 1 }} suffix=" credits" />);

    expect(screen.getByText('12.50')).toBeInTheDocument();
    expect(screen.getByText('+2.50')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('credits')).toBeInTheDocument();
  });

  it('replaces the delta node when the animation key changes', () => {
    const { rerender } = render(<CreditValue value={12.5} change={{ delta: 2.5, animationKey: 1 }} />);
    const firstDelta = screen.getByText('+2.50');

    rerender(<CreditValue value={15} change={{ delta: 2.5, animationKey: 2 }} />);

    expect(screen.getByText('15.00')).toBeInTheDocument();
    expect(screen.getByText('+2.50')).not.toBe(firstDelta);
  });

  it('renders negative changes with a unicode minus sign and negative class', () => {
    render(<CreditValue value={8.5} change={{ delta: -1.5, animationKey: 3 }} />);

    const delta = screen.getByText('−1.50');

    expect(delta).toHaveClass('credit-delta-negative');
  });

  it('omits the delta when no change is provided', () => {
    render(<CreditValue value={8.5} />);

    expect(screen.getByText('8.50')).toBeInTheDocument();
    expect(screen.queryByText('+')).not.toBeInTheDocument();
    expect(screen.queryByText('−')).not.toBeInTheDocument();
  });
});
