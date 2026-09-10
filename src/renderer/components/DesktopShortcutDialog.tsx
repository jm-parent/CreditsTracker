import { Monitor, X } from 'lucide-react';

interface DesktopShortcutDialogProps {
  creating: boolean;
  onCreate: () => void;
  onDismiss: () => void;
}

export function DesktopShortcutDialog({ creating, onCreate, onDismiss }: DesktopShortcutDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onClick={onDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-dialog-title"
        className="w-full max-w-md rounded-lg border border-border bg-card p-5 text-card-foreground shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="shortcut-dialog-title" className="text-lg font-semibold">
            Create a Desktop shortcut?
          </h2>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <p className="mt-3 text-sm text-muted-foreground">
          Credits Tracker isn't linked from your Desktop yet. Add a shortcut so you can launch it without
          browsing to its install folder.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
          >
            No thanks
          </button>
          <button
            type="button"
            onClick={onCreate}
            disabled={creating}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Monitor size={16} aria-hidden="true" />
            {creating ? 'Creating…' : 'Create shortcut'}
          </button>
        </div>
      </div>
    </div>
  );
}
