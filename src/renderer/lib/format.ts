/**
 * Formats a raw token count into a compact human-readable string using
 * k (thousand), M (million), and B (billion) suffixes, e.g. 346684014 -> "346.7M".
 */
export function formatTokens(tokens: number): string {
  const abs = Math.abs(tokens);
  const sign = tokens < 0 ? '-' : '';

  if (abs >= 1_000_000_000) {
    return `${sign}${trimTrailingZero((abs / 1_000_000_000).toFixed(1))}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${trimTrailingZero((abs / 1_000_000).toFixed(1))}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${trimTrailingZero((abs / 1_000).toFixed(1))}k`;
  }
  return `${sign}${abs}`;
}

function trimTrailingZero(value: string): string {
  return value.endsWith('.0') ? value.slice(0, -2) : value;
}
