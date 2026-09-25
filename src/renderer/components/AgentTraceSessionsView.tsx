import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentTraceCategory,
  AgentTraceSelection,
  AgentTraceSessionListFilters,
  AgentTraceSessionListPage,
  AgentTraceSessionSummary,
  AgentTraceSource,
  AgentTraceSpan,
} from '../../shared/types';
import { MAX_AGENT_TRACE_SESSION_SEARCH_LENGTH } from '../../shared/types';
import { useAgentTrace } from '../hooks/useAgentTrace';
import { logError } from '../lib/logger';
import { AgentTraceTree } from './AgentTraceTree';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

const INITIAL_FILTERS: AgentTraceSessionListFilters = {
  query: '',
  source: null,
  from: null,
  to: null,
  category: null,
  status: null,
  page: 0,
};

const SOURCE_OPTIONS: Array<{ value: AgentTraceSource; label: string }> = [
  { value: 'vscode', label: 'VS Code' },
  { value: 'copilot-cli', label: 'Copilot CLI' },
];

const CATEGORY_OPTIONS: Array<{ value: AgentTraceCategory; label: string }> = [
  { value: 'agent', label: 'Agent' },
  { value: 'llm', label: 'LLM' },
  { value: 'tool', label: 'Outil' },
  { value: 'skill', label: 'Skill' },
  { value: 'shell', label: 'Shell' },
  { value: 'mcp', label: 'MCP' },
  { value: 'hook', label: 'Hook' },
  { value: 'other', label: 'Autre' },
];

const STATUS_OPTIONS: Array<{ value: AgentTraceSpan['status']; label: string }> = [
  { value: 'ok', label: 'OK' },
  { value: 'error', label: 'Erreur' },
  { value: 'unset', label: 'Non défini' },
];

function getSourceLabel(source: AgentTraceSource): string {
  return SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? source;
}

export interface AgentTraceSessionsViewProps {
  onBack(): void;
}

