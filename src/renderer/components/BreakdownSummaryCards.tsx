import { useMemo } from 'react';
import { Card, CardContent } from './ui/card';
import { CreditValue } from './CreditValue';
import { useCreditChanges } from '../hooks/useCreditChanges';
import type { CreditDatum } from '../hooks/useCreditChanges';

export interface BreakdownSummaryCardsProps {
  countLabel: string;
  count: number;
  totalCredits: number;
  topLabel: string;
  topKey: string;
  topCredits: number;
  updateContextKey: string;
}

const CREDIT_DELTA_DURATION_MS = 1_500;

export function BreakdownSummaryCards({
  countLabel,
  count,
  totalCredits,
  topLabel,
  topKey,
  topCredits,
  updateContextKey,
}: BreakdownSummaryCardsProps) {
  // Stabilize the snapshot identity across renders so a state update inside
  // useCreditChanges (which schedules the auto-clear via setChanges) does not
  // itself look like a new snapshot and cancel its own pending timeout.
  const snapshot = useMemo(
    () => ({ count, totalCredits, topKey, topCredits }),
    [count, totalCredits, topKey, topCredits],
  );
  const values: CreditDatum[] = [{ key: 'total', value: totalCredits }];
  if (topKey) {
    values.push({ key: topKey, value: topCredits });
  }
  const changes = useCreditChanges(snapshot, values, updateContextKey, CREDIT_DELTA_DURATION_MS);

  return (
    <div className="summary-cards grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card className="summary-card">
        <CardContent className="flex flex-col gap-1 p-4">
          <span className="summary-value text-2xl font-semibold text-foreground">{count}</span>
          <span className="summary-label text-sm text-muted-foreground">{countLabel}</span>
        </CardContent>
      </Card>
      <Card className="summary-card">
        <CardContent className="flex flex-col gap-1 p-4">
          <span className="summary-value text-2xl font-semibold text-foreground">
            <CreditValue value={totalCredits} change={changes.get('total')} />
          </span>
          <span className="summary-label text-sm text-muted-foreground">Total credits</span>
        </CardContent>
      </Card>
      <Card className="summary-card">
        <CardContent className="flex flex-col gap-1 p-4">
          <span
            className="summary-value block truncate text-2xl font-semibold text-foreground"
            title={topKey || undefined}
          >
            {topKey ? topKey : '—'}
          </span>
          <span className="summary-label text-sm text-muted-foreground">{topLabel}</span>
          {topKey && (
            <span className="summary-label text-sm text-muted-foreground">
              <CreditValue value={topCredits} change={changes.get(topKey)} />
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
