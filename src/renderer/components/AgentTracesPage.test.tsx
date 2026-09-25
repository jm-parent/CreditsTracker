import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgentTraceCollectionStatus, AgentTraceSession } from '../../shared/types';
import { makeAgentTraceSpan } from '../../test-utils/agent-trace-fixtures';
import * as useAgentTraceModule from '../hooks/useAgentTrace';
import { createWindowApi } from '../test-utils/windowApi';
import { AgentTracesPage } from './AgentTracesPage';

const disabledStatus: AgentTraceCollectionStatus = {
  enabled: false,
  listening: false,
  endpoint: null,
  errorMessage: null,
};

const listeningStatus: AgentTraceCollectionStatus = {
  enabled: true,
  listening: true,
  endpoint: 'http://127.0.0.1:4318',
  errorMessage: null,
};

const errorStatus: AgentTraceCollectionStatus = {
  enabled: true,
  listening: false,
  endpoint: 'http://127.0.0.1:4318',
  errorMessage: 'Port 4318 is already in use.',
};

const partialSession: AgentTraceSession = {
  source: 'vscode',
  sessionId: 'vscode:conversation-1',
  availability: 'partial',
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
      contentState: 'stored',
    }),
  ],
};

const notCollectedSession: AgentTraceSession = {
  source: 'vscode',
  sessionId: 'vscode:conversation-1',
  availability: 'not-collected',
  spans: [],
};

beforeEach(() => {
  window.api = createWindowApi({
    getAgentTraceCollectionStatus: vi.fn().mockResolvedValue(disabledStatus),
    getAgentTraceSession: vi.fn().mockResolvedValue(notCollectedSession),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AgentTracesPage', () => {
  it('shows the opt-in state, loopback-only instructions, capture warning, and 30-day retention notice', async () => {
    render(<AgentTracesPage selection={null} />);

    expect(await screen.findByRole('heading', { name: 'Traces agents' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Activer la collecte locale des traces agent' })).not.toBeChecked();
    expect(screen.getByText('http://127.0.0.1:4318')).toBeInTheDocument();
    expect(screen.getByText(/Loopback only/i)).toBeInTheDocument();
    expect(screen.getByText(/captureContent can make prompts\/responses transit locally before filtering/i)).toBeInTheDocument();
    expect(screen.getByText(/github\.copilot\.chat\.otel\.enabled/)).toBeInTheDocument();
    expect(screen.getByText(/"github\.copilot\.chat\.otel\.protocol": "http\/protobuf"/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'VS Code User settings (settings.json)' })).toBeInTheDocument();
    expect(screen.getByText(/VS Code\s+ignores these settings in workspace settings/)).toBeInTheDocument();
    expect(screen.getByText(/OTEL_EXPORTER_OTLP_ENDPOINT=http:\/\/127\.0\.0\.1:4318/)).toBeInTheDocument();
    expect(screen.getByText(/OTEL_EXPORTER_OTLP_PROTOCOL=http\/protobuf/)).toBeInTheDocument();
    expect(screen.getByText(/Stored sanitized agent traces are deleted after 30 days\./i)).toBeInTheDocument();
  });

  it('shows an exporter wire-format rejection reported by the receiver', async () => {
    window.api.getAgentTraceCollectionStatus = vi.fn().mockResolvedValue({
      ...listeningStatus,
      errorMessage:
        'OTLP export rejected (HTTP 415): content type application/json is not supported; '
        + 'set the exporter protocol to http/protobuf.',
    } satisfies AgentTraceCollectionStatus);

    render(<AgentTracesPage selection={null} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'set the exporter protocol to http/protobuf',
    );
    expect(screen.getByText('Listening for local OTLP traces.')).toBeInTheDocument();
  });

  it('enables collection on demand, shows the listening endpoint, and never changes settings automatically', async () => {
    window.api.setAgentTraceCollectionEnabled = vi.fn().mockResolvedValue(listeningStatus);
    const user = userEvent.setup();

    render(<AgentTracesPage selection={null} />);

    const toggle = await screen.findByRole('checkbox', {
      name: 'Activer la collecte locale des traces agent',
    });
    await user.click(toggle);

    expect(window.api.setAgentTraceCollectionEnabled).toHaveBeenCalledWith(true);
    expect(await screen.findByText('Listening for local OTLP traces.')).toBeInTheDocument();
    expect(screen.getAllByText('http://127.0.0.1:4318').length).toBeGreaterThan(0);
  });

  it('shows the receiver error when the endpoint cannot listen', async () => {
    window.api.getAgentTraceCollectionStatus = vi.fn().mockResolvedValue(errorStatus);

    render(<AgentTracesPage selection={null} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Port 4318 is already in use.');
    expect(screen.getByText('http://127.0.0.1:4318')).toBeInTheDocument();
  });

  it('prefers a fresh hook error over an older collection status warning', async () => {
    vi.spyOn(useAgentTraceModule, 'useAgentTrace').mockReturnValue({
      collectionStatus: {
        enabled: true,
        listening: true,
        endpoint: 'http://127.0.0.1:4318',
        errorMessage: 'Old partial coverage warning.',
      },
      session: null,
      statusLoading: false,
      sessionLoading: false,
      error: new Error('Newer clear or session failure.'),
      setCollectionEnabled: vi.fn().mockResolvedValue(undefined),
      clearTraceData: vi.fn().mockResolvedValue(undefined),
    });

    render(<AgentTracesPage selection={{ source: 'vscode', sessionId: 'vscode:conversation-1' }} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Newer clear or session failure.');
    expect(screen.queryByText('Old partial coverage warning.')).not.toBeInTheDocument();
  });

  it('renders the selected trace tree, explains partial traces, and confirms manual deletion before clearing', async () => {
    window.api.getAgentTraceCollectionStatus = vi.fn().mockResolvedValue(listeningStatus);
    window.api.getAgentTraceSession = vi
      .fn()
      .mockResolvedValueOnce(partialSession)
      .mockResolvedValueOnce(notCollectedSession);
    window.api.clearAgentTraceData = vi.fn().mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();

    render(<AgentTracesPage selection={{ source: 'vscode', sessionId: 'vscode:conversation-1' }} />);

    expect(await screen.findByText('Partial trace')).toBeInTheDocument();
    expect(screen.getByText(/Some spans were stored without a complete parent chain/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /execute_tool readFile/i }));
    expect(screen.getByText('sanitized result')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Supprimer les traces stockées' }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(window.api.clearAgentTraceData).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/No trace has been collected yet for this conversation\./i)).toBeInTheDocument();
  });

  it('shows the not-collected state for the selected conversation', async () => {
    render(<AgentTracesPage selection={{ source: 'vscode', sessionId: 'vscode:conversation-1' }} />);

    expect(await screen.findByText(/No trace has been collected yet for this conversation\./i)).toBeInTheDocument();
    await waitFor(() => {
      expect(window.api.getAgentTraceSession).toHaveBeenCalledWith({
        source: 'vscode',
        sessionId: 'vscode:conversation-1',
      });
    });
  });
});
