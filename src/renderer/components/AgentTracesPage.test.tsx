import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgentTraceCollectionStatus } from '../../shared/types';
import { createWindowApi } from '../test-utils/windowApi';
import * as useAgentTraceModule from '../hooks/useAgentTrace';
import * as useAgentTraceSessionCountModule from '../hooks/useAgentTraceSessionCount';
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

const renderSessionsViewMock = vi.fn(({ onBack }: { onBack: () => void }) => (
  <div>
    <h2>Sessions mock</h2>
    <button type="button" onClick={onBack}>
      Retour mock
    </button>
  </div>
));

vi.mock('./AgentTraceSessionsView', () => ({
  AgentTraceSessionsView: (props: { onBack: () => void }) => renderSessionsViewMock(props),
}));

let clipboardDescriptor: PropertyDescriptor | undefined;

function mockClipboardWriteText(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

function mockUseAgentTrace(
  overrides: Partial<ReturnType<typeof useAgentTraceModule.useAgentTrace>> = {},
) {
  const value: ReturnType<typeof useAgentTraceModule.useAgentTrace> = {
    collectionStatus: listeningStatus,
    session: null,
    statusLoading: false,
    sessionLoading: false,
    error: null,
    setCollectionEnabled: vi.fn().mockResolvedValue(undefined),
    clearTraceData: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  vi.spyOn(useAgentTraceModule, 'useAgentTrace').mockReturnValue(value);
  return value;
}

function mockUseAgentTraceSessionCount(
  overrides: Partial<ReturnType<typeof useAgentTraceSessionCountModule.useAgentTraceSessionCount>> = {},
) {
  const value: ReturnType<typeof useAgentTraceSessionCountModule.useAgentTraceSessionCount> = {
    count: 12,
    loading: false,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  vi.spyOn(useAgentTraceSessionCountModule, 'useAgentTraceSessionCount').mockReturnValue(value);
  return value;
}

beforeEach(() => {
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  window.api = createWindowApi({
    getAgentTraceCollectionStatus: vi.fn().mockResolvedValue(disabledStatus),
  });
  vi.restoreAllMocks();
  renderSessionsViewMock.mockClear();
  mockUseAgentTrace();
  mockUseAgentTraceSessionCount();
});

afterEach(() => {
  if (clipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

describe('AgentTracesPage', () => {
  it('shows the telemetry overview with the real session count, auto-purge retention, and no last-capture metric', async () => {
    render(<AgentTracesPage />);

    expect(await screen.findByText('Traces agents & Télémétrie locale')).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: /Sessions avec traces/i })).toHaveTextContent('12');
    expect(screen.getByText('30 jours (auto-purge)')).toBeInTheDocument();
    expect(screen.queryByText('Dernière capture')).not.toBeInTheDocument();
    expect(screen.getByText('Irréversible. Efface le cache local sans affecter vos IDEs.')).toBeInTheDocument();
  });

  it('shows loading explicitly before the collection status resolves', () => {
    mockUseAgentTrace({
      collectionStatus: null,
      statusLoading: true,
    });

    render(<AgentTracesPage />);

    expect(screen.getByText('Traces agents & Télémétrie locale')).toBeInTheDocument();
    expect(screen.getByText(/Chargement de l’état de collecte/i)).toBeInTheDocument();
    expect(screen.queryByText('Prêt')).not.toBeInTheDocument();
    expect(screen.queryByText(/Écoute active/i)).not.toBeInTheDocument();
  });

  it('shows the disabled and waiting collection states without a listening-only badge', () => {
    const useAgentTraceSpy = vi.spyOn(useAgentTraceModule, 'useAgentTrace');
    useAgentTraceSpy.mockReturnValue(mockUseAgentTrace({
      collectionStatus: disabledStatus,
    }));

    const { rerender } = render(<AgentTracesPage />);

    expect(screen.getByText('Collecte désactivée')).toBeInTheDocument();
    expect(screen.queryByText('Prêt')).not.toBeInTheDocument();
    expect(screen.queryByText(/Écoute active/i)).not.toBeInTheDocument();

    useAgentTraceSpy.mockReturnValue(mockUseAgentTrace({
      collectionStatus: {
        ...listeningStatus,
        listening: false,
      },
    }));

    rerender(<AgentTracesPage />);

    expect(screen.getByText('Collecte activée — en attente du récepteur local')).toBeInTheDocument();
    expect(screen.queryByText('Prêt')).not.toBeInTheDocument();
    expect(screen.queryByText(/Écoute active/i)).not.toBeInTheDocument();
  });

  it('shows the collection status unavailable after an error without claiming disabled collection', () => {
    mockUseAgentTrace({
      collectionStatus: null,
      statusLoading: false,
      error: new Error('Bridge connection failed'),
    });

    render(<AgentTracesPage />);

    expect(screen.getByText('État de collecte indisponible')).toBeInTheDocument();
    expect(screen.queryByText('Prêt')).not.toBeInTheDocument();
  });

  it('shows an exporter wire-format rejection reported by the receiver', async () => {
    mockUseAgentTrace({
      collectionStatus: {
      ...listeningStatus,
      errorMessage:
        'OTLP export rejected (HTTP 415): content type application/json is not supported; '
        + 'set the exporter protocol to http/protobuf.',
      },
    });

    render(<AgentTracesPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'set the exporter protocol to http/protobuf',
    );
    expect(screen.getAllByText('Écoute active')).toHaveLength(2);
    expect(screen.getByText('Prêt')).toBeInTheDocument();
  });

  it('defaults to VS Code, switches exporter snippets, supports keyboard navigation, and uses the updated copy labels', async () => {
    const user = userEvent.setup();

    render(<AgentTracesPage />);

    const vscodeTab = screen.getByRole('tab', { name: /VS Code \(settings\.json\)/i });
    const cliTab = screen.getByRole('tab', { name: /Copilot CLI \(variables d’env\)/i });

    expect(vscodeTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Paramètres utilisateur VS Code' })).toBeInTheDocument();
    expect(screen.getByText(/Ajoutez le snippet ci-dessous dans vos User settings/i)).toBeInTheDocument();
    expect(screen.getByText(/github\.copilot\.chat\.otel\.enabled/)).toBeInTheDocument();
    expect(screen.queryByText(/COPILOT_OTEL_ENABLED=true/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copier le JSON' })).toBeInTheDocument();

    await user.click(cliTab);

    expect(cliTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Environnement Copilot CLI' })).toBeInTheDocument();
    expect(screen.getByText(/Définissez ces variables d’environnement/i)).toBeInTheDocument();
    expect(screen.queryByText(/Ajoutez le snippet ci-dessous dans vos User settings/i)).not.toBeInTheDocument();
    expect(screen.getByText(/COPILOT_OTEL_ENABLED=true/)).toBeInTheDocument();
    expect(screen.queryByText(/github\.copilot\.chat\.otel\.enabled/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copier les variables' })).toBeInTheDocument();

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
    await user.click(screen.getByRole('button', { name: 'Copier les variables' }));

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

    await user.click(screen.getByRole('button', { name: 'Copier le JSON' }));

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

  it('distinguishes an unavailable session count from a real zero and offers a retry action', async () => {
    const useCountSpy = vi.spyOn(useAgentTraceSessionCountModule, 'useAgentTraceSessionCount');
    const refresh = vi.fn().mockResolvedValue(undefined);
    useCountSpy.mockReturnValue(mockUseAgentTraceSessionCount({
      count: 0,
      refresh,
    }));

    const { rerender } = render(<AgentTracesPage />);

    const sessionsButton = screen.getByRole('button', { name: /Sessions avec traces/i });
    expect(sessionsButton).toHaveTextContent('0');
    expect(screen.queryByText('Indisponible')).not.toBeInTheDocument();

    useCountSpy.mockReturnValue(mockUseAgentTraceSessionCount({
      count: null,
      error: new Error('Compteur indisponible'),
      refresh,
    }));

    rerender(<AgentTracesPage />);

    expect(screen.getByText('Indisponible')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sessions avec traces/i })).not.toHaveTextContent('0');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('enables collection on demand, shows the listening endpoint, and never changes settings automatically', async () => {
    const setCollectionEnabled = vi.fn().mockResolvedValue(undefined);
    mockUseAgentTrace({
      collectionStatus: listeningStatus,
      setCollectionEnabled,
    });
    const user = userEvent.setup();

    render(<AgentTracesPage />);

    const toggle = await screen.findByRole('checkbox', {
      name: 'Activer la collecte locale des traces agent',
    });
    await user.click(toggle);

    expect(setCollectionEnabled).toHaveBeenCalledWith(false);
    expect(screen.getAllByText('Écoute active')).toHaveLength(2);
    expect(screen.getAllByText('http://127.0.0.1:4318').length).toBeGreaterThan(0);
  });

  it('shows the receiver error when the endpoint cannot listen', async () => {
    mockUseAgentTrace({
      collectionStatus: {
        enabled: true,
        listening: false,
        endpoint: 'http://127.0.0.1:4318',
        errorMessage: 'Port 4318 is already in use.',
      } satisfies AgentTraceCollectionStatus,
    });

    render(<AgentTracesPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('Port 4318 is already in use.');
    expect(screen.getAllByText('http://127.0.0.1:4318').length).toBeGreaterThan(0);
  });

  it('does not delete stored traces when the confirmation is canceled', async () => {
    const user = userEvent.setup();
    const clearTraceData = vi.fn().mockResolvedValue(undefined);
    window.confirm = vi.fn().mockReturnValue(false);
    mockUseAgentTrace({ clearTraceData });

    render(<AgentTracesPage />);

    await user.click(
      await screen.findByRole('button', { name: 'Supprimer les traces stockées' }),
    );

    expect(window.confirm).toHaveBeenCalledWith(
      'Supprimer toutes les traces agent stockées ? Cette action est irréversible.',
    );
    expect(clearTraceData).not.toHaveBeenCalled();
  });

  it('opens the session browser and refreshes the count when returning to the overview', async () => {
    const user = userEvent.setup();
    const refresh = vi.fn().mockResolvedValue(undefined);
    mockUseAgentTraceSessionCount({ refresh });

    render(<AgentTracesPage />);

    await user.click(screen.getByRole('button', { name: /Sessions avec traces/i }));

    expect(screen.getByText('Sessions mock')).toBeInTheDocument();
    expect(renderSessionsViewMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Retour mock' }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Traces agents & Télémétrie locale')).toBeInTheDocument();
  });

  it('refreshes the count after a successful purge', async () => {
    const user = userEvent.setup();
    const clearTraceData = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn().mockResolvedValue(undefined);
    window.confirm = vi.fn().mockReturnValue(true);
    mockUseAgentTrace({ clearTraceData });
    mockUseAgentTraceSessionCount({ count: 7, refresh });

    render(<AgentTracesPage />);

    await user.click(
      await screen.findByRole('button', { name: 'Supprimer les traces stockées' }),
    );

    expect(window.confirm).toHaveBeenCalledWith(
      'Supprimer toutes les traces agent stockées ? Cette action est irréversible.',
    );
    expect(clearTraceData).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('preserves the existing count when a purge fails and does not announce a newly cleared zero', async () => {
    const user = userEvent.setup();
    const clearTraceData = vi.fn().mockRejectedValue(new Error('clear failed'));
    const refresh = vi.fn().mockResolvedValue(undefined);
    window.confirm = vi.fn().mockReturnValue(true);
    mockUseAgentTrace({
      clearTraceData,
      error: new Error('clear failed'),
    });
    mockUseAgentTraceSessionCount({ count: 7, refresh });

    render(<AgentTracesPage />);

    expect(screen.getByRole('button', { name: /Sessions avec traces/i })).toHaveTextContent('7');

    await user.click(
      await screen.findByRole('button', { name: 'Supprimer les traces stockées' }),
    );

    expect(clearTraceData).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Sessions avec traces/i })).toHaveTextContent('7');
  });
});
