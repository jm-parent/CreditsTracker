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
  /**
   * Identity of the successful response these aggregates were derived from.
   * Two responses can carry identical aggregates, so the owning data array is
   * the only reliable way to tell a genuine refresh from a re-render. Falls
   * back to the aggregate values when a caller has no owning array.
   */
  dataSnapshot?: object;
}

const CREDIT_DELTA_DURATION_MS = 1_500;
// Aggregate and entity keys live in disjoint namespaces so a project or model
// literally named "total" cannot collide with the total-credits card.
const SUMMARY_TOTAL_KEY = 'summary:total';

function entityKey(key: string): string {
  return `entity:${key}`;
}

export function BreakdownSummaryCards({
  countLabel,
  count,
  totalCredits,
  topLabel,
  topKey,
  topCredits,
  updateContextKey,
  dataSnapshot,
}: BreakdownSummaryCardsProps) {
  // Stabilize the fallback snapshot identity across renders so a state update
  // inside useCreditChanges (which schedules the auto-clear via setChanges)
  // does not itself look like a new snapshot.
  const aggregateSnapshot = useMemo(
    () => ({ count, totalCredits, topKey, topCredits }),
    [count, totalCredits, topKey, topCredits],
  );
  const snapshot = dataSnapshot ?? aggregateSnapshot;
  const values: CreditDatum[] = [{ key: SUMMARY_TOTAL_KEY, value: totalCredits }];
  if (topKey) {
    values.push({ key: entityKey(topKey), value: topCredits });
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
            <CreditValue value={totalCredits} change={changes.get(SUMMARY_TOTAL_KEY)} />
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
              <CreditValue value={topCredits} change={changes.get(entityKey(topKey))} />
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
