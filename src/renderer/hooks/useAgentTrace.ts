import { useEffect, useRef, useState } from 'react';
import type {
  AgentTraceCollectionStatus,
  AgentTraceSelection,
  AgentTraceSession,
} from '../../shared/types';
import { logError } from '../lib/logger';

export interface UseAgentTraceResult {
  collectionStatus: AgentTraceCollectionStatus | null;
  session: AgentTraceSession | null;
  statusLoading: boolean;
  sessionLoading: boolean;
  error: Error | null;
  setCollectionEnabled(enabled: boolean): Promise<void>;
  clearTraceData(): Promise<void>;
}

export function useAgentTrace(selection: AgentTraceSelection | null): UseAgentTraceResult {
  const [collectionStatus, setCollectionStatus] = useState<AgentTraceCollectionStatus | null>(null);
  const [session, setSession] = useState<AgentTraceSession | null>(null);
  const [statusLoading, setStatusLoading] = useState<boolean>(true);
  const [sessionLoading, setSessionLoading] = useState<boolean>(false);
  const [statusError, setStatusError] = useState<Error | null>(null);
  const [sessionError, setSessionError] = useState<Error | null>(null);
  const selectionRef = useRef(selection);
  const mountedRef = useRef(true);

  selectionRef.current = selection;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchStatus(): Promise<void> {
      setStatusLoading(true);

      try {
        const nextStatus = await window.api.getAgentTraceCollectionStatus();
        if (!cancelled) {
          setCollectionStatus(nextStatus);
          setStatusError(null);
        }
      } catch (err) {
        logError('useAgentTrace', 'getAgentTraceCollectionStatus failed', err);
        if (!cancelled) {
          setStatusError(asError(err));
        }
      } finally {
        if (!cancelled) {
          setStatusLoading(false);
        }
      }
    }

    void fetchStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selection) {
      setSession(null);
      setSessionLoading(false);
      setSessionError(null);
      return;
    }

    let cancelled = false;

    async function fetchSession(currentSelection: AgentTraceSelection): Promise<void> {
      setSessionLoading(true);

      try {
        const nextSession = await window.api.getAgentTraceSession(currentSelection);
        if (!cancelled) {
          setSession(nextSession);
          setSessionError(null);
        }
      } catch (err) {
        logError(
          'useAgentTrace',
          `getAgentTraceSession failed for ${currentSelection.source}:${currentSelection.sessionId}`,
          err,
        );
        if (!cancelled) {
          setSession(null);
          setSessionError(asError(err));
        }
      } finally {
        if (!cancelled) {
          setSessionLoading(false);
        }
      }
    }

    void fetchSession(selection);

    return () => {
      cancelled = true;
    };
  }, [selection?.source, selection?.sessionId]);

  async function setCollectionEnabled(enabled: boolean): Promise<void> {
    try {
      const nextStatus = await window.api.setAgentTraceCollectionEnabled(enabled);
      if (mountedRef.current) {
        setCollectionStatus(nextStatus);
        setStatusError(null);
      }
    } catch (err) {
      logError('useAgentTrace', `setAgentTraceCollectionEnabled failed for ${enabled}`, err);
      if (mountedRef.current) {
        setStatusError(asError(err));
      }
      throw err;
    }
  }

  async function clearTraceData(): Promise<void> {
    try {
      await window.api.clearAgentTraceData();
      const currentSelection = selectionRef.current;
      if (!mountedRef.current) {
        return;
      }

      if (!currentSelection) {
        setSession(null);
        setSessionError(null);
        return;
      }

      setSessionLoading(true);

      try {
        const nextSession = await window.api.getAgentTraceSession(currentSelection);
        if (mountedRef.current) {
          setSession(nextSession);
          setSessionError(null);
        }
      } catch (err) {
        logError(
          'useAgentTrace',
          `getAgentTraceSession failed for ${currentSelection.source}:${currentSelection.sessionId}`,
          err,
        );
        if (mountedRef.current) {
          setSession(null);
          setSessionError(asError(err));
        }
      } finally {
        if (mountedRef.current) {
          setSessionLoading(false);
        }
      }
    } catch (err) {
      logError('useAgentTrace', 'clearAgentTraceData failed', err);
      if (mountedRef.current) {
        setSessionError(asError(err));
      }
      throw err;
    }
  }

  return {
    collectionStatus,
    session,
    statusLoading,
    sessionLoading,
    error: sessionError ?? statusError,
    setCollectionEnabled,
    clearTraceData,
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
