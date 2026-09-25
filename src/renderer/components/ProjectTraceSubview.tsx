import type { AgentTraceSelection } from '../../shared/types';
import { useAgentTrace } from '../hooks/useAgentTrace';
import { AgentTraceTree } from './AgentTraceTree';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

export interface ProjectTraceSubviewProps {
  project: string;
  selection: AgentTraceSelection;
  onBack(): void;
}

export function ProjectTraceSubview({ project, selection, onBack }: ProjectTraceSubviewProps) {
  const { collectionStatus, session, sessionLoading, error } = useAgentTrace(selection);
  const activeError = error?.message ?? collectionStatus?.errorMessage ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          Retour au projet
        </button>
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-foreground">{project}</h2>
          <p className="text-sm text-muted-foreground">
            Inspect the selected conversation trace without leaving this project detail.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-base text-foreground">Selected conversation</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Badge>{selection.source}</Badge>
            <Badge>{selection.sessionId}</Badge>
            {collectionStatus?.listening && <Badge>listening</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {activeError && (
            <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300">
              {activeError}
            </p>
          )}

          {sessionLoading ? (
            <p className="text-sm text-muted-foreground">Loading selected trace…</p>
          ) : session?.availability === 'not-collected' ? (
            <p className="text-sm text-muted-foreground">
              No trace has been collected yet for this conversation.
            </p>
          ) : session ? (
            <>
              {session.availability === 'partial' && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  Some spans were stored without a complete parent chain, so this trace is partial.
                </p>
              )}
              <AgentTraceTree session={session} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No stored trace is available right now.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
