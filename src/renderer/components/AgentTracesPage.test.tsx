import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgentTraceCollectionStatus } from '../../shared/types';
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

beforeEach(() => {
  window.api = createWindowApi({
    getAgentTraceCollectionStatus: vi.fn().mockResolvedValue(disabledStatus),
  });
});

describe('AgentTracesPage', () => {
  it('does not show conversation details in the global trace page', async () => {
    render(<AgentTracesPage />);

    expect(await screen.findByRole('heading', { name: 'Traces agents' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Selected conversation' })).not.toBeInTheDocument();
  });

  it('shows an exporter wire-format rejection reported by the receiver', async () => {
    window.api.getAgentTraceCollectionStatus = vi.fn().mockResolvedValue({
      ...listeningStatus,
      errorMessage:
        'OTLP export rejected (HTTP 415): content type application/json is not supported; '
        + 'set the exporter protocol to http/protobuf.',
    } satisfies AgentTraceCollectionStatus);

    render(<AgentTracesPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'set the exporter protocol to http/protobuf',
    );
    expect(screen.getByText('Listening for local OTLP traces.')).toBeInTheDocument();
  });

  it('enables collection on demand, shows the listening endpoint, and never changes settings automatically', async () => {
    window.api.setAgentTraceCollectionEnabled = vi.fn().mockResolvedValue(listeningStatus);
    const user = userEvent.setup();

    render(<AgentTracesPage />);

    const toggle = await screen.findByRole('checkbox', {
      name: 'Activer la collecte locale des traces agent',
    });
    await user.click(toggle);

    expect(window.api.setAgentTraceCollectionEnabled).toHaveBeenCalledWith(true);
    expect(await screen.findByText('Listening for local OTLP traces.')).toBeInTheDocument();
    expect(screen.getAllByText('http://127.0.0.1:4318').length).toBeGreaterThan(0);
  });

  it('shows the receiver error when the endpoint cannot listen', async () => {
    window.api.getAgentTraceCollectionStatus = vi.fn().mockResolvedValue({
      enabled: true,
      listening: false,
      endpoint: 'http://127.0.0.1:4318',
      errorMessage: 'Port 4318 is already in use.',
    } satisfies AgentTraceCollectionStatus);

    render(<AgentTracesPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Port 4318 is already in use.');
    expect(screen.getByText('http://127.0.0.1:4318')).toBeInTheDocument();
  });
});
