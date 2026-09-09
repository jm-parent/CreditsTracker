import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';
import { resetLogDedupeForTests } from '../lib/logger';

function Boom(): never {
  throw new Error('render exploded');
}

beforeEach(() => {
  resetLogDedupeForTests();
  window.api = { ...window.api, log: vi.fn().mockResolvedValue(undefined) } as typeof window.api;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary scope="tab:models">
        <p>All good</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('shows a fallback and logs the error instead of blanking the page', () => {
    render(
      <ErrorBoundary scope="tab:models">
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText('This page failed to render.')).toBeInTheDocument();
    expect(screen.getByText('render exploded')).toBeInTheDocument();
    expect(window.api.log).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', scope: 'tab:models' }),
    );
  });
});
