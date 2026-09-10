import type { CreditChange } from '../hooks/useCreditChanges';

export interface CreditDropLabelProps {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  change?: CreditChange;
  color: string;
  offsetX?: number;
}

function numeric(value: number | string | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function CreditDropLabel({
  x,
  y,
  width,
  change,
  color,
  offsetX = 0,
}: CreditDropLabelProps): React.JSX.Element | null {
  if (!change) {
    return null;
  }

  const numericX = numeric(x);
  const numericY = numeric(y);
  const numericWidth = numeric(width);

  if (numericX === null || numericY === null || numericWidth === null) {
    return null;
  }

  const isPositive = change.delta > 0;

  return (
    <text
      key={change.animationKey}
      x={numericX + numericWidth / 2 + offsetX}
      y={Math.max(12, numericY - 6)}
      fill={isPositive ? color : '#fb923c'}
      textAnchor="middle"
      aria-hidden="true"
      data-credit-drop="true"
      data-animation-key={change.animationKey}
      className={isPositive ? 'credit-drop credit-drop-positive' : 'credit-drop credit-drop-negative'}
      pointerEvents="none"
    >
      {isPositive ? '+' : '−'}
      {Math.abs(change.delta).toFixed(2)}
    </text>
  );
}
