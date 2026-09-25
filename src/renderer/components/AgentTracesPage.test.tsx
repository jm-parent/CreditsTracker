import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

let clipboardDescriptor: PropertyDescriptor | undefined;

function mockClipboardWriteText(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

beforeEach(() => {
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  window.api = createWindowApi({
    getAgentTraceCollectionStatus: vi.fn().mockResolvedValue(disabledStatus),
  });
  vi.restoreAllMocks();
});

afterEach(() => {
  if (clipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

describe('AgentTracesPage', () => {
  it('shows the telemetry panels and only real storage information', async () => {
    render(<AgentTracesPage />);

    expect(
      await screen.findByText('Traces agents & Télémétrie locale'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Collection is disabled until you opt in from this page.'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Select a conversation from a project detail page to inspect its trace.'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent?.includes(
            'L’activation de captureContent peut faire transiter les prompts et réponses localement avant filtrage',
          ) ?? false,
        { selector: 'p' },
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Configuration des exporteurs locaux' })).toBeInTheDocument();
    expect(screen.getByText('Volume actuel')).toBeInTheDocument();
    expect(screen.getByText('Politique de rétention')).toBeInTheDocument();
    expect(screen.getByText('Dernière capture')).toBeInTheDocument();
    expect(screen.getByText('30 jours')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getAllByText('Indisponible')).toHaveLength(2);
  });

  it('does not show conversation details in the global trace page', async () => {
    render(<AgentTracesPage />);

    expect(
      await screen.findByText('Traces agents & Télémétrie locale'),
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

    expect(screen.getByText('Traces agents & Télémétrie locale')).toBeInTheDocument();
    expect(screen.getByText(/Chargement de l’état de collecte/i)).toBeInTheDocument();
    expect(screen.queryByText(/Collecte inactive/i)).not.toBeInTheDocument();
  });

  it('shows the disabled and waiting collection states without guessing', () => {
    const useAgentTraceSpy = vi.spyOn(useAgentTraceModule, 'useAgentTrace');
    useAgentTraceSpy.mockReturnValue({
      collectionStatus: disabledStatus,
      session: null,
      statusLoading: false,
      sessionLoading: false,
      error: null,
      setCollectionEnabled: vi.fn().mockResolvedValue(undefined),
      clearTraceData: vi.fn().mockResolvedValue(undefined),
    });

    const { rerender } = render(<AgentTracesPage />);

    expect(screen.getByText('Collecte désactivée')).toBeInTheDocument();
    expect(screen.getByText('Désactivée')).toBeInTheDocument();

    useAgentTraceSpy.mockReturnValue({
      collectionStatus: {
        ...listeningStatus,
        listening: false,
      },
      session: null,
      statusLoading: false,
      sessionLoading: false,
      error: null,
      setCollectionEnabled: vi.fn().mockResolvedValue(undefined),
      clearTraceData: vi.fn().mockResolvedValue(undefined),
    });

    rerender(<AgentTracesPage />);

    expect(screen.getByText('Collecte activée — en attente du récepteur local')).toBeInTheDocument();
    expect(screen.getByText('En attente')).toBeInTheDocument();
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

  it('defaults to VS Code, switches exporter snippets, and supports keyboard navigation', async () => {
    const user = userEvent.setup();

    render(<AgentTracesPage />);

    const vscodeTab = screen.getByRole('tab', { name: /VS Code \(settings\.json\)/i });
    const cliTab = screen.getByRole('tab', { name: /Copilot CLI \(variables d’env\)/i });

    expect(vscodeTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Paramètres utilisateur VS Code' })).toBeInTheDocument();
    expect(screen.getByText(/Ajoutez le snippet ci-dessous dans vos User settings/i)).toBeInTheDocument();
    expect(screen.getByText(/github\.copilot\.chat\.otel\.enabled/)).toBeInTheDocument();
    expect(screen.queryByText(/COPILOT_OTEL_ENABLED=true/)).not.toBeInTheDocument();

    await user.click(cliTab);

    expect(cliTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Environnement Copilot CLI' })).toBeInTheDocument();
    expect(screen.getByText(/Définissez ces variables d’environnement/i)).toBeInTheDocument();
    expect(screen.queryByText(/Ajoutez le snippet ci-dessous dans vos User settings/i)).not.toBeInTheDocument();
    expect(screen.getByText(/COPILOT_OTEL_ENABLED=true/)).toBeInTheDocument();
    expect(screen.queryByText(/github\.copilot\.chat\.otel\.enabled/)).not.toBeInTheDocument();

    vscodeTab.focus();
    await user.keyboard('{ArrowRight}');

    expect(cliTab).toHaveFocus();
    expect(cliTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/COPILOT_OTEL_ENABLED=true/)).toBeInTheDocument();

    await user.keyboard('{ArrowLeft}');

    expect(vscodeTab).toHaveFocus();
    expect(vscodeTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/github\.copilot\.chat\.otel\.enabled/)).toBeInTheDocument();

    await user.keyboard('{Home}');

    expect(vscodeTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/github\.copilot\.chat\.otel\.enabled/)).toBeInTheDocument();

    await user.keyboard('{End}');

    expect(cliTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/COPILOT_OTEL_ENABLED=true/)).toBeInTheDocument();
  });

  it('copies the active snippet and endpoint, and reports copy failures next to the failing control', async () => {
    const user = userEvent.setup();
    const writeText = mockClipboardWriteText();
    render(<AgentTracesPage />);

    const endpointCopyButton = await screen.findByRole('button', {
      name: /Copier.*endpoint/i,
    });
    await user.click(endpointCopyButton);

    expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:4318');
    expect(await screen.findByRole('button', { name: /Copié/i })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Copilot CLI/i }));
    await user.click(screen.getByRole('button', { name: /Copier le snippet/i }));

    expect(writeText).toHaveBeenLastCalledWith(
      'COPILOT_OTEL_ENABLED=true\n'
        + 'OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318\n'
        + 'OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf\n'
        + 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true',
    );
  });

  it('reports a clipboard rejection when copying the endpoint and the active snippet', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard denied'));
    mockClipboardWriteText(writeText);

    render(<AgentTracesPage />);

    await user.click(await screen.findByRole('button', { name: /Copier l’endpoint/i }));

    expect(writeText).toHaveBeenCalledWith(
      'http://127.0.0.1:4318',
    );
    expect(await screen.findByText('Échec de la copie')).toBeInTheDocument();
    expect(screen.getByText('Échec de la copie')).toHaveTextContent('Échec de la copie');

    await user.click(screen.getByRole('button', { name: /Copier le snippet/i }));

    expect(writeText).toHaveBeenLastCalledWith(
      `{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "otlp-http",
  "github.copilot.chat.otel.protocol": "http/protobuf",
  "github.copilot.chat.otel.otlpEndpoint": "http://127.0.0.1:4318",
  "github.copilot.chat.otel.captureContent": true
}`,
    );
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
