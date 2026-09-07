const PALETTE = [
  '#22d3ee', // cyan
  '#a78bfa', // violet
  '#34d399', // emerald
  '#f472b6', // pink
  '#fbbf24', // amber
  '#60a5fa', // blue
  '#f87171', // red
  '#4ade80', // green
  '#c084fc', // purple
  '#fb923c', // orange
];

/**
 * Deterministically maps a string key (e.g. a project name) to a stable color
 * from a fixed palette, so the same project always gets the same color across
 * renders and filter changes.
 */
export function getColorForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % PALETTE.length;
  return PALETTE[index];
}
