import { useMemo, useState } from 'react';
import type { AgentTraceSession } from '../../shared/types';
import { buildAgentTraceTree, type AgentTraceNode } from '../lib/agent-trace-tree';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { cn } from '../lib/utils';

export interface AgentTraceTreeProps {
  session: AgentTraceSession;
}

export function AgentTraceTree({ session }: AgentTraceTreeProps) {
  const turns = useMemo(() => buildAgentTraceTree(session.spans), [session.spans]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base text-foreground">Spans de trace agent</CardTitle>
            <Badge>{session.source}</Badge>
            <Badge>{session.availability}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {session.availability === 'partial'
              ? 'Trace partielle'
              : session.availability === 'not-collected'
                ? 'Trace non collectée'
                : 'Trace disponible'}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {turns.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun span stocké pour cette session.</p>
          ) : (
            <section aria-label="Spans de trace agent" className="flex flex-col gap-4">
              {turns.map((turn) => {
                const turnStart = turn.roots[0]?.span.startedAt ?? null;
                const headingId = `agent-trace-turn-heading-${turn.traceId}`;
                return (
                  <div
                    key={turn.traceId}
                    data-testid={`agent-trace-turn-${turn.traceId}`}
                    className="rounded-lg border border-border bg-card p-4"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 id={headingId} className="text-sm font-medium text-foreground">{turn.traceId}</h3>
                      <span className="text-xs text-muted-foreground">
                        {turn.roots.length} racine{turn.roots.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <ul aria-labelledby={headingId} className="flex flex-col gap-3">
                      {turn.roots.map((node) => (
                        <AgentTraceTreeNodeView
                          key={node.span.spanId}
                          node={node}
                          turnStart={turnStart}
                        />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface AgentTraceTreeNodeViewProps {
  node: AgentTraceNode;
  turnStart: string | null;
}

// Nested lists convey the hierarchy natively; an ARIA tree would also require roving keyboard focus.
function AgentTraceTreeNodeView({ node, turnStart }: AgentTraceTreeNodeViewProps) {
  const { span } = node;
  const [expanded, setExpanded] = useState(false);
  const detailsId = `agent-trace-details-${span.traceId}-${span.spanId}`;
  const hasDisplayableContent = span.category !== 'llm' && (span.argumentsJson !== null || span.resultText !== null);
  const offsetLabel = formatOffset(turnStart, span.startedAt);
  const durationLabel = formatDuration(span.durationMs);

  return (
    <li
      className={cn(
        'rounded-md border border-border/80 bg-background p-3',
        node.unparented && 'border-amber-500/50',
      )}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{span.category}</Badge>
              <span className="text-sm font-medium text-foreground">{span.name}</span>
              <Badge>{span.status}</Badge>
              <Badge>{span.contentState}</Badge>
              {node.unparented && <Badge>parent manquant</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{new Date(span.startedAt).toISOString()}</span>
              <span>{offsetLabel}</span>
              <span>{durationLabel}</span>
              {span.model && <span>{span.model}</span>}
              {span.skillName && <span>{span.skillName}</span>}
              {span.toolName && <span>{span.toolName}</span>}
              {span.errorType && <span>{span.errorType}</span>}
            </div>
          </div>
          {hasDisplayableContent && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={detailsId}
              aria-label={`${span.name} : détails à ${offsetLabel}`}
              className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
              onClick={() => setExpanded((current) => !current)}
            >
              {span.name}
            </button>
          )}
        </div>

        {hasDisplayableContent && expanded && (
          <div id={detailsId} className="grid gap-3 rounded-md bg-muted/60 p-3 text-sm">
            {span.argumentsJson !== null && (
              <section>
                <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Arguments
                </h4>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs text-foreground">
                  {span.argumentsJson}
                </pre>
              </section>
            )}
            {span.resultText !== null && (
              <section>
                <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Résultat
                </h4>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs text-foreground">
                  {span.resultText}
                </pre>
              </section>
            )}
          </div>
        )}

        {node.children.length > 0 && (
          <ul
            aria-label={`Appels sous ${span.name}`}
            className="ml-4 flex flex-col gap-3 border-l border-border pl-4"
          >
            {node.children.map((child) => (
              <AgentTraceTreeNodeView
                key={child.span.spanId}
                node={child}
                turnStart={turnStart}
              />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function formatOffset(turnStart: string | null, startedAt: string): string {
  if (!turnStart) {
    return '+0 ms';
  }

  const offsetMs = Math.max(0, Date.parse(startedAt) - Date.parse(turnStart));
  return `+${formatMilliseconds(offsetMs)}`;
}

function formatDuration(durationMs: number): string {
  return formatMilliseconds(durationMs);
}

function formatMilliseconds(value: number): string {
  if (value >= 1000) {
    const seconds = value / 1000;
    return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(2)} s`;
  }

  return `${Math.round(value)} ms`;
}
