import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgentTraceCollectionStatus, AgentTraceSession } from '../../shared/types';
import { makeAgentTraceSpan } from '../../test-utils/agent-trace-fixtures';
import { createWindowApi } from '../test-utils/windowApi';
import { ProjectTraceSubview } from './ProjectTraceSubview';

const listeningStatus: AgentTraceCollectionStatus = {
  enabled: true,
  listening: true,
  endpoint: 'http://127.0.0.1:4318',
  errorMessage: null,
};

const availableSession: AgentTraceSession = {
  source: 'vscode',
  sessionId: 'vscode:conversation-1',
  availability: 'available',
  spans: [
    makeAgentTraceSpan({
      sessionId: 'vscode:conversation-1',
      traceId: 'trace-1',
      spanId: 'root-1',
      category: 'tool',
      name: 'execute_tool readFile',
      toolName: 'readFile',
      argumentsJson: '{"path":"README.md"}',
      resultText: 'sanitized result',
    }),
  ],
};

beforeEach(() => {
  window.api = createWindowApi({
    getAgentTraceCollectionStatus: vi.fn().mockResolvedValue(listeningStatus),
    getAgentTraceSession: vi.fn().mockResolvedValue(availableSession),
  });
});

describe('ProjectTraceSubview', () => {
  it('shows the project context, renders the trace tree, and returns to the project detail', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();

    render(
      <ProjectTraceSubview
        project="org/repo-a"
        selection={{ source: 'vscode', sessionId: 'vscode:conversation-1' }}
        onBack={onBack}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Retour au projet' })).toBeInTheDocument();
    expect(screen.getByText('org/repo-a')).toBeInTheDocument();
    expect(screen.getByText('vscode:conversation-1')).toBeInTheDocument();
    expect(screen.getByText('Spans de trace agent')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /execute_tool readFile : détails/i }));
    expect(screen.getByText('sanitized result')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retour au projet' }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows a loading state while the selected trace is still loading', async () => {
    let resolveSession: (value: AgentTraceSession) => void = () => {};
    window.api.getAgentTraceSession = vi.fn().mockImplementation(
      () =>
        new Promise<AgentTraceSession>((resolve) => {
          resolveSession = resolve;
        }),
    );

    render(
      <ProjectTraceSubview
        project="org/repo-a"
        selection={{ source: 'vscode', sessionId: 'vscode:conversation-1' }}
        onBack={vi.fn()}
      />,
    );

    expect(await screen.findByText('Loading selected trace…')).toBeInTheDocument();

    resolveSession(availableSession);
    expect(await screen.findByText('Spans de trace agent')).toBeInTheDocument();
  });

  it('shows an error reported while loading the selected trace', async () => {
    window.api.getAgentTraceSession = vi.fn().mockRejectedValue(new Error('trace lookup failed'));

    render(
      <ProjectTraceSubview
        project="org/repo-a"
        selection={{ source: 'vscode', sessionId: 'vscode:conversation-1' }}
        onBack={vi.fn()}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('trace lookup failed');
  });

  it('shows a partial trace warning and tree when the trace is incomplete', async () => {
    window.api.getAgentTraceSession = vi.fn().mockResolvedValue({
      ...availableSession,
      availability: 'partial',
    } satisfies AgentTraceSession);

    render(
      <ProjectTraceSubview
        project="org/repo-a"
        selection={{ source: 'vscode', sessionId: 'vscode:conversation-1' }}
        onBack={vi.fn()}
      />,
    );

    expect(await screen.findByText('Trace partielle')).toBeInTheDocument();
    expect(screen.getByText(/Some spans were stored without a complete parent chain/i)).toBeInTheDocument();
  });

  it('shows when no trace has been collected for the selected conversation', async () => {
    window.api.getAgentTraceSession = vi.fn().mockResolvedValue({
      source: 'copilot-cli',
      sessionId: 'cli-session-1',
      availability: 'not-collected',
      spans: [],
    } satisfies AgentTraceSession);

    render(
      <ProjectTraceSubview
        project="org/repo-a"
        selection={{ source: 'copilot-cli', sessionId: 'cli-session-1' }}
        onBack={vi.fn()}
      />,
    );

    expect(await screen.findByText('No trace has been collected yet for this conversation.')).toBeInTheDocument();
    await waitFor(() => {
      expect(window.api.getAgentTraceSession).toHaveBeenCalledWith({
        source: 'copilot-cli',
        sessionId: 'cli-session-1',
      });
    });
  });
});
