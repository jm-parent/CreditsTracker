import { Card, CardContent } from './ui/card';
import { formatTokens } from '../lib/format';
import type { UsageTotals } from '../../shared/types';

interface SummaryCardsProps {
  totals: UsageTotals;
}

export function SummaryCards({ totals }: SummaryCardsProps) {
  return (
    <div className="summary-cards grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card className="summary-card">
        <CardContent className="flex flex-col gap-1 p-4">
          <span className="summary-value text-2xl font-semibold text-foreground">{totals.aiuCredits.toFixed(2)}</span>
          <span className="summary-label text-sm text-muted-foreground">AIU credits</span>
        </CardContent>
      </Card>
      <Card className="summary-card">
        <CardContent className="flex flex-col gap-1 p-4">
          <span className="summary-value text-2xl font-semibold text-foreground">{formatTokens(totals.tokens)}</span>
          <span className="summary-label text-sm text-muted-foreground">Tokens</span>
        </CardContent>
      </Card>
      <Card className="summary-card">
        <CardContent className="flex flex-col gap-1 p-4">
          <span className="summary-value text-2xl font-semibold text-foreground">{totals.requests}</span>
          <span className="summary-label text-sm text-muted-foreground">Requests</span>
        </CardContent>
      </Card>
    </div>
  );
}
