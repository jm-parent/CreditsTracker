import { BreakdownSummaryCards } from './BreakdownSummaryCards';
import { BreakdownChart } from './BreakdownChart';
import { SessionsTable } from './SessionsTable';
import type { BreakdownPoint } from '../../shared/types';

export interface ProjectsPageProps {
  byProject: BreakdownPoint[];
  onProjectClick: (project: string) => void;
  updateContextKey: string;
}

export function ProjectsPage({ byProject, onProjectClick, updateContextKey }: ProjectsPageProps) {
  const totalCredits = byProject.reduce((sum, p) => sum + p.aiuCredits, 0);
  const topProject = byProject.reduce<BreakdownPoint | null>(
    (top, p) => (!top || p.aiuCredits > top.aiuCredits ? p : top),
    null,
  );

  return (
    <div className="projects-page flex flex-col gap-6">
      <BreakdownSummaryCards
        countLabel="Projects"
        count={byProject.length}
        totalCredits={totalCredits}
        topLabel="Top project"
        topKey={topProject?.key ?? ''}
        topCredits={topProject?.aiuCredits ?? 0}
        updateContextKey={updateContextKey}
      />
      <BreakdownChart
        title="Credits by project"
        data={byProject}
        onBarClick={onProjectClick}
        colorByKey
        updateContextKey={updateContextKey}
      />
      <SessionsTable rows={byProject} updateContextKey={updateContextKey} />
    </div>
  );
}
