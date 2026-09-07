import type { UsageTotals } from '../../shared/types';

interface SummaryCardsProps {
  totals: UsageTotals;
}

export function SummaryCards({ totals }: SummaryCardsProps) {
  return (
    <div className="summary-cards">
      <div className="summary-card">
        <span className="summary-value">{totals.aiuCredits.toFixed(2)}</span>
        <span className="summary-label">AIU credits</span>
      </div>
      <div className="summary-card">
        <span className="summary-value">{totals.tokens}</span>
        <span className="summary-label">Tokens</span>
      </div>
      <div className="summary-card">
        <span className="summary-value">{totals.requests}</span>
        <span className="summary-label">Requests</span>
      </div>
    </div>
  );
}
