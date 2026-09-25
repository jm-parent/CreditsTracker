import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentTraceCollectionStatus, AgentTraceSelection, AgentTraceSession } from '../../shared/types';
import { makeAgentTraceSpan } from '../../test-utils/agent-trace-fixtures';
import * as logger from '../lib/logger';
import { createWindowApi } from '../test-utils/windowApi';
import { useAgentTrace } from './useAgentTrace';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const disabledStatus: AgentTraceCollectionStatus = {
  enabled: false,
  listening: false,
  endpoint: null,
  errorMessage: null,
};

const enabledStatus: AgentTraceCollectionStatus = {
  enabled: true,
  listening: true,
  endpoint: 'http://127.0.0.1:4318',
  errorMessage: null,
};

const selectionA: AgentTraceSelection = { source: 'vscode', sessionId: 'vscode:conversation-a' };
const selectionB: AgentTraceSelection = { source: 'vscode', sessionId: 'vscode:conversation-b' };

const partialSession: AgentTraceSession = {
  source: 'vscode',
  sessionId: selectionA.sessionId,
  availability: 'partial',
  spans: [
    makeAgentTraceSpan({
      sessionId: selectionA.sessionId,
      traceId: 'trace-1',
      spanId: 'root-1',
      category: 'agent',
    }),
  ],
};

const notCollectedSessionA: AgentTraceSession = {
  source: 'vscode',
  sessionId: selectionA.sessionId,
  availability: 'not-collected',
  spans: [],
};

const notCollectedSessionB: AgentTraceSession = {
  source: 'vscode',
  sessionId: selectionB.sessionId,
  availability: 'not-collected',
  spans: [],
};

