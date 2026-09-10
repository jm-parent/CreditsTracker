import type { JSX } from 'react';
import { cn } from '../lib/utils';
import type { CreditChange } from '../hooks/useCreditChanges';

export interface CreditValueProps {
  value: number;
  change?: CreditChange;
  className?: string;
  suffix?: string;
}

export function CreditValue(props: CreditValueProps): JSX.Element {
  const { value, change, className, suffix } = props;

  return (
    <span className={cn('credit-value inline-flex items-baseline', className)}>
      <span>{value.toFixed(2)}</span>
      {change && (
        <span
          key={change.animationKey}
          aria-hidden="true"
          className={cn(
            'credit-delta pointer-events-none absolute left-full ml-2 whitespace-nowrap text-xs font-medium',
            change.delta > 0 ? 'credit-delta-positive' : 'credit-delta-negative',
          )}
        >
          {change.delta > 0 ? '+' : '−'}
          {Math.abs(change.delta).toFixed(2)}
        </span>
      )}
      {suffix && <span>{suffix}</span>}
    </span>
  );
}
