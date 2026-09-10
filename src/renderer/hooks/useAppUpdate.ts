import { useCallback, useEffect, useState } from 'react';
import { logError, logInfo } from '../lib/logger';
import type { UpdateState } from '../../shared/types';

/**
 * Mirrors the main process update state in the renderer.
 *
 * The main process owns the whole flow (periodic availability checks,
 * download, staging) and pushes every transition over
 * `onUpdateStateChange`, so this hook only fetches the initial snapshot and
 * then reacts to pushes — no polling.
 */
export function useAppUpdate() {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.api
      .getUpdateState()
      .then((initial) => {
        if (!cancelled) setState(initial);
      })
      .catch((err) => {
        logError('useAppUpdate', 'Failed to read the update state', err);
      });

    const unsubscribe = window.api.onUpdateStateChange((next) => {
      setState(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const download = useCallback(() => {
    logInfo('useAppUpdate', 'User accepted the update, starting the download');
    window.api.downloadUpdate().catch((err) => {
      logError('useAppUpdate', 'Failed to start the update download', err);
    });
  }, []);

  const restart = useCallback(() => {
    logInfo('useAppUpdate', 'User requested a restart to apply the update');
    window.api.restartToUpdate().catch((err) => {
      logError('useAppUpdate', 'Failed to restart the app to apply the update', err);
    });
  }, []);

  const check = useCallback(() => {
    window.api.checkForUpdate().catch((err) => {
      logError('useAppUpdate', 'Failed to check for updates', err);
    });
  }, []);

  return { state, download, restart, check };
}
