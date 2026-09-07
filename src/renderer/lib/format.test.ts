import { describe, it, expect } from 'vitest';
import { formatTokens } from './format';

describe('formatTokens', () => {
  it('renders numbers under 1000 as-is', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
  });

  it('renders thousands with a k suffix', () => {
    expect(formatTokens(1000)).toBe('1k');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(999_000)).toBe('999k');
  });

  it('renders millions with an M suffix', () => {
    expect(formatTokens(1_000_000)).toBe('1M');
    expect(formatTokens(346_684_014)).toBe('346.7M');
  });

  it('renders billions with a B suffix', () => {
    expect(formatTokens(1_000_000_000)).toBe('1B');
    expect(formatTokens(2_500_000_000)).toBe('2.5B');
  });

  it('handles negative numbers', () => {
    expect(formatTokens(-1_500_000)).toBe('-1.5M');
  });
});
