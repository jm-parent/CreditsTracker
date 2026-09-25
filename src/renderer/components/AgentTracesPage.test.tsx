import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgentTraceCollectionStatus } from '../../shared/types';
import { createWindowApi } from '../test-utils/windowApi';
import * as useAgentTraceModule from '../hooks/useAgentTrace';
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
  vi.restoreAllMocks();
});

describe('AgentTracesPage', () => {
  it('shows the telemetry panels and only real storage information', async () => {
    render(<AgentTracesPage />);

    expect(
      await screen.findByRole('heading', { name: 'Traces agents & Télémétrie locale' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent?.includes(
            'L’activation de captureContent peut faire transiter les prompts et réponses localement avant filtrage',
          ) ?? false,
        { selector: 'p' },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Volume actuel')).toBeInTheDocument();
    expect(screen.getByText('Politique de rétention')).toBeInTheDocument();
    expect(screen.getByText('Dernière capture')).toBeInTheDocument();
    expect(screen.getByText('30 jours')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Indisponible')).toBeInTheDocument();
  });

  it('does not show conversation details in the global trace page', async () => {
    render(<AgentTracesPage />);

    expect(
      await screen.findByRole('heading', { name: 'Traces agents & Télémétrie locale' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Selected conversation' })).not.toBeInTheDocument();
  });

  it('shows loading explicitly before the collection status resolves', () => {
    vi.spyOn(useAgentTraceModule, 'useAgentTrace').mockReturnValue({
      collectionStatus: null,
      session: null,
      statusLoading: true,
      sessionLoading: false,
      error: null,
      setCollectionEnabled: vi.fn().mockResolvedValue(undefined),
      clearTraceData: vi.fn().mockResolvedValue(undefined),
    });

    render(<AgentTracesPage />);

    expect(screen.getByRole('heading', { name: 'Traces agents & Télémétrie locale' })).toBeInTheDocument();
    expect(screen.getByText(/Chargement de l’état de collecte/i)).toBeInTheDocument();
    expect(screen.queryByText(/Collecte inactive/i)).not.toBeInTheDocument();
  });

  it('shows the collection status unavailable after an error without claiming disabled collection', () => {
    vi.spyOn(useAgentTraceModule, 'useAgentTrace').mockReturnValue({
      collectionStatus: null,
      session: null,
      statusLoading: false,
      sessionLoading: false,
      error: new Error('Bridge connection failed'),
      setCollectionEnabled: vi.fn().mockResolvedValue(undefined),
      clearTraceData: vi.fn().mockResolvedValue(undefined),
    });

    render(<AgentTracesPage />);

    expect(screen.getByText('État de collecte indisponible')).toBeInTheDocument();
    expect(screen.queryByText(/Collecte inactive/i)).not.toBeInTheDocument();
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
    expect(screen.getByText('Écoute active')).toBeInTheDocument();
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
    expect(await screen.findByText('Écoute active')).toBeInTheDocument();
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
    expect(screen.getAllByText('http://127.0.0.1:4318').length).toBeGreaterThan(0);
  });

  it('does not delete stored traces when the confirmation is canceled', async () => {
    const user = userEvent.setup();
    window.confirm = vi.fn().mockReturnValue(false);

    render(<AgentTracesPage />);

    await user.click(
      await screen.findByRole('button', { name: 'Supprimer les traces stockées' }),
    );

    expect(window.confirm).toHaveBeenCalledWith(
      'Supprimer toutes les traces agent stockées ? Cette action est irréversible.',
    );
    expect(window.api.clearAgentTraceData).not.toHaveBeenCalled();
  });

  it('deletes stored traces once when the confirmation is accepted', async () => {
    const user = userEvent.setup();
    window.confirm = vi.fn().mockReturnValue(true);

    render(<AgentTracesPage />);

    await user.click(
      await screen.findByRole('button', { name: 'Supprimer les traces stockées' }),
    );

    expect(window.confirm).toHaveBeenCalledWith(
      'Supprimer toutes les traces agent stockées ? Cette action est irréversible.',
    );
    expect(window.api.clearAgentTraceData).toHaveBeenCalledTimes(1);
  });
});
