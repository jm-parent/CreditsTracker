const PALETTE = [
  '#22d3ee', // cyan
  '#f97316', // orange
  '#a3e635', // lime
  '#ec4899', // pink
  '#3b82f6', // blue
  '#eab308', // yellow
  '#ef4444', // red
  '#14b8a6', // teal
  '#a855f7', // purple
  '#84cc16', // green
  '#f43f5e', // rose
  '#0ea5e9', // sky
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
