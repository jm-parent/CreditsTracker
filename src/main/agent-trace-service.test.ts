import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentTraceCollectionStatus,
  AgentTraceSession,
  AgentTraceSessionListFilters,
  AgentTraceSessionListPage,
} from '../shared/types';
import type { AgentTracePartialSuccess, AgentTraceReceiver } from './agent-trace-receiver';
import type { AgentTraceStore } from './agent-trace-store';
import { logError } from './logger';
import { createAgentTraceService, type AgentTraceServiceDependencies } from './agent-trace-service';

const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

vi.mock('./logger', () => ({
  logError: vi.fn(),
}));

describe('createAgentTraceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts disabled by default and does not open the receiver during initialization', async () => {
    const store = makeStoreDouble();
    const receiverFactory = vi.fn();
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => store),
      receiverFactory,
    });

    expect(service.getStatus()).toEqual(disabledStatus());

    await service.initialize();

    expect(receiverFactory).not.toHaveBeenCalled();
    expect(store.pruneExpired).toHaveBeenCalledTimes(1);
    expect(service.getStatus()).toEqual(disabledStatus());
  });

  it('starts the receiver before persisting opt-in when enabling collection', async () => {
    const calls: string[] = [];
    const store = makeStoreDouble({
      setCollectionEnabled: vi.fn((enabled: boolean) => {
        calls.push(`persist:${String(enabled)}`);
      }),
    });
    const receiver = makeReceiverDouble({
      close: vi.fn(async () => {
        calls.push('close');
      }),
    });
    const receiverFactory = vi.fn(async () => {
      calls.push('listen');
      return receiver;
    });
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => store),
      receiverFactory,
    });

    await service.initialize();
    const status = await service.setEnabled(true);

    expect(calls).toEqual(['listen', 'persist:true']);
    expect(store.setCollectionEnabled).toHaveBeenCalledWith(true);
    expect(status).toEqual({
      enabled: true,
      listening: true,
      endpoint: receiver.endpoint,
      errorMessage: null,
    } satisfies AgentTraceCollectionStatus);
  });

  it('keeps collection disabled when enabling fails and exposes the startup error', async () => {
    const store = makeStoreDouble();
    const receiverFactory = vi.fn(async () => {
      throw new Error('port already in use');
    });
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => store),
      receiverFactory,
    });

    await service.initialize();
    const status = await service.setEnabled(true);

    expect(receiverFactory).toHaveBeenCalledTimes(1);
    expect(store.setCollectionEnabled).not.toHaveBeenCalledWith(true);
    expect(store.getCollectionEnabled()).toBe(false);
    expect(status).toMatchObject({
      enabled: false,
      listening: false,
      endpoint: null,
    });
    expect(status.errorMessage).toContain('port already in use');
  });

  it('closes the receiver before persisting false when disabling collection', async () => {
    const calls: string[] = [];
    const receiver = makeReceiverDouble({
      close: vi.fn(async () => {
        calls.push('close');
      }),
    });
    const store = makeStoreDouble({
      setCollectionEnabled: vi.fn((enabled: boolean) => {
        calls.push(`persist:${String(enabled)}`);
      }),
    });
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => store),
      receiverFactory: vi.fn(async () => receiver),
    });

    await service.initialize();
    await service.setEnabled(true);
    calls.length = 0;

    const status = await service.setEnabled(false);

    expect(calls).toEqual(['close', 'persist:false']);
    expect(status).toEqual(disabledStatus());
  });

  it('surfaces receiver partial-coverage updates in status and preserves them across disable and re-enable', async () => {
    let reportPartialSuccess:
      | ((partialSuccess: AgentTracePartialSuccess | null) => void)
      | undefined;
    const store = makeStoreDouble();
    const receiver = makeReceiverDouble();
    const receiverFactory = vi.fn(async (options: Parameters<AgentTraceServiceDependencies['receiverFactory']>[0]) => {
      reportPartialSuccess = options.onPartialSuccess as typeof reportPartialSuccess;
      return receiver;
    });
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => store),
      receiverFactory,
    });

    await service.initialize();
    await service.setEnabled(true);

    reportPartialSuccess?.({
      totalRejectedSpans: 2,
      unsupportedSourceSpans: 1,
      missingSourceSessionSpans: 1,
      unresolvedTraceRootSpans: 0,
      errorMessage:
        'partial trace coverage: rejected 2 span(s): 1 from unsupported source, 1 without source/session context',
    });

    expect(service.getStatus()).toEqual({
      enabled: true,
      listening: true,
      endpoint: receiver.endpoint,
      errorMessage:
        'partial trace coverage: rejected 2 span(s): 1 from unsupported source, 1 without source/session context',
    } satisfies AgentTraceCollectionStatus);

    expect(await service.setEnabled(false)).toEqual({
      enabled: false,
      listening: false,
      endpoint: null,
      errorMessage:
        'partial trace coverage: rejected 2 span(s): 1 from unsupported source, 1 without source/session context',
    } satisfies AgentTraceCollectionStatus);

    expect(await service.setEnabled(true)).toEqual({
      enabled: true,
      listening: true,
      endpoint: receiver.endpoint,
      errorMessage:
        'partial trace coverage: rejected 2 span(s): 1 from unsupported source, 1 without source/session context',
    } satisfies AgentTraceCollectionStatus);
    expect(receiverFactory).toHaveBeenCalledTimes(2);
  });

  it('clears partial coverage after a clean export without hiding an independent lifecycle error', async () => {
    let reportPartialSuccess:
      | ((partialSuccess: AgentTracePartialSuccess | null) => void)
      | undefined;
    let persistShouldFail = false;
    const store = makeStoreDouble({
      setCollectionEnabled: vi.fn((enabled: boolean) => {
        if (persistShouldFail) {
          throw new Error('persist failed');
        }
      }),
    });
    const receiver = makeReceiverDouble();
    const receiverFactory = vi.fn(async (options: Parameters<AgentTraceServiceDependencies['receiverFactory']>[0]) => {
      reportPartialSuccess = options.onPartialSuccess as typeof reportPartialSuccess;
      return receiver;
    });
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => store),
      receiverFactory,
    });

    await service.initialize();
    await service.setEnabled(true);

    reportPartialSuccess?.({
      totalRejectedSpans: 2,
      unsupportedSourceSpans: 1,
      missingSourceSessionSpans: 1,
      unresolvedTraceRootSpans: 0,
      errorMessage:
        'partial trace coverage: rejected 2 span(s): 1 from unsupported source, 1 without source/session context',
    });
    expect(service.getStatus().errorMessage).toBe(
      'partial trace coverage: rejected 2 span(s): 1 from unsupported source, 1 without source/session context',
    );

    reportPartialSuccess?.(null);
    expect(service.getStatus().errorMessage).toBeNull();

    reportPartialSuccess?.({
      totalRejectedSpans: 1,
      unsupportedSourceSpans: 1,
      missingSourceSessionSpans: 0,
      unresolvedTraceRootSpans: 0,
      errorMessage: 'partial trace coverage: rejected 1 span(s): 1 from unsupported source',
    });
    expect(service.getStatus().errorMessage).toBe(
      'partial trace coverage: rejected 1 span(s): 1 from unsupported source',
    );

    persistShouldFail = true;
    await service.setEnabled(true);
    expect(service.getStatus().errorMessage).toContain('persist failed');

    reportPartialSuccess?.(null);
    expect(service.getStatus().errorMessage).toContain('persist failed');
  });

  it('surfaces export rejections until a clean export arrives, below independent lifecycle errors', async () => {
    let options: Parameters<AgentTraceServiceDependencies['receiverFactory']>[0] | undefined;
    const store = makeStoreDouble();
    const receiver = makeReceiverDouble();
    const receiverFactory = vi.fn(async (receiverOptions: Parameters<AgentTraceServiceDependencies['receiverFactory']>[0]) => {
      options = receiverOptions;
      return receiver;
    });
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => store),
      receiverFactory,
    });
    const rejectionMessage =
      'OTLP export rejected (HTTP 415): content type application/json is not supported; '
      + 'set the exporter protocol to http/protobuf.';

    await service.initialize();
    await service.setEnabled(true);

    options?.onExportRejected?.({ status: 415, errorMessage: rejectionMessage });
    expect(service.getStatus()).toEqual({
      enabled: true,
      listening: true,
      endpoint: receiver.endpoint,
      errorMessage: rejectionMessage,
    } satisfies AgentTraceCollectionStatus);

    options?.onPartialSuccess?.({
      totalRejectedSpans: 1,
      unsupportedSourceSpans: 1,
      missingSourceSessionSpans: 0,
      unresolvedTraceRootSpans: 0,
      errorMessage: 'partial trace coverage: rejected 1 span(s): 1 from unsupported source',
    });
    expect(service.getStatus().errorMessage).toBe(rejectionMessage);

    service.clear();
    expect(service.getStatus().errorMessage).toBe(rejectionMessage);

    options?.onPartialSuccess?.(null);
    expect(service.getStatus().errorMessage).toBeNull();
  });

  it('discards spans held by the receiver when stored traces are cleared', async () => {
    const calls: string[] = [];
    const store = makeStoreDouble({
      clear: vi.fn(() => {
        calls.push('store.clear');
      }),
    });
    const receiver = makeReceiverDouble({
      discardPending: vi.fn(() => {
        calls.push('receiver.discardPending');
      }),
    });
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => store),
      receiverFactory: vi.fn(async () => receiver),
    });

    await service.initialize();
    await service.setEnabled(true);
    service.clear();

    expect(calls).toEqual(['receiver.discardPending', 'store.clear']);
  });

  it('auto-starts persisted opt-in, purges every 24 hours, and stops the timer during shutdown', async () => {
    const receiver = makeReceiverDouble();
    const store = makeStoreDouble({
      getCollectionEnabled: vi.fn(() => true),
    });
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => store),
      receiverFactory: vi.fn(async () => receiver),
    });

    await service.initialize();
    expect(store.pruneExpired).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(PURGE_INTERVAL_MS);
    expect(store.pruneExpired).toHaveBeenCalledTimes(2);

    await service.shutdown();
    await service.shutdown();
    vi.advanceTimersByTime(PURGE_INTERVAL_MS);

    expect(store.pruneExpired).toHaveBeenCalledTimes(2);
    expect(receiver.close).toHaveBeenCalledTimes(1);
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it('serializes disable during an in-flight enable so the later opt-out closes the receiver and wins', async () => {
    const calls: string[] = [];
    const store = makeStoreDouble({
      setCollectionEnabled: vi.fn((enabled: boolean) => {
        calls.push(`persist:${String(enabled)}`);
      }),
    });
    const receiver = makeReceiverDouble({
      close: vi.fn(async () => {
        calls.push('close');
      }),
    });
    const { promise: receiverPromise, resolve: resolveReceiver } = deferred<AgentTraceReceiver>();
    const receiverFactory = vi.fn(async () => {
      calls.push('listen');
      return receiverPromise;
    });
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => store),
      receiverFactory,
    });

    await service.initialize();
    const enablePromise = service.setEnabled(true);
    const disablePromise = service.setEnabled(false);

    resolveReceiver(receiver);

    await expect(enablePromise).resolves.toEqual({
      enabled: true,
      listening: true,
      endpoint: receiver.endpoint,
      errorMessage: null,
    } satisfies AgentTraceCollectionStatus);
    await expect(disablePromise).resolves.toEqual(disabledStatus());
    expect(service.getStatus()).toEqual(disabledStatus());
    expect(calls).toEqual(['listen', 'persist:true', 'close', 'persist:false']);
    expect(receiver.close).toHaveBeenCalledTimes(1);
  });

  it('waits for an in-flight enable during shutdown, closes the resulting receiver, and prevents re-enable after shutdown', async () => {
    const receiver = makeReceiverDouble();
    const store = makeStoreDouble();
    const { promise: receiverPromise, resolve: resolveReceiver } = deferred<AgentTraceReceiver>();
    const receiverFactory = vi.fn(async () => receiverPromise);
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => store),
      receiverFactory,
    });

    await service.initialize();
    const enablePromise = service.setEnabled(true);
    const shutdownPromise = service.shutdown();

    resolveReceiver(receiver);

    await enablePromise;
    await shutdownPromise;

    expect(receiver.close).toHaveBeenCalledTimes(1);
    expect(store.close).toHaveBeenCalledTimes(1);
    expect(service.getStatus()).toEqual(disabledStatus());

    await expect(service.setEnabled(true)).resolves.toEqual(disabledStatus());
    expect(receiverFactory).toHaveBeenCalledTimes(1);
  });

  it('captures initialization errors in the status without throwing', async () => {
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => {
        throw new Error('disk unavailable');
      }),
      receiverFactory: vi.fn(),
    });

    await expect(service.initialize()).resolves.toBeUndefined();
    expect(service.getStatus()).toMatchObject({
      enabled: false,
      listening: false,
      endpoint: null,
    });
    expect(service.getStatus().errorMessage).toContain('disk unavailable');
  });

  it('captures persisted opt-in read failures in the status without rejecting initialization', async () => {
    const store = makeStoreDouble({
      getCollectionEnabled: vi.fn(() => {
        throw new Error('metadata read failed');
      }),
    });
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => store),
      receiverFactory: vi.fn(),
    });

    await expect(service.initialize()).resolves.toBeUndefined();
    expect(service.getStatus().errorMessage).toContain('metadata read failed');
  });

  it('preserves the persisted opt-in when automatic startup cannot bind the receiver', async () => {
    let collectionEnabled = true;
    const store = makeStoreDouble({
      getCollectionEnabled: vi.fn(() => collectionEnabled),
      setCollectionEnabled: vi.fn((enabled: boolean) => {
        collectionEnabled = enabled;
      }),
    });
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => store),
      receiverFactory: vi.fn(async () => {
        throw new Error('port already in use');
      }),
    });

    await service.initialize();

    expect(store.setCollectionEnabled).not.toHaveBeenCalledWith(false);
    expect(collectionEnabled).toBe(true);
    expect(service.getStatus().errorMessage).toContain('port already in use');
  });

  it('does not cache a half-initialized store after the startup prune fails', async () => {
    const brokenStore = makeStoreDouble({
      pruneExpired: vi.fn(() => {
        throw new Error('prune failed');
      }),
    });
    const healthyStore = makeStoreDouble();
    const storeFactory = vi.fn()
      .mockReturnValueOnce(brokenStore)
      .mockReturnValueOnce(healthyStore);
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory,
      receiverFactory: vi.fn(),
    });

    await service.initialize();
    const session = service.getSession({ source: 'vscode', sessionId: 'vscode:conversation-1' });

    expect(storeFactory).toHaveBeenCalledTimes(2);
    expect(brokenStore.close).toHaveBeenCalledTimes(1);
    expect(healthyStore.getSession).toHaveBeenCalledWith({
      source: 'vscode',
      sessionId: 'vscode:conversation-1',
    });
    expect(session).toEqual({
      source: 'vscode',
      sessionId: 'vscode:conversation-1',
      availability: 'not-collected',
      spans: [],
    } satisfies AgentTraceSession);
  });

  it('returns a not-collected session when storage is unavailable', async () => {
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => {
        throw new Error('disk unavailable');
      }),
      receiverFactory: vi.fn(),
    });

    await service.initialize();

    expect(
      service.getSession({ source: 'vscode', sessionId: 'vscode:conversation-1' }),
    ).toEqual({
      source: 'vscode',
      sessionId: 'vscode:conversation-1',
      availability: 'not-collected',
      spans: [],
    } satisfies AgentTraceSession);
  });

  it('returns the exact stored trace session count', async () => {
    const store = makeStoreDouble({
      countSessions: vi.fn(() => 42),
    });
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => store),
      receiverFactory: vi.fn(),
    });

    await service.initialize();

    expect(service.getSessionCount()).toBe(42);
    expect(store.countSessions).toHaveBeenCalledTimes(1);
  });

  it('logs and propagates count failures when storage is unavailable', async () => {
    const storeError = new Error('disk unavailable');
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => {
        throw storeError;
      }),
      receiverFactory: vi.fn(),
    });

    await service.initialize();

    expect(() => service.getSessionCount()).toThrow('Local agent trace store is unavailable');
    expect(logError).toHaveBeenCalledWith(
      'AgentTraceService',
      'Failed to count stored trace sessions',
      expect.objectContaining({ message: 'Local agent trace store is unavailable' }),
    );
  });

  it('logs and propagates store count failures without returning zero', async () => {
    const failure = new Error('count failed');
    const store = makeStoreDouble({
      countSessions: vi.fn(() => {
        throw failure;
      }),
    });
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => store),
      receiverFactory: vi.fn(),
    });

    await service.initialize();

    expect(() => service.getSessionCount()).toThrow('count failed');
    expect(logError).toHaveBeenCalledWith(
      'AgentTraceService',
      'Failed to count stored trace sessions',
      failure,
    );
  });

  it('forwards exact filters and returns the exact stored session list page', async () => {
    const filters = makeSessionFilters({
      query: 'model-a',
      source: 'copilot-cli',
      from: '2026-09-24',
      to: '2026-09-25',
      category: 'tool',
      status: 'error',
      page: 2,
    });
    const page: AgentTraceSessionListPage = {
      items: [{ source: 'copilot-cli', sessionId: 'cli-session', spanCount: 7 }],
      total: 23,
      page: 2,
      pageSize: 50,
    };
    const store = makeStoreDouble({
      listSessions: vi.fn(() => page),
    });
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => store),
      receiverFactory: vi.fn(),
    });

    await service.initialize();

    expect(service.listSessions(filters)).toBe(page);
    expect(store.listSessions).toHaveBeenCalledWith(filters);
  });

  it('logs and propagates list failures when storage is unavailable', async () => {
    const storeError = new Error('disk unavailable');
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => {
        throw storeError;
      }),
      receiverFactory: vi.fn(),
    });

    await service.initialize();

    expect(() => service.listSessions(makeSessionFilters())).toThrow('Local agent trace store is unavailable');
    expect(logError).toHaveBeenCalledWith(
      'AgentTraceService',
      'Failed to list stored trace sessions',
      expect.objectContaining({ message: 'Local agent trace store is unavailable' }),
    );
  });

  it('logs and propagates store list failures without returning an empty page', async () => {
    const failure = new Error('list failed');
    const store = makeStoreDouble({
      listSessions: vi.fn(() => {
        throw failure;
      }),
    });
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', {
      storeFactory: vi.fn(() => store),
      receiverFactory: vi.fn(),
    });

    await service.initialize();

    expect(() => service.listSessions(makeSessionFilters())).toThrow('list failed');
    expect(logError).toHaveBeenCalledWith(
      'AgentTraceService',
      'Failed to list stored trace sessions',
      failure,
    );
  });

  it('publishes copied status changes once per distinct transition', async () => {
    const publishedStatuses: AgentTraceCollectionStatus[] = [];
    const store = makeStoreDouble();
    const receiver = makeReceiverDouble();
    const dependencies: Partial<AgentTraceServiceDependencies> & {
      onStatusChange: (status: AgentTraceCollectionStatus) => void;
    } = {
      storeFactory: vi.fn(() => store),
      receiverFactory: vi.fn(async () => receiver),
      onStatusChange: (status) => {
        publishedStatuses.push(status);
      },
    };
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', dependencies);

    await service.initialize();
    await service.setEnabled(true);
    await service.setEnabled(true);

    expect(publishedStatuses).toEqual([
      {
        enabled: true,
        listening: true,
        endpoint: receiver.endpoint,
        errorMessage: null,
      } satisfies AgentTraceCollectionStatus,
    ]);
    expect(publishedStatuses[0]).not.toBe(service.getStatus());

    publishedStatuses[0].errorMessage = 'mutated outside the service';
    expect(service.getStatus()).toEqual({
      enabled: true,
      listening: true,
      endpoint: receiver.endpoint,
      errorMessage: null,
    } satisfies AgentTraceCollectionStatus);
  });

  it('publishes error and clear transitions from receiver-driven status changes', async () => {
    const publishedStatuses: AgentTraceCollectionStatus[] = [];
    let options: Parameters<AgentTraceServiceDependencies['receiverFactory']>[0] | undefined;
    const store = makeStoreDouble();
    const receiver = makeReceiverDouble();
    const dependencies: Partial<AgentTraceServiceDependencies> & {
      onStatusChange: (status: AgentTraceCollectionStatus) => void;
    } = {
      storeFactory: vi.fn(() => store),
      receiverFactory: vi.fn(async (receiverOptions: Parameters<AgentTraceServiceDependencies['receiverFactory']>[0]) => {
        options = receiverOptions;
        return receiver;
      }),
      onStatusChange: (status) => {
        publishedStatuses.push(status);
      },
    };
    const service = createAgentTraceService('C:\\Users\\jm-parent\\AppData\\Roaming\\CreditsTracker', dependencies);

    await service.initialize();
    await service.setEnabled(true);

    options?.onPartialSuccess?.({
      totalRejectedSpans: 1,
      unsupportedSourceSpans: 1,
      missingSourceSessionSpans: 0,
      unresolvedTraceRootSpans: 0,
      errorMessage: 'partial trace coverage: rejected 1 span(s): 1 from unsupported source',
    });
    service.clear();

    expect(publishedStatuses).toEqual([
      {
        enabled: true,
        listening: true,
        endpoint: receiver.endpoint,
        errorMessage: null,
      } satisfies AgentTraceCollectionStatus,
      {
        enabled: true,
        listening: true,
        endpoint: receiver.endpoint,
        errorMessage: 'partial trace coverage: rejected 1 span(s): 1 from unsupported source',
      } satisfies AgentTraceCollectionStatus,
      {
        enabled: true,
        listening: true,
        endpoint: receiver.endpoint,
        errorMessage: null,
      } satisfies AgentTraceCollectionStatus,
    ]);
  });
});

