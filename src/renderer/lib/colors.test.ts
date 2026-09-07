import { describe, it, expect } from 'vitest';
import { getColorForKey } from './colors';

describe('getColorForKey', () => {
  it('returns the same color for the same key every time', () => {
    expect(getColorForKey('org/repo-a')).toBe(getColorForKey('org/repo-a'));
  });

  it('returns a valid hex color string', () => {
    expect(getColorForKey('org/repo-a')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('tends to return different colors for different keys', () => {
    const colors = new Set(
      ['org/repo-a', 'org/repo-b', 'org/repo-c', 'org/repo-d'].map(getColorForKey),
    );
    expect(colors.size).toBeGreaterThan(1);
  });

  it('handles an empty string without throwing', () => {
    expect(() => getColorForKey('')).not.toThrow();
  });
});
