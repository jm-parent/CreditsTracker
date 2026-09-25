import { useState } from 'react';
import { useAgentTrace } from '../hooks/useAgentTrace';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

const DEFAULT_OTLP_ENDPOINT = 'http://127.0.0.1:4318';
const OTLP_PROTOCOL = 'OTLP/HTTP Protobuf';
const STORAGE_VOLUME_PLACEHOLDER = '—';
const STORAGE_VALUE_PLACEHOLDER = 'Indisponible';

const VSCODE_SNIPPET = `{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "otlp-http",
  "github.copilot.chat.otel.protocol": "http/protobuf",
  "github.copilot.chat.otel.otlpEndpoint": "http://127.0.0.1:4318",
  "github.copilot.chat.otel.captureContent": true
}`;

const CLI_SNIPPET = `COPILOT_OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`;

export function AgentTracesPage() {
  const {
    collectionStatus,
    statusLoading,
    error,
    setCollectionEnabled,
    clearTraceData,
  } = useAgentTrace(null);
  const [updatingEnabled, setUpdatingEnabled] = useState(false);
  const [clearing, setClearing] = useState(false);
  const enabled = collectionStatus?.enabled ?? false;
  const endpoint = collectionStatus?.endpoint ?? DEFAULT_OTLP_ENDPOINT;
  const endpointPort = new URL(endpoint).port || '4318';
  const activeError = error?.message ?? collectionStatus?.errorMessage ?? null;
  const collectionMessage = statusLoading
    ? 'Chargement de l’état de collecte…'
    : !collectionStatus
      ? 'État de collecte indisponible'
      : collectionStatus.listening
        ? 'Écoute active'
        : enabled
          ? 'Collecte activée — en attente du récepteur local'
          : 'Collecte désactivée';
  const collectionBadgeLabel = statusLoading
    ? 'Chargement'
    : !collectionStatus
      ? 'N/D'
      : collectionStatus.listening
        ? 'Écoute'
        : enabled
          ? 'En attente'
          : 'Désactivée';

  async function handleCollectionToggle(nextEnabled: boolean): Promise<void> {
    setUpdatingEnabled(true);
    try {
      await setCollectionEnabled(nextEnabled);
    } catch {
      // The hook already logs and exposes the latest bridge error state.
    } finally {
      setUpdatingEnabled(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!window.confirm('Supprimer toutes les traces agent stockées ? Cette action est irréversible.')) {
      return;
    }

    setClearing(true);
    try {
      await clearTraceData();
    } catch {
      // The hook already logs and exposes the latest bridge error state.
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="rounded-[28px] border-slate-800/80 bg-slate-950/95 shadow-xl shadow-slate-950/40">
        <CardContent className="flex flex-col gap-4 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-cyan-500/40 bg-cyan-500/15 text-cyan-100">
                  Télémétrie locale
                </Badge>
                <Badge
                  className={
                    collectionStatus?.listening
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-100'
                      : enabled
                        ? 'border-amber-500/40 bg-amber-500/15 text-amber-100'
                        : 'border-slate-700 bg-slate-900 text-slate-200'
                  }
                >
                  {enabled ? 'Collecte active' : 'Collecte inactive'}
                </Badge>
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight text-slate-50">
                  Traces agents &amp; Télémétrie locale
                </h2>
                <p className="max-w-3xl text-sm leading-6 text-slate-300">
                  Inspectez les spans d’outils et d’agents capturés strictement en local.
                  L’application ne modifie jamais automatiquement vos configurations VS Code ou
                  Copilot CLI.
                </p>
              </div>
            </div>
            <div className="grid gap-2 text-right text-xs text-slate-400">
              <span className="rounded-full border border-slate-800 bg-slate-900 px-3 py-1 text-cyan-200">
                {OTLP_PROTOCOL}
              </span>
              <span>Port {endpointPort}</span>
              <span className="font-mono text-slate-300">{endpoint}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="rounded-[28px] border-slate-800/80 bg-slate-950/95 shadow-lg shadow-slate-950/30">
          <CardHeader className="gap-4 p-6 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base text-slate-50">État de collecte</CardTitle>
              <Badge
                className={
                  collectionMessage === 'Écoute active'
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-100'
                    : collectionMessage === 'Collecte activée — en attente du récepteur local'
                      ? 'border-amber-500/40 bg-amber-500/15 text-amber-100'
                      : collectionMessage === 'Chargement de l’état de collecte…'
                        ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-100'
                        : 'border-slate-700 bg-slate-900 text-slate-200'
                }
              >
                {collectionBadgeLabel}
              </Badge>
            </div>
            <label className="flex items-center gap-3 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={enabled}
                disabled={statusLoading || updatingEnabled}
                onChange={(event) => void handleCollectionToggle(event.currentTarget.checked)}
              />
              Activer la collecte locale des traces agent
            </label>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6 text-sm text-slate-300">
            <div className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-slate-400">Récepteur local</p>
                <p className="font-mono text-slate-100">{endpoint}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-slate-400">Protocole / port</p>
                <p className="text-slate-100">
                  {OTLP_PROTOCOL} · {endpointPort}
                </p>
              </div>
            </div>
            <p className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-slate-100">
              {statusLoading
                ? 'Chargement de l’état de collecte…'
                : !collectionStatus
                  ? 'État de collecte indisponible'
                  : collectionStatus.listening
                    ? 'Écoute active'
                    : enabled
                      ? 'Collecte activée — en attente du récepteur local'
                      : 'Collecte désactivée'}
            </p>
            <p className="text-slate-400">
              Le récepteur accepte uniquement le loopback et conserve la valeur de secours{' '}
              <span className="font-mono text-slate-200">{DEFAULT_OTLP_ENDPOINT}</span>.
            </p>
            {activeError && (
              <p
                role="alert"
                className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-200"
              >
                {activeError}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-slate-800/80 bg-slate-950/95 shadow-lg shadow-slate-950/30">
          <CardHeader className="gap-3 p-6 pb-4">
            <CardTitle className="text-base text-slate-50">Stockage local</CardTitle>
            <p className="text-sm leading-6 text-slate-300">
              Les traces stockées sont purgées après 30 jours. La suppression reste manuelle et
              confirmée.
            </p>
          </CardHeader>
          <CardContent className="space-y-5 px-6 pb-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Volume actuel</p>
                <p className="mt-2 text-2xl font-semibold text-cyan-200">{STORAGE_VOLUME_PLACEHOLDER}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Politique de rétention</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-200">30 jours</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Dernière capture</p>
                <p className="mt-2 text-2xl font-semibold text-cyan-200">{STORAGE_VALUE_PLACEHOLDER}</p>
              </div>
            </div>
            <div className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
              <p>
                À insérer dans les User settings (Preferences: Open User Settings (JSON)). VS Code
                ignore les paramètres en workspace. Rechargez la fenêtre après modification.
              </p>
              <p>Définissez ces variables d’environnement avant de lancer copilot.</p>
              <p className="rounded-xl border border-amber-500/20 bg-slate-950/50 p-3 text-slate-100">
                L’activation de <code className="font-mono text-cyan-200">captureContent</code> peut
                faire transiter les prompts et réponses localement avant filtrage. La vue des traces
                stockées n’utilise que des payloads assainis via <span className="font-medium">AgentTraceTree</span> et n’affiche jamais le raisonnement masqué.
              </p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="space-y-2">
                <h3 className="text-sm font-medium text-slate-100">VS Code User settings</h3>
                <pre
                  tabIndex={0}
                  className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 p-4 text-xs text-slate-100"
                >
                  {VSCODE_SNIPPET}
                </pre>
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-medium text-slate-100">Copilot CLI environment</h3>
                <pre
                  tabIndex={0}
                  className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 p-4 text-xs text-slate-100"
                >
                  {CLI_SNIPPET}
                </pre>
              </section>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <p className="text-sm text-slate-300">
                Irréversible. Efface le cache local sans affecter vos IDE.
              </p>
              <button
                type="button"
                disabled={clearing}
                onClick={() => void handleDelete()}
                className="rounded-full border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-100 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Supprimer les traces stockées
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