function makeStoreDouble(overrides: Partial<AgentTraceStore> = {}): AgentTraceStore {
  let collectionEnabled = false;

  return {
    insertSpans: vi.fn(),
    countSessions: vi.fn(() => 0),
    listSessions: vi.fn((filters) => ({
      items: [],
      total: 0,
      page: filters.page,
      pageSize: 50,
    })),
    getSession: vi.fn((selection) => ({
      source: selection.source,
      sessionId: selection.sessionId,
      availability: 'not-collected' as const,
      spans: [],
    })),
    getCollectionEnabled: vi.fn(() => collectionEnabled),
    setCollectionEnabled: vi.fn((enabled: boolean) => {
      collectionEnabled = enabled;
    }),
    pruneExpired: vi.fn(),
    clear: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

function makeReceiverDouble(overrides: Partial<AgentTraceReceiver> = {}): AgentTraceReceiver {
  return {
    endpoint: 'http://127.0.0.1:4318',
    close: vi.fn(async () => undefined),
    discardPending: vi.fn(),
    ...overrides,
  };
}

function disabledStatus(): AgentTraceCollectionStatus {
  return {
    enabled: false,
    listening: false,
    endpoint: null,
    errorMessage: null,
  };
}

function makeSessionFilters(overrides: Partial<AgentTraceSessionListFilters> = {}): AgentTraceSessionListFilters {
  return {
    query: '',
    source: null,
    from: null,
    to: null,
    category: null,
    status: null,
    page: 0,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