beforeEach(() => {
  logger.resetLogDedupeForTests();
  window.api = createWindowApi({
    getAgentTraceCollectionStatus: vi.fn().mockResolvedValue(disabledStatus),
    getAgentTraceSession: vi.fn().mockResolvedValue(partialSession),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAgentTrace', () => {
  it('loads the collection status without requesting a session until one is selected', async () => {
    const { result } = renderHook(() => useAgentTrace(null));

    expect(result.current.collectionStatus).toBeNull();
    expect(result.current.session).toBeNull();
    expect(result.current.statusLoading).toBe(true);
    expect(result.current.sessionLoading).toBe(false);

    await waitFor(() => expect(result.current.statusLoading).toBe(false));

    expect(result.current.collectionStatus).toEqual(disabledStatus);
    expect(result.current.session).toBeNull();
    expect(window.api.getAgentTraceCollectionStatus).toHaveBeenCalledTimes(1);
    expect(window.api.getAgentTraceSession).not.toHaveBeenCalled();
  });

  it('subscribes to status changes, updates the status state, and unsubscribes on unmount', async () => {
    const unsubscribe = vi.fn();
    let statusListener: ((status: AgentTraceCollectionStatus) => void) | null = null;

    Object.assign(window.api as object, {
      onAgentTraceStatusChange: vi.fn((listener: (status: AgentTraceCollectionStatus) => void) => {
        statusListener = listener;
        return unsubscribe;
      }),
    });

    const statusWithError: AgentTraceCollectionStatus = {
      enabled: true,
      listening: false,
      endpoint: 'http://127.0.0.1:4318',
      errorMessage: 'Receiver unavailable',
    };

    const { result, unmount } = renderHook(() => useAgentTrace(null));

    await waitFor(() => expect(result.current.statusLoading).toBe(false));
    expect((window.api as Window['api'] & {
      onAgentTraceStatusChange: ReturnType<typeof vi.fn>;
    }).onAgentTraceStatusChange).toHaveBeenCalledTimes(1);

    await act(async () => {
      statusListener?.(statusWithError);
    });

    expect(result.current.collectionStatus).toEqual(statusWithError);
    expect(result.current.error).toBeNull();
    expect(result.current.statusLoading).toBe(false);

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('loads the selected session, preserves availability, and keeps status independent from selection changes', async () => {
    window.api.getAgentTraceSession = vi
      .fn()
      .mockResolvedValueOnce(partialSession)
      .mockResolvedValueOnce(notCollectedSessionB);

    const { result, rerender } = renderHook(
      ({ selection }) => useAgentTrace(selection),
      { initialProps: { selection: selectionA } },
    );

    await waitFor(() => expect(result.current.session).toEqual(partialSession));
    expect(result.current.collectionStatus).toEqual(disabledStatus);
    expect(result.current.sessionLoading).toBe(false);

    rerender({ selection: selectionB });

    await waitFor(() => expect(result.current.session).toEqual(notCollectedSessionB));
    expect(result.current.session?.availability).toBe('not-collected');
    expect(window.api.getAgentTraceCollectionStatus).toHaveBeenCalledTimes(1);
    expect(window.api.getAgentTraceSession).toHaveBeenNthCalledWith(1, selectionA);
    expect(window.api.getAgentTraceSession).toHaveBeenNthCalledWith(2, selectionB);
  });

  it('ignores stale session responses after the selection changes', async () => {
    const first = createDeferred<AgentTraceSession>();
    const second = createDeferred<AgentTraceSession>();
    const freshSession: AgentTraceSession = {
      ...partialSession,
      sessionId: selectionB.sessionId,
      spans: [makeAgentTraceSpan({ sessionId: selectionB.sessionId, spanId: 'root-2' })],
    };

    window.api.getAgentTraceSession = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result, rerender } = renderHook(
      ({ selection }) => useAgentTrace(selection),
      { initialProps: { selection: selectionA } },
    );

    rerender({ selection: selectionB });

    await act(async () => {
      first.resolve(partialSession);
      await first.promise;
    });

    expect(result.current.session).toBeNull();
    expect(result.current.sessionLoading).toBe(true);

    await act(async () => {
      second.resolve(freshSession);
      await second.promise;
    });

    await waitFor(() => expect(result.current.session).toEqual(freshSession));
  });

  it('ignores pending responses after unmount', async () => {
    const pendingSession = createDeferred<AgentTraceSession>();
    window.api.getAgentTraceSession = vi.fn().mockImplementation(() => pendingSession.promise);

    const { unmount } = renderHook(() => useAgentTrace(selectionA));

    unmount();

    await act(async () => {
      pendingSession.resolve(partialSession);
      await pendingSession.promise;
    });

    expect(window.api.getAgentTraceSession).toHaveBeenCalledWith(selectionA);
  });

  it('logs rejected session reads and exposes the error', async () => {
    const boom = new Error('boom');
    const logError = vi.spyOn(logger, 'logError').mockImplementation(() => undefined);
    window.api.getAgentTraceSession = vi.fn().mockRejectedValue(boom);

    const { result } = renderHook(() => useAgentTrace(selectionA));

    await waitFor(() => expect(result.current.sessionLoading).toBe(false));

    expect(result.current.session).toBeNull();
    expect(result.current.error).toEqual(boom);
    expect(logError).toHaveBeenCalledWith(
      'useAgentTrace',
      `getAgentTraceSession failed for ${selectionA.source}:${selectionA.sessionId}`,
      boom,
    );
  });

  it('updates collection status when toggled and reloads the session after clearing stored traces', async () => {
    window.api.getAgentTraceCollectionStatus = vi.fn().mockResolvedValue(disabledStatus);
    window.api.setAgentTraceCollectionEnabled = vi
      .fn()
      .mockResolvedValueOnce(enabledStatus)
      .mockResolvedValueOnce(disabledStatus);
    window.api.getAgentTraceSession = vi
      .fn()
      .mockResolvedValueOnce(partialSession)
      .mockResolvedValueOnce(notCollectedSessionA);
    window.api.clearAgentTraceData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useAgentTrace(selectionA));

    await waitFor(() => expect(result.current.session).toEqual(partialSession));

    await act(async () => {
      await result.current.setCollectionEnabled(true);
    });
    expect(result.current.collectionStatus).toEqual(enabledStatus);

    await act(async () => {
      await result.current.setCollectionEnabled(false);
    });
    expect(result.current.collectionStatus).toEqual(disabledStatus);

    await act(async () => {
      await result.current.clearTraceData();
    });

    await waitFor(() => expect(result.current.session).toEqual(notCollectedSessionA));
    expect(window.api.clearAgentTraceData).toHaveBeenCalledTimes(1);
  });

  it('refreshes collection status after clearing stored traces so stale partial coverage warnings disappear', async () => {
    const partialCoverageStatus: AgentTraceCollectionStatus = {
      enabled: true,
      listening: true,
      endpoint: 'http://127.0.0.1:4318',
      errorMessage: 'Only some spans were stored.',
    };
    const clearedStatus: AgentTraceCollectionStatus = {
      ...partialCoverageStatus,
      errorMessage: null,
    };

    window.api.getAgentTraceCollectionStatus = vi
      .fn()
      .mockResolvedValueOnce(partialCoverageStatus)
      .mockResolvedValueOnce(clearedStatus);
    window.api.getAgentTraceSession = vi
      .fn()
      .mockResolvedValueOnce(partialSession)
      .mockResolvedValueOnce(notCollectedSessionA);
    window.api.clearAgentTraceData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useAgentTrace(selectionA));

    await waitFor(() => expect(result.current.collectionStatus).toEqual(partialCoverageStatus));

    await act(async () => {
      await result.current.clearTraceData();
    });

    await waitFor(() => expect(result.current.collectionStatus).toEqual(clearedStatus));
    expect(result.current.error).toBeNull();
    expect(window.api.getAgentTraceCollectionStatus).toHaveBeenCalledTimes(2);
  });

  it('ignores an initial status response that resolves after a newer clear-triggered refresh', async () => {
    const initialStatus = createDeferred<AgentTraceCollectionStatus>();
    const refreshedStatus = createDeferred<AgentTraceCollectionStatus>();
    const partialCoverageStatus: AgentTraceCollectionStatus = {
      enabled: true,
      listening: true,
      endpoint: 'http://127.0.0.1:4318',
      errorMessage: 'Only some spans were stored.',
    };
    const clearedStatus: AgentTraceCollectionStatus = {
      ...partialCoverageStatus,
      errorMessage: null,
    };

    window.api.getAgentTraceCollectionStatus = vi
      .fn()
      .mockImplementationOnce(() => initialStatus.promise)
      .mockImplementationOnce(() => refreshedStatus.promise);
    window.api.getAgentTraceSession = vi
      .fn()
      .mockResolvedValueOnce(partialSession)
      .mockResolvedValueOnce(notCollectedSessionA);
    window.api.clearAgentTraceData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useAgentTrace(selectionA));

    await waitFor(() => expect(result.current.session).toEqual(partialSession));

    let clearPromise!: Promise<void>;
    await act(async () => {
      clearPromise = result.current.clearTraceData();
      await Promise.resolve();
    });

    await act(async () => {
      refreshedStatus.resolve(clearedStatus);
      await refreshedStatus.promise;
      await clearPromise;
    });

    await waitFor(() => expect(result.current.collectionStatus).toEqual(clearedStatus));
    expect(result.current.error).toBeNull();
    expect(result.current.statusLoading).toBe(false);

    await act(async () => {
      initialStatus.resolve(partialCoverageStatus);
      await initialStatus.promise;
    });

    expect(result.current.collectionStatus).toEqual(clearedStatus);
    expect(result.current.error).toBeNull();
    expect(result.current.statusLoading).toBe(false);
    expect(window.api.getAgentTraceCollectionStatus).toHaveBeenCalledTimes(2);
  });

  it('keeps a stale initial status snapshot from overwriting a newer status event', async () => {
    const initialStatus = createDeferred<AgentTraceCollectionStatus>();
    let statusListener: ((status: AgentTraceCollectionStatus) => void) | null = null;

    window.api.getAgentTraceCollectionStatus = vi.fn().mockImplementationOnce(() => initialStatus.promise);
    Object.assign(window.api as object, {
      onAgentTraceStatusChange: vi.fn((listener: (status: AgentTraceCollectionStatus) => void) => {
        statusListener = listener;
        return () => {};
      }),
    });

    const { result } = renderHook(() => useAgentTrace(null));

    const pushedStatus: AgentTraceCollectionStatus = {
      enabled: true,
      listening: true,
      endpoint: 'http://127.0.0.1:4318',
      errorMessage: null,
    };

    await act(async () => {
      statusListener?.(pushedStatus);
    });

    expect(result.current.collectionStatus).toEqual(pushedStatus);
    expect(result.current.error).toBeNull();
    expect(result.current.statusLoading).toBe(false);

    await act(async () => {
      initialStatus.resolve(disabledStatus);
      await initialStatus.promise;
    });

    expect(result.current.collectionStatus).toEqual(pushedStatus);
    expect(result.current.error).toBeNull();
    expect(result.current.statusLoading).toBe(false);
  });

  it('ignores stale clear-triggered reloads after the selection changes', async () => {
    const staleReload = createDeferred<AgentTraceSession>();
    const freshSession = createDeferred<AgentTraceSession>();
    const selectionBSession: AgentTraceSession = {
      ...partialSession,
      sessionId: selectionB.sessionId,
      availability: 'not-collected',
      spans: [],
    };

    window.api.clearAgentTraceData = vi.fn().mockResolvedValue(undefined);
    window.api.getAgentTraceSession = vi
      .fn()
      .mockResolvedValueOnce(partialSession)
      .mockImplementationOnce(() => staleReload.promise)
      .mockImplementationOnce(() => freshSession.promise);

    const { result, rerender } = renderHook(
      ({ selection }) => useAgentTrace(selection),
      { initialProps: { selection: selectionA } },
    );

    await waitFor(() => expect(result.current.session).toEqual(partialSession));

    let clearPromise!: Promise<void>;
    await act(async () => {
      clearPromise = result.current.clearTraceData();
      await Promise.resolve();
    });

    await waitFor(() => expect(window.api.getAgentTraceSession).toHaveBeenNthCalledWith(2, selectionA));

    rerender({ selection: selectionB });

    await waitFor(() => expect(window.api.getAgentTraceSession).toHaveBeenNthCalledWith(3, selectionB));

    await act(async () => {
      freshSession.resolve(selectionBSession);
      await freshSession.promise;
    });

    await waitFor(() => expect(result.current.session).toEqual(selectionBSession));

    await act(async () => {
      staleReload.resolve(notCollectedSessionA);
      await staleReload.promise;
      await clearPromise;
    });

    expect(result.current.session).toEqual(selectionBSession);
    expect(result.current.sessionLoading).toBe(false);
  });
});
