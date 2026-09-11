import { useCallback, useEffect, useState } from 'react';
import { logError, logInfo } from '../lib/logger';

/**
 * Drives the first-launch "create a Desktop shortcut?" dialog. The main
 * process decides on each mount whether the prompt is due — see
 * `shouldPromptForDesktopShortcut` in src/main/shortcut.ts — and the hook
 * only manages renderer state.
 */
export function useDesktopShortcutPrompt() {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

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
    setCreating(true);
    window.api
      .createDesktopShortcut()
      .then((created) => {
        logInfo(
          'useDesktopShortcutPrompt',
          created ? 'Desktop shortcut created' : 'Desktop shortcut creation failed',
        );
      })
      .catch((err) => {
        logError('useDesktopShortcutPrompt', 'Failed to create the desktop shortcut', err);
      })
      .finally(() => {
        setCreating(false);
        setOpen(false);
      });
  }, []);

  const dismiss = useCallback(() => {
    setOpen(false);
  }, []);

  return { open, creating, create, dismiss };
}
