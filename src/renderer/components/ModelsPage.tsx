import { BreakdownSummaryCards } from './BreakdownSummaryCards';
import { BreakdownChart } from './BreakdownChart';
import { ModelTable } from './ModelTable';
import type { BreakdownPoint } from '../../shared/types';

export interface ModelsPageProps {
  byModel: BreakdownPoint[];
}

export function ModelsPage({ byModel }: ModelsPageProps) {
  const totalCredits = byModel.reduce((sum, m) => sum + m.aiuCredits, 0);
  const topModel = byModel.reduce<BreakdownPoint | null>(
    (top, m) => (!top || m.aiuCredits > top.aiuCredits ? m : top),
    null,
  );

  return (
    <div className="models-page flex flex-col gap-6">
      <BreakdownSummaryCards
        countLabel="Models"
        count={byModel.length}
        totalCredits={totalCredits}
        topLabel="Top model"
        topKey={topModel?.key ?? ''}
        topCredits={topModel?.aiuCredits ?? 0}
      />
      <BreakdownChart title="Credits by model" data={byModel} />
      <ModelTable rows={byModel} />
    </div>
  );
}
