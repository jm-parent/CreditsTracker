import { SummaryCards } from './SummaryCards';
import { TimeSeriesChart } from './TimeSeriesChart';
import type { TimeSeriesPoint, UsageTotals } from '../../shared/types';

export interface DailyConsumptionPageProps {
  totals: UsageTotals;
  timeSeries: TimeSeriesPoint[];
  onDayClick: (date: string) => void;
  updateContextKey: string;
}

export function DailyConsumptionPage({ totals, timeSeries, onDayClick, updateContextKey }: DailyConsumptionPageProps) {
  return (
    <div className="daily-consumption-page flex flex-col gap-6">
      <SummaryCards totals={totals} updateContextKey={updateContextKey} />
      <TimeSeriesChart data={timeSeries} onDayClick={onDayClick} />
    </div>
  );
}
