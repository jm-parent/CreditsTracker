import { useState } from 'react';
import type { AgentTraceSelection } from '../../shared/types';
import { useAgentTrace } from '../hooks/useAgentTrace';
import { AgentTraceTree } from './AgentTraceTree';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

export interface AgentTracesPageProps {
  selection: AgentTraceSelection | null;
}

const DEFAULT_OTLP_ENDPOINT = 'http://127.0.0.1:4318';

const VSCODE_SNIPPET = `{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "otlp-http",
  "github.copilot.chat.otel.otlpEndpoint": "http://127.0.0.1:4318",
  "github.copilot.chat.otel.captureContent": true
}`;

const CLI_SNIPPET = `COPILOT_OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`;

export function AgentTracesPage({ selection }: AgentTracesPageProps) {
  const {
    collectionStatus,
    session,
    statusLoading,
    sessionLoading,
    error,
    setCollectionEnabled,
    clearTraceData,
  } = useAgentTrace(selection);
  const [updatingEnabled, setUpdatingEnabled] = useState(false);
  const [clearing, setClearing] = useState(false);
  const enabled = collectionStatus?.enabled ?? false;
  const endpoint = collectionStatus?.endpoint ?? DEFAULT_OTLP_ENDPOINT;
  const activeError = error?.message ?? collectionStatus?.errorMessage ?? null;

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
    if (!window.confirm('Delete all stored agent traces? This cannot be undone.')) {
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-foreground">Traces agents</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Inspect sanitized agent/tool spans captured locally for a selected conversation. The app
            never changes VS Code or Copilot CLI settings automatically.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>{enabled ? 'enabled' : 'disabled'}</Badge>
          <Badge>{collectionStatus?.listening ? 'listening' : 'idle'}</Badge>
          <Badge>{selection?.source ?? 'no selection'}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-base text-foreground">Collection status</CardTitle>
          <label className="flex items-center gap-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={enabled}
              disabled={statusLoading || updatingEnabled}
              onChange={(event) => void handleCollectionToggle(event.currentTarget.checked)}
            />
            Activer la collecte locale des traces agent
          </label>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          {statusLoading ? (
            <p>Loading collection status…</p>
          ) : collectionStatus?.listening ? (
            <p className="text-foreground">Listening for local OTLP traces.</p>
          ) : enabled ? (
            <p>Collection is enabled, but the local receiver is not listening yet.</p>
          ) : (
            <p>Collection is disabled until you opt in from this page.</p>
          )}
          <p>
            Loopback only: configure exporters to send data to{' '}
            <span className="font-mono text-foreground">{endpoint}</span>.
          </p>
          {activeError && (
            <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300">
              {activeError}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-base text-foreground">Configure local exporters</CardTitle>
          <p className="text-sm text-muted-foreground">
            Loopback-only instructions for VS Code and Copilot CLI. The app does not write these
            settings for you.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">VS Code settings.json</h3>
            <pre
              tabIndex={0}
              className="overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs text-foreground"
            >
              {VSCODE_SNIPPET}
            </pre>
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">Copilot CLI environment</h3>
            <pre
              tabIndex={0}
              className="overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs text-foreground"
            >
              {CLI_SNIPPET}
            </pre>
          </section>
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 lg:col-span-2">
            Warning: captureContent can make prompts/responses transit locally before filtering. The
            stored trace view only uses sanitized payload strings via AgentTraceTree and never shows
            hidden reasoning.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-base text-foreground">Stored traces</CardTitle>
          <p className="text-sm text-muted-foreground">
            Stored sanitized agent traces are deleted after 30 days.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Delete every locally stored trace when you no longer need historical inspection.
          </p>
          <button
            type="button"
            disabled={clearing}
            onClick={() => void handleDelete()}
            className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            Supprimer les traces stockées
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-base text-foreground">Selected conversation</CardTitle>
          {selection ? (
            <div className="flex flex-wrap gap-2">
              <Badge>{selection.source}</Badge>
              <Badge>{selection.sessionId}</Badge>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a conversation from a project detail page to inspect its trace.
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!selection ? null : sessionLoading ? (
            <p className="text-sm text-muted-foreground">Loading selected trace…</p>
          ) : session?.availability === 'not-collected' ? (
            <p className="text-sm text-muted-foreground">
              No trace has been collected yet for this conversation.
            </p>
          ) : session ? (
            <>
              {session.availability === 'partial' && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  Some spans were stored without a complete parent chain, so this trace is partial.
                </p>
              )}
              <AgentTraceTree session={session} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No stored trace is available right now.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
