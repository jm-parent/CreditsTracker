import { Monitor, X } from 'lucide-react';

interface DesktopShortcutToastProps {
  creating: boolean;
  error: string | null;
  onCreate: () => void;
  onDismiss: () => void;
}

export function DesktopShortcutToast({
  creating,
  error,
  onCreate,
  onDismiss,
}: DesktopShortcutToastProps) {
  return (
    <aside
      role="status"
      className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-4 text-card-foreground shadow-xl"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-muted p-2 text-muted-foreground">
          <Monitor size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">No Desktop shortcut found</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Credits Tracker is not linked from your Desktop yet. Create a shortcut so you can
                reopen it without browsing to its install folder.
              </p>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss shortcut reminder"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          {error && (
            <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onCreate}
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Monitor size={16} aria-hidden="true" />
              {creating ? 'Creating…' : 'Create shortcut'}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