export function AgentTraceSessionsView({ onBack }: AgentTraceSessionsViewProps) {
  const [filters, setFilters] = useState<AgentTraceSessionListFilters>(INITIAL_FILTERS);
  const [listPage, setListPage] = useState<AgentTraceSessionListPage | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<Error | null>(null);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [selectedSummary, setSelectedSummary] = useState<AgentTraceSessionSummary | null>(null);
  const requestGenerationRef = useRef(0);
  const dateRangeErrorMessage = getDateRangeErrorMessage(filters.from, filters.to);

  useEffect(() => {
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;

    if (dateRangeErrorMessage) {
      setListLoading(false);
      setListError(null);
      return;
    }

    setListLoading(true);
    setListError(null);

    void window.api
      .listAgentTraceSessions(filters)
      .then((page) => {
        if (requestGenerationRef.current !== requestGeneration) {
          return;
        }
        setListPage(page);
      })
      .catch((error: unknown) => {
        logError('AgentTraceSessionsView', 'listAgentTraceSessions failed', error);
        if (requestGenerationRef.current !== requestGeneration) {
          return;
        }
        setListError(asError(error));
      })
      .finally(() => {
        if (requestGenerationRef.current === requestGeneration) {
          setListLoading(false);
        }
      });
  }, [dateRangeErrorMessage, filters, retryGeneration]);

  const totalPages = useMemo(() => {
    const total = listPage?.total ?? 0;
    const pageSize = listPage?.pageSize ?? 1;
    return Math.max(1, Math.ceil(total / pageSize));
  }, [listPage?.pageSize, listPage?.total]);
  const currentPage = (listPage?.page ?? filters.page) + 1;
  const hasActiveFilters = filters.query.trim() !== ''
    || filters.source !== null
    || filters.from !== null
    || filters.to !== null
    || filters.category !== null
    || filters.status !== null;

  if (selectedSummary) {
    return (
      <AgentTraceSessionDetail
        summary={selectedSummary}
        onBack={onBack}
        onBackToSessions={() => setSelectedSummary(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-foreground">Sessions de traces agents</h2>
          <p className="text-sm text-muted-foreground">
            Parcourez les sessions stockées puis ouvrez le détail complet d&apos;une session.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          Retour aux traces
        </button>
      </div>

      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-base text-foreground">Filtres</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <LabeledField label="Recherche" htmlFor="agent-trace-session-query">
            <input
              id="agent-trace-session-query"
              type="search"
              aria-label="Recherche"
              value={filters.query}
              maxLength={MAX_AGENT_TRACE_SESSION_SEARCH_LENGTH}
              onChange={(event) => {
                updateFilters(setFilters, { query: event.target.value });
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
            <p className="text-xs text-muted-foreground">Rechercher par ID, outil, skill ou modèle.</p>
          </LabeledField>

          <LabeledField label="Source" htmlFor="agent-trace-session-source">
            <select
              id="agent-trace-session-source"
              aria-label="Source"
              value={filters.source ?? ''}
              onChange={(event) => {
                updateFilters(setFilters, {
                  source: event.target.value === '' ? null : (event.target.value as AgentTraceSource),
                });
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Toutes</option>
              {SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </LabeledField>

          <LabeledField label="Du" htmlFor="agent-trace-session-from">
            <input
              id="agent-trace-session-from"
              type="date"
              aria-label="Du"
              value={filters.from ?? ''}
              aria-invalid={dateRangeErrorMessage ? 'true' : 'false'}
              max={filters.to ?? undefined}
              onChange={(event) => {
                updateFilters(setFilters, { from: normalizeDateFilter(event.target.value) });
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </LabeledField>

          <LabeledField label="Au" htmlFor="agent-trace-session-to">
            <input
              id="agent-trace-session-to"
              type="date"
              aria-label="Au"
              value={filters.to ?? ''}
              aria-invalid={dateRangeErrorMessage ? 'true' : 'false'}
              min={filters.from ?? undefined}
              onChange={(event) => {
                updateFilters(setFilters, { to: normalizeDateFilter(event.target.value) });
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </LabeledField>

          <LabeledField label="Catégorie" htmlFor="agent-trace-session-category">
            <select
              id="agent-trace-session-category"
              aria-label="Catégorie"
              value={filters.category ?? ''}
              onChange={(event) => {
                updateFilters(setFilters, {
                  category: event.target.value === '' ? null : (event.target.value as AgentTraceCategory),
                });
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Toutes</option>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </LabeledField>

          <LabeledField label="Statut" htmlFor="agent-trace-session-status">
            <select
              id="agent-trace-session-status"
              aria-label="Statut"
              value={filters.status ?? ''}
              onChange={(event) => {
                updateFilters(setFilters, {
                  status: event.target.value === '' ? null : (event.target.value as AgentTraceSpan['status']),
                });
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Tous</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </LabeledField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base text-foreground">Résultats</CardTitle>
            {listPage && !listError && (
              <p className="text-sm text-muted-foreground">
                {listPage.total} session{listPage.total > 1 ? 's' : ''} · Page {currentPage} sur {totalPages}
              </p>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {dateRangeErrorMessage ? (
            <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300">
              {dateRangeErrorMessage}
            </p>
          ) : listError ? (
            <div className="space-y-3">
              <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300">
                {listError.message}
              </p>
              <button
                type="button"
                onClick={() => setRetryGeneration((current) => current + 1)}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
              >
                Réessayer
              </button>
            </div>
          ) : listLoading && !listPage ? (
            <p className="text-sm text-muted-foreground">Chargement des sessions…</p>
          ) : listPage && listPage.total === 0 ? (
            <p className="text-sm text-muted-foreground">
              {hasActiveFilters
                ? 'Aucune session ne correspond aux filtres actuels.'
                : 'Aucune session de trace enregistrée pour le moment.'}
            </p>
          ) : listPage ? (
            <>
              {listLoading && <p className="text-sm text-muted-foreground">Chargement des sessions…</p>}
              <Table aria-label="Liste des sessions de traces agents">
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Session</TableHead>
                    <TableHead>Spans</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listPage.items.map((item) => (
                    <TableRow key={`${item.source}:${item.sessionId}`}>
                      <TableCell>{item.source}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setSelectedSummary(item)}
                          className="rounded-sm text-left text-sm text-cyan-300 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
                          aria-label={`Ouvrir la session ${getSourceLabel(item.source)} : ${item.sessionId}`}
                        >
                          {item.sessionId}
                        </button>
                      </TableCell>
                      <TableCell>{item.spanCount} span{item.spanCount > 1 ? 's' : ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setFilters((current) => ({ ...current, page: Math.max(0, current.page - 1) }))}
                  disabled={filters.page === 0 || listLoading}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50 hover:bg-muted"
                >
                  Page précédente
                </button>
                <p className="text-sm text-muted-foreground">
                  Page {currentPage} sur {totalPages}
                </p>
                <button
                  type="button"
                  onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}
                  disabled={currentPage >= totalPages || listLoading}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50 hover:bg-muted"
                >
                  Page suivante
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Chargement des sessions…</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface AgentTraceSessionDetailProps {
  summary: AgentTraceSessionSummary;
  onBack(): void;
  onBackToSessions(): void;
}

function AgentTraceSessionDetail({ summary, onBack, onBackToSessions }: AgentTraceSessionDetailProps) {
  const selection = useMemo<AgentTraceSelection>(
    () => ({
      source: summary.source,
      sessionId: summary.sessionId,
    }),
    [summary.sessionId, summary.source],
  );
  const { collectionStatus, session, sessionLoading, error, sessionError } = useAgentTrace(selection);
  const nonBlockingAlerts = [...new Set([
    collectionStatus?.errorMessage ?? null,
    sessionError ? null : error?.message ?? null,
  ].filter((message): message is string => message !== null))];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBackToSessions}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          Retour aux sessions
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          Retour aux traces
        </button>
      </div>

      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-base text-foreground">Session sélectionnée</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Badge>{summary.source}</Badge>
            <Badge>{summary.sessionId}</Badge>
            <Badge>{summary.spanCount} span{summary.spanCount > 1 ? 's' : ''}</Badge>
            {collectionStatus?.listening && <Badge>Écoute</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {nonBlockingAlerts.map((message) => (
            <p
              key={message}
              role="alert"
              className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300"
            >
              {message}
            </p>
          ))}
          {sessionLoading ? (
            <p className="text-sm text-muted-foreground">Chargement de la session…</p>
          ) : sessionError ? (
            <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300">
              {sessionError.message}
            </p>
          ) : session?.availability === 'not-collected' ? (
            <p className="text-sm text-muted-foreground">
              Aucune trace n&apos;a encore été collectée pour cette session.
            </p>
          ) : session ? (
            <>
              {session.availability === 'partial' && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  Certaines spans ont été stockées sans toute leur chaîne parente, la trace est donc partielle.
                </p>
              )}
              <AgentTraceTree session={session} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Aucune trace stockée n&apos;est disponible pour cette session.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LabeledField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-2 text-sm text-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

function normalizeDateFilter(value: string): string | null {
  return value === '' ? null : value;
}

function getDateRangeErrorMessage(from: string | null, to: string | null): string | null {
  if (from && to && from > to) {
    return 'La date de début doit être antérieure ou égale à la date de fin.';
  }

  return null;
}

function updateFilters(
  setFilters: Dispatch<SetStateAction<AgentTraceSessionListFilters>>,
  patch: Partial<AgentTraceSessionListFilters>,
): void {
  setFilters((current) => ({ ...current, ...patch, page: 0 }));
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
