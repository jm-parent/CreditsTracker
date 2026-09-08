import { Card, CardContent } from './ui/card';

export interface BreakdownSummaryCardsProps {
  countLabel: string;
  count: number;
  totalCredits: number;
  topLabel: string;
  topKey: string;
  topCredits: number;
}

export function BreakdownSummaryCards({
  countLabel,
  count,
  totalCredits,
  topLabel,
  topKey,
  topCredits,
}: BreakdownSummaryCardsProps) {
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
            {totalCredits.toFixed(2)}
          </span>
          <span className="summary-label text-sm text-muted-foreground">Total credits</span>
        </CardContent>
      </Card>
      <Card className="summary-card">
        <CardContent className="flex flex-col gap-1 p-4">
          <span className="summary-value text-2xl font-semibold text-foreground">
            {topKey ? topKey : '—'}
          </span>
          {topKey ? (
            <>
              <span className="summary-label text-sm text-muted-foreground">{topLabel}</span>
              <span className="summary-label text-sm text-muted-foreground">{topCredits.toFixed(2)}</span>
            </>
          ) : (
            <span className="summary-label text-sm text-muted-foreground">{topLabel}</span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
