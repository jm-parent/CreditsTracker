import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the given title and message', () => {
    render(<EmptyState title="No data" message="Nothing to show for this selection." />);

    expect(screen.getByRole('heading', { name: 'No data' })).toBeInTheDocument();
    expect(screen.getByText('Nothing to show for this selection.')).toBeInTheDocument();
  });
});
