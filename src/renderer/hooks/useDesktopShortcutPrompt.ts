import { useCallback, useEffect, useState } from 'react';
import { logError, logInfo } from '../lib/logger';

/**
 * Drives the launch-time "create a Desktop shortcut?" toast. The main process
 * decides on each mount whether the prompt is due — see
 * `shouldPromptForDesktopShortcut` in src/main/shortcut.ts — and the hook only
 * manages renderer state.
 */
export function useDesktopShortcutPrompt() {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.api
      .shouldPromptDesktopShortcut()
      .then((shouldPrompt) => {
        if (!cancelled && shouldPrompt) setOpen(true);
      })
      .catch((err) => {
        logError('useDesktopShortcutPrompt', 'Failed to read the desktop shortcut prompt state', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const create = useCallback(() => {
    setError(null);
    setCreating(true);
    window.api
      .createDesktopShortcut()
      .then((created) => {
        logInfo(
          'useDesktopShortcutPrompt',
          created ? 'Desktop shortcut created' : 'Desktop shortcut creation failed',
        );

        if (created) {
          setOpen(false);
          return;
        }

        setError('Could not create the shortcut. Please try again.');
      })
      .catch((err) => {
        logError('useDesktopShortcutPrompt', 'Failed to create the desktop shortcut', err);
        setError('Could not create the shortcut. Please try again.');
      })
      .finally(() => {
        setCreating(false);
      });
  }, []);

  const dismiss = useCallback(() => {
    setOpen(false);
  }, []);

  return { open, creating, error, create, dismiss };
}
