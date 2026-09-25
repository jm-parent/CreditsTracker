import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AgentTraceSelection,
  AgentTraceSession,
  AgentTraceSessionListFilters,
  AgentTraceSessionListPage,
  AgentTraceSessionSummary,
} from '../../shared/types';
import {
  AGENT_TRACE_SESSION_PAGE_SIZE,
  MAX_AGENT_TRACE_SESSION_SEARCH_LENGTH,
} from '../../shared/types';
import { makeAgentTraceSpan } from '../../test-utils/agent-trace-fixtures';
import { createWindowApi } from '../test-utils/windowApi';
import { AgentTraceSessionsView } from './AgentTraceSessionsView';

function makeSummary(overrides: Partial<AgentTraceSessionSummary> = {}): AgentTraceSessionSummary {
  return {
    source: 'vscode',
    sessionId: 'vscode:session-1',
    spanCount: 3,
    ...overrides,
  };
}

function makePage(
  items: AgentTraceSessionSummary[],
  overrides: Partial<AgentTraceSessionListPage> = {},
): AgentTraceSessionListPage {
  return {
    items,
    total: items.length,
    page: 0,
    pageSize: AGENT_TRACE_SESSION_PAGE_SIZE,
    ...overrides,
  };
}

function makeSession(selection: AgentTraceSelection): AgentTraceSession {
  return {
    source: selection.source,
    sessionId: selection.sessionId,
    availability: 'available',
    spans: [
      makeAgentTraceSpan({
        source: selection.source,
        sessionId: selection.sessionId,
        traceId: `${selection.sessionId}-trace`,
        spanId: `${selection.sessionId}-root`,
        category: 'tool',
        name: 'execute_tool readFile',
        toolName: 'readFile',
        skillName: 'spec-review',
        model: 'gpt-6',
      }),
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

describe('AgentTraceSessionsView', () => {
  beforeEach(() => {
    window.api = createWindowApi();
  });

  it('renders the filter controls and each summary row with source, session id, and total span count', async () => {
    window.api.listAgentTraceSessions = vi.fn().mockResolvedValue(
      makePage([
        makeSummary({ source: 'copilot-cli', sessionId: 'cli-session-9', spanCount: 12 }),
        makeSummary({ source: 'vscode', sessionId: 'vscode:conversation-4', spanCount: 4 }),
        makeSummary({ source: 'vscode', sessionId: 'vscode:conversation-1', spanCount: 2 }),
      ]),
    );

    render(<AgentTraceSessionsView onBack={vi.fn()} />);

    const search = await screen.findByLabelText('Recherche');
    expect(search).toHaveAttribute('maxlength', String(MAX_AGENT_TRACE_SESSION_SEARCH_LENGTH));
    expect(screen.getByText('Rechercher par ID, outil, skill ou modèle.')).toBeInTheDocument();
    expect(screen.getByLabelText('Source')).toBeInTheDocument();
    expect(screen.getByLabelText('Du')).toBeInTheDocument();
    expect(screen.getByLabelText('Au')).toBeInTheDocument();
    expect(screen.getByLabelText('Catégorie')).toBeInTheDocument();
    expect(screen.getByLabelText('Statut')).toBeInTheDocument();

    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('copilot-cli')).toBeInTheDocument();
    expect(within(rows[0]).getByRole('button', { name: 'Ouvrir la session cli-session-9' })).toBeInTheDocument();
    expect(within(rows[0]).getByText('12 spans')).toBeInTheDocument();

    expect(within(rows[1]).getByText('vscode')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('button', { name: 'Ouvrir la session vscode:conversation-4' })).toBeInTheDocument();
    expect(within(rows[1]).getByText('4 spans')).toBeInTheDocument();
  });

  it('updates the list filters for search, source, dates, category, and status and resets pagination to page zero', async () => {
    const user = userEvent.setup();
    const pageZero = makePage(
      Array.from({ length: AGENT_TRACE_SESSION_PAGE_SIZE }, (_, index) =>
        makeSummary({ sessionId: `vscode:session-${index}` }),
      ),
      { total: 55, page: 0 },
    );
    const pageOne = makePage([makeSummary({ sessionId: 'vscode:session-50' })], { total: 55, page: 1 });

    window.api.listAgentTraceSessions = vi
      .fn()
      .mockResolvedValueOnce(pageZero)
      .mockResolvedValueOnce(pageOne)
      .mockResolvedValue(pageZero);

    render(<AgentTraceSessionsView onBack={vi.fn()} />);

    expect(await screen.findByText('Page 1 sur 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Page suivante' }));

    await waitFor(() => {
      expect(window.api.listAgentTraceSessions).toHaveBeenLastCalledWith({
        query: '',
        source: null,
        from: null,
        to: null,
        category: null,
        status: null,
        page: 1,
      } satisfies AgentTraceSessionListFilters);
    });

    await user.type(screen.getByLabelText('Recherche'), 'readFile gpt-6');
    await user.selectOptions(screen.getByLabelText('Source'), 'copilot-cli');
    await user.type(screen.getByLabelText('Du'), '2026-09-01');
    await user.type(screen.getByLabelText('Au'), '2026-09-30');
    await user.selectOptions(screen.getByLabelText('Catégorie'), 'tool');
    await user.selectOptions(screen.getByLabelText('Statut'), 'error');

    await waitFor(() => {
      expect(window.api.listAgentTraceSessions).toHaveBeenLastCalledWith({
        query: 'readFile gpt-6',
        source: 'copilot-cli',
        from: '2026-09-01',
        to: '2026-09-30',
        category: 'tool',
        status: 'error',
        page: 0,
      } satisfies AgentTraceSessionListFilters);
    });

    expect(screen.getByText('Page 1 sur 2')).toBeInTheDocument();
  });

  it('preserves the current filters when changing page and requests page-sized results', async () => {
    const user = userEvent.setup();
    const filteredPageZero = makePage(
      Array.from({ length: AGENT_TRACE_SESSION_PAGE_SIZE }, (_, index) =>
        makeSummary({
          source: 'copilot-cli',
          sessionId: `cli-session-${index}`,
        }),
      ),
      { total: 101, page: 0 },
    );
    const filteredPageOne = makePage(
      Array.from({ length: AGENT_TRACE_SESSION_PAGE_SIZE }, (_, index) =>
        makeSummary({
          source: 'copilot-cli',
          sessionId: `cli-session-${50 + index}`,
        }),
      ),
      { total: 101, page: 1 },
    );

    window.api.listAgentTraceSessions = vi
      .fn()
      .mockResolvedValueOnce(filteredPageZero)
      .mockResolvedValueOnce(filteredPageZero)
      .mockResolvedValueOnce(filteredPageOne);

    render(<AgentTraceSessionsView onBack={vi.fn()} />);

    await screen.findByText('Page 1 sur 3');
    await user.selectOptions(screen.getByLabelText('Source'), 'copilot-cli');
    await waitFor(() => {
      expect(window.api.listAgentTraceSessions).toHaveBeenLastCalledWith({
        query: '',
        source: 'copilot-cli',
        from: null,
        to: null,
        category: null,
        status: null,
        page: 0,
      } satisfies AgentTraceSessionListFilters);
    });

    expect(screen.getAllByRole('row').slice(1)).toHaveLength(AGENT_TRACE_SESSION_PAGE_SIZE);

    await user.click(screen.getByRole('button', { name: 'Page suivante' }));

    await waitFor(() => {
      expect(window.api.listAgentTraceSessions).toHaveBeenLastCalledWith({
        query: '',
        source: 'copilot-cli',
        from: null,
        to: null,
        category: null,
        status: null,
        page: 1,
      } satisfies AgentTraceSessionListFilters);
    });
    expect(await screen.findByText('Page 2 sur 3')).toBeInTheDocument();
  });

  it('shows a dedicated empty state when no stored sessions exist yet', async () => {
    window.api.listAgentTraceSessions = vi.fn().mockResolvedValue(makePage([], { total: 0 }));

    render(<AgentTraceSessionsView onBack={vi.fn()} />);

    expect(await screen.findByText('Aucune session de trace enregistrée pour le moment.')).toBeInTheDocument();
    expect(screen.queryByText('Aucune session ne correspond aux filtres actuels.')).not.toBeInTheDocument();
  });

  it('shows a dedicated no-results state when filters exclude every session', async () => {
    const user = userEvent.setup();
    window.api.listAgentTraceSessions = vi
      .fn()
      .mockResolvedValueOnce(makePage([makeSummary({ sessionId: 'vscode:session-1' })]))
      .mockResolvedValueOnce(makePage([], { total: 0 }));

    render(<AgentTraceSessionsView onBack={vi.fn()} />);

    await screen.findByRole('button', { name: 'Ouvrir la session vscode:session-1' });
    fireEvent.change(screen.getByLabelText('Recherche'), { target: { value: 'missing-session' } });

    expect(await screen.findByText('Aucune session ne correspond aux filtres actuels.')).toBeInTheDocument();
    expect(screen.queryByText('Aucune session de trace enregistrée pour le moment.')).not.toBeInTheDocument();
  });

  it('shows a loading state while the session list is loading', async () => {
    const request = deferred<AgentTraceSessionListPage>();
    window.api.listAgentTraceSessions = vi.fn().mockReturnValue(request.promise);

    render(<AgentTraceSessionsView onBack={vi.fn()} />);

    expect(await screen.findByText('Chargement des sessions…')).toBeInTheDocument();

    request.resolve(makePage([makeSummary()]));
    expect(await screen.findByRole('button', { name: 'Ouvrir la session vscode:session-1' })).toBeInTheDocument();
  });

  it('shows a list error and retries the current request', async () => {
    const user = userEvent.setup();
    window.api.listAgentTraceSessions = vi
      .fn()
      .mockRejectedValueOnce(new Error('list lookup failed'))
      .mockResolvedValueOnce(makePage([makeSummary({ sessionId: 'vscode:session-2' })]));

    render(<AgentTraceSessionsView onBack={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('list lookup failed');

    await user.click(screen.getByRole('button', { name: 'Réessayer' }));

    expect(await screen.findByRole('button', { name: 'Ouvrir la session vscode:session-2' })).toBeInTheDocument();
    expect(window.api.listAgentTraceSessions).toHaveBeenCalledTimes(2);
  });

  it('keeps the newest list response when older requests resolve later', async () => {
    const user = userEvent.setup();
    const firstRequest = deferred<AgentTraceSessionListPage>();
    const secondRequest = deferred<AgentTraceSessionListPage>();

    window.api.listAgentTraceSessions = vi
      .fn()
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);

    render(<AgentTraceSessionsView onBack={vi.fn()} />);

    expect(await screen.findByText('Chargement des sessions…')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Recherche'), { target: { value: 'gpt-6' } });

    secondRequest.resolve(makePage([makeSummary({ sessionId: 'vscode:newest' })]));
    expect(await screen.findByRole('button', { name: 'Ouvrir la session vscode:newest' })).toBeInTheDocument();

    firstRequest.resolve(makePage([makeSummary({ sessionId: 'vscode:stale' })]));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Ouvrir la session vscode:stale' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Ouvrir la session vscode:newest' })).toBeInTheDocument();
  });

  it('loads session details, returns to the session list with filters and page preserved, and lets the top-level back action fire', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const pageZero = makePage(
      Array.from({ length: AGENT_TRACE_SESSION_PAGE_SIZE }, (_, index) =>
        makeSummary({
          source: 'copilot-cli',
          sessionId: `cli-session-${index}`,
        }),
      ),
      { total: 51, page: 0 },
    );
    const detailSummary = makeSummary({ source: 'copilot-cli', sessionId: 'cli-session-50', spanCount: 8 });
    const pageOne = makePage([detailSummary], { total: 51, page: 1 });

    window.api.listAgentTraceSessions = vi
      .fn()
      .mockResolvedValueOnce(pageZero)
      .mockResolvedValueOnce(pageZero)
      .mockResolvedValueOnce(pageOne)
      .mockResolvedValue(pageOne);
    window.api.getAgentTraceSession = vi
      .fn()
      .mockImplementation((selection: AgentTraceSelection) => Promise.resolve(makeSession(selection)));

    render(<AgentTraceSessionsView onBack={onBack} />);

    await screen.findByText('Page 1 sur 2');
    await user.selectOptions(screen.getByLabelText('Source'), 'copilot-cli');
    await screen.findByText('Page 1 sur 2');

    await user.click(screen.getByRole('button', { name: 'Page suivante' }));
    expect(await screen.findByText('Page 2 sur 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ouvrir la session cli-session-50' }));

    await waitFor(() => {
      expect(window.api.getAgentTraceSession).toHaveBeenCalledWith({
        source: 'copilot-cli',
        sessionId: 'cli-session-50',
      } satisfies AgentTraceSelection);
    });
    expect(await screen.findByText('Agent trace spans')).toBeInTheDocument();

    const backToSessions = screen.getByRole('button', { name: 'Retour aux sessions' });
    backToSessions.focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByLabelText('Source')).toHaveValue('copilot-cli');
    expect(screen.getByText('Page 2 sur 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ouvrir la session cli-session-50' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retour aux traces' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows a session loading error after selecting a session row', async () => {
    const user = userEvent.setup();
    window.api.listAgentTraceSessions = vi.fn().mockResolvedValue(makePage([makeSummary({ sessionId: 'cli-session-4' })]));
    window.api.getAgentTraceSession = vi.fn().mockRejectedValue(new Error('session lookup failed'));

    render(<AgentTraceSessionsView onBack={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Ouvrir la session cli-session-4' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('session lookup failed');
    expect(screen.queryByText("Aucune trace stockée n'est disponible pour cette session.")).not.toBeInTheDocument();
  });

  it('shows when no trace has been collected for the selected stored session', async () => {
    const user = userEvent.setup();
    window.api.listAgentTraceSessions = vi.fn().mockResolvedValue(
      makePage([makeSummary({ source: 'copilot-cli', sessionId: 'cli-session-8' })]),
    );
    window.api.getAgentTraceSession = vi.fn().mockResolvedValue({
      source: 'copilot-cli',
      sessionId: 'cli-session-8',
      availability: 'not-collected',
      spans: [],
    } satisfies AgentTraceSession);

    render(<AgentTraceSessionsView onBack={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Ouvrir la session cli-session-8' }));

    expect(await screen.findByText("Aucune trace n'a encore été collectée pour cette session.")).toBeInTheDocument();
    expect(screen.queryByText('Agent trace spans')).not.toBeInTheDocument();
  });
});
