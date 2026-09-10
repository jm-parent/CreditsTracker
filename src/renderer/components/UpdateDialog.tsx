import { AlertCircle, ArrowDownToLine, CheckCircle2, RotateCcw, X } from 'lucide-react';
import type { UpdateState } from '../../shared/types';

interface UpdateDialogProps {
  state: UpdateState;
  onDownload: () => void;
  onRestart: () => void;
  onClose: () => void;
}

/**
 * Squirrel exposes no byte-level download progress, so the download step is
 * rendered as an indeterminate bar animated by this class (defined in
 * index.css) rather than a percentage.
 */
const PROGRESS_BAR_CLASS = 'update-progress h-full w-1/3 rounded-full bg-primary';

export function UpdateDialog({ state, onDownload, onRestart, onClose }: UpdateDialogProps) {
  const target = state.latestVersion ? `v${state.latestVersion}` : 'a new version';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        className="w-full max-w-md rounded-lg border border-border bg-card p-5 text-card-foreground shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="update-dialog-title" className="text-lg font-semibold">
            {state.status === 'ready' ? 'Update ready to install' : 'Update available'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <p className="mt-3 text-sm text-muted-foreground">
          You are running v{state.currentVersion}.
          {state.status === 'ready'
            ? ` ${target} has been installed and applies the next time the app starts.`
            : ` ${target} is available.`}
        </p>

        {state.releaseNotes && state.status !== 'downloading' && (
          <pre className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted p-3 text-xs text-muted-foreground">
            {state.releaseNotes}
          </pre>
        )}

        {state.status === 'downloading' && (
          <div className="mt-4">
            <p className="text-sm text-foreground">Downloading and installing the update…</p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className={PROGRESS_BAR_CLASS} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Keep the app open until the installation finishes.
            </p>
          </div>
        )}

        {state.status === 'ready' && (
          <p className="mt-4 flex items-center gap-2 text-sm text-foreground">
            <CheckCircle2 size={16} aria-hidden="true" className="text-accent" />
            Restart the app to switch to the new version.
          </p>
        )}

        {state.status === 'error' && (
          <p className="mt-4 flex items-start gap-2 text-sm text-foreground">
            <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-red-400" />
            <span>The update failed: {state.error ?? 'unknown error'}</span>
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
          >
            {state.status === 'ready' ? 'Later' : 'Not now'}
          </button>
          {state.status === 'ready' ? (
            <button
              type="button"
              onClick={onRestart}
              className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90"
            >
              <RotateCcw size={16} aria-hidden="true" />
              Restart now
            </button>
          ) : (
            <button
              type="button"
              onClick={onDownload}
              disabled={state.status === 'downloading'}
              className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <ArrowDownToLine size={16} aria-hidden="true" />
              {state.status === 'downloading'
                ? 'Downloading…'
                : state.status === 'error'
                  ? 'Retry'
                  : 'Download and install'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
