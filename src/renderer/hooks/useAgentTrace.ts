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
  sessionError: Error | null;
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
  const statusRequestGenerationRef = useRef(0);
  const sessionRequestGenerationRef = useRef(0);

  selectionRef.current = selection;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.api.onAgentTraceStatusChange((nextStatus) => {
      invalidateStatusRequest();
      setCollectionStatus(nextStatus);
      setStatusError(null);
      setStatusLoading(false);
    });

    void refreshCollectionStatus();

    return () => {
      unsubscribe();
      invalidateStatusRequest();
    };
  }, []);

  useEffect(() => {
    if (!selection) {
      invalidateSessionRequest();
      setSession(null);
      setSessionLoading(false);
      setSessionError(null);
      return;
    }

    void loadSession(selection);

    return () => {
      invalidateSessionRequest();
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
      if (!mountedRef.current) {
        return;
      }

      await refreshCollectionStatus();

      const currentSelection = selectionRef.current;
      if (!currentSelection) {
        invalidateSessionRequest();
        setSession(null);
        setSessionLoading(false);
        setSessionError(null);
        return;
      }

      await loadSession(currentSelection);
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
    sessionError,
    setCollectionEnabled,
    clearTraceData,
  };

  async function loadSession(currentSelection: AgentTraceSelection): Promise<void> {
    const requestGeneration = startSessionRequest();

    try {
      const nextSession = await window.api.getAgentTraceSession(currentSelection);
      if (isActiveSessionRequest(requestGeneration)) {
        setSession(nextSession);
        setSessionError(null);
      }
    } catch (err) {
      logError(
        'useAgentTrace',
        `getAgentTraceSession failed for ${currentSelection.source}:${currentSelection.sessionId}`,
        err,
      );
      if (isActiveSessionRequest(requestGeneration)) {
        setSession(null);
        setSessionError(asError(err));
      }
    } finally {
      if (isActiveSessionRequest(requestGeneration)) {
        setSessionLoading(false);
      }
    }
  }

  function startSessionRequest(): number {
    const nextGeneration = sessionRequestGenerationRef.current + 1;
    sessionRequestGenerationRef.current = nextGeneration;
    setSessionLoading(true);
    return nextGeneration;
  }

  function invalidateSessionRequest(): void {
    sessionRequestGenerationRef.current += 1;
  }

  function isActiveSessionRequest(requestGeneration: number): boolean {
    return mountedRef.current && sessionRequestGenerationRef.current === requestGeneration;
  }

  async function refreshCollectionStatus(): Promise<void> {
    const requestGeneration = startStatusRequest();

    try {
      const nextStatus = await window.api.getAgentTraceCollectionStatus();
      if (isActiveStatusRequest(requestGeneration)) {
        setCollectionStatus(nextStatus);
        setStatusError(null);
      }
    } catch (err) {
      logError('useAgentTrace', 'getAgentTraceCollectionStatus failed', err);
      if (isActiveStatusRequest(requestGeneration)) {
        setStatusError(asError(err));
      }
    } finally {
      if (isActiveStatusRequest(requestGeneration)) {
        setStatusLoading(false);
      }
    }
  }

  function startStatusRequest(): number {
    const nextGeneration = statusRequestGenerationRef.current + 1;
    statusRequestGenerationRef.current = nextGeneration;
    setStatusLoading(true);
    return nextGeneration;
  }

  function invalidateStatusRequest(): void {
    statusRequestGenerationRef.current += 1;
  }

  function isActiveStatusRequest(requestGeneration: number): boolean {
    return mountedRef.current && statusRequestGenerationRef.current === requestGeneration;
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
