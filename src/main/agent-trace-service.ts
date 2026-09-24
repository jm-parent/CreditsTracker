import path from 'node:path';
import { openAgentTraceStore, type AgentTraceStore } from './agent-trace-store';
import {
  startAgentTraceReceiver,
  type AgentTracePartialSuccess,
  type AgentTraceReceiver,
} from './agent-trace-receiver';
import { logError } from './logger';
import type {
  AgentTraceCollectionStatus,
  AgentTraceSelection,
  AgentTraceSession,
} from '../shared/types';

const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AGENT_TRACE_DB_NAME = 'agent-trace-store.db';

export interface AgentTraceServiceDependencies {
  storeFactory(path: string): AgentTraceStore;
  receiverFactory: typeof startAgentTraceReceiver;
}

const DEFAULT_DEPENDENCIES: AgentTraceServiceDependencies = {
  storeFactory: openAgentTraceStore,
  receiverFactory: startAgentTraceReceiver,
};

export class AgentTraceService {
  private readonly storePath: string;
  private readonly dependencies: AgentTraceServiceDependencies;
  private store: AgentTraceStore | null = null;
  private receiver: AgentTraceReceiver | null = null;
  private purgeTimer: NodeJS.Timeout | null = null;
  private lifecycleQueue: Promise<void> = Promise.resolve();
  private shutdownPromise: Promise<void> | null = null;
  private lifecycleErrorMessage: string | null = null;
  private partialCoverageMessage: string | null = null;
  private isShutdown = false;
  private status: AgentTraceCollectionStatus = disabledStatus();

  constructor(userDataPath: string, dependencies?: Partial<AgentTraceServiceDependencies>) {
    this.storePath = path.join(userDataPath, AGENT_TRACE_DB_NAME);
    this.dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  }

  initialize(): Promise<void> {
    return this.enqueueLifecycle(async () => {
      if (this.isShutdown) {
        return;
      }
      await this.doInitialize();
    });
  }

  getStatus(): AgentTraceCollectionStatus {
    return { ...this.status };
  }

  async setEnabled(enabled: boolean): Promise<AgentTraceCollectionStatus> {
    return this.enqueueLifecycle(async () => {
      if (this.isShutdown) {
        return this.getStatus();
      }

      const store = this.ensureStore();
      if (!store) {
        return this.getStatus();
      }

      if (enabled) {
        await this.enableCollection(store, { persistEnabled: true, resetEnabledOnFailure: true });
      } else {
        await this.disableCollection(store, { persistDisabled: true });
      }

      return this.getStatus();
    });
  }

  getSession(selection: AgentTraceSelection): AgentTraceSession {
    const store = this.ensureStore();
    if (!store) {
      return notCollected(selection);
    }

    try {
      return store.getSession(selection);
    } catch (error) {
      this.recordError('Failed to read local agent trace data', error);
      return notCollected(selection);
    }
  }

  clear(): void {
    const store = this.ensureStore();
    if (!store) {
      return;
    }

    try {
      store.clear();
      this.partialCoverageMessage = null;
      this.status = {
        ...this.status,
        errorMessage: this.currentErrorMessage(),
      };
    } catch (error) {
      this.recordError('Failed to clear local agent trace data', error);
    }
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.enqueueLifecycle(async () => {
      if (this.isShutdown) {
        return;
      }
      this.isShutdown = true;
      await this.doShutdown();
    }).finally(() => {
      this.shutdownPromise = null;
    });

    return this.shutdownPromise;
  }

  private async doInitialize(): Promise<void> {
    const store = this.ensureStore();
    if (!store) {
      return;
    }

    let collectionEnabled = false;
    try {
      collectionEnabled = store.getCollectionEnabled();
    } catch (error) {
      this.recordError('Failed to read the local agent trace opt-in', error);
      return;
    }

    if (collectionEnabled) {
      await this.enableCollection(store, {
        persistEnabled: false,
        resetEnabledOnFailure: false,
      });
      return;
    }

    this.lifecycleErrorMessage = null;
    this.setStatus(disabledStatusFields());
  }

  private ensureStore(): AgentTraceStore | null {
    if (this.isShutdown) {
      return null;
    }
    if (this.store) {
      return this.store;
    }

    let store: AgentTraceStore | null = null;

    try {
      store = this.dependencies.storeFactory(this.storePath);
      store.pruneExpired(new Date());
      this.startPurgeTimer();
      this.store = store;
      this.lifecycleErrorMessage = null;
      this.status = {
        ...this.status,
        errorMessage: this.currentErrorMessage(),
      };
      return this.store;
    } catch (error) {
      if (store) {
        try {
          store.close();
        } catch {
          // Preserve the original initialization failure.
        }
      }
      this.store = null;
      this.recordError('Failed to initialize local agent trace storage', error);
      return null;
    }
  }

  private async enableCollection(
    store: AgentTraceStore,
    options: { persistEnabled: boolean; resetEnabledOnFailure: boolean },
  ): Promise<void> {
    if (this.receiver) {
      if (options.persistEnabled) {
        try {
          store.setCollectionEnabled(true);
        } catch (error) {
          this.recordError('Failed to persist local agent trace opt-in', error);
          return;
        }
      }

      this.lifecycleErrorMessage = null;
      this.setStatus({
        enabled: true,
        listening: true,
        endpoint: this.receiver.endpoint,
      });
      return;
    }

    let receiver: AgentTraceReceiver | null = null;

    try {
      receiver = await this.dependencies.receiverFactory({
        store,
        onPartialSuccess: (partialSuccess) => {
          this.recordExportOutcome(partialSuccess);
        },
      });
      if (options.persistEnabled) {
        store.setCollectionEnabled(true);
      }
    } catch (error) {
      if (receiver) {
        try {
          await receiver.close();
        } catch (closeError) {
          this.recordError('Failed to stop local agent trace receiver after opt-in rollback', closeError);
        }
      }

      this.receiver = null;
      if (options.resetEnabledOnFailure) {
        try {
          store.setCollectionEnabled(false);
        } catch (persistError) {
          this.recordError('Failed to reset local agent trace opt-in after a startup error', persistError);
        }
      }

      this.recordError('Failed to start the local agent trace receiver', error);
      this.setStatus(disabledStatusFields());
      return;
    }

    this.receiver = receiver;
    this.lifecycleErrorMessage = null;
    this.setStatus({
      enabled: true,
      listening: true,
      endpoint: receiver.endpoint,
    });
  }

  private async disableCollection(
    store: AgentTraceStore,
    options: { persistDisabled: boolean },
  ): Promise<void> {
    if (this.receiver) {
      try {
        await this.receiver.close();
      } catch (error) {
        this.recordError('Failed to stop the local agent trace receiver', error);
        return;
      }
      this.receiver = null;
    }

    if (options.persistDisabled) {
      try {
        store.setCollectionEnabled(false);
      } catch (error) {
        this.recordError('Failed to persist local agent trace opt-out', error);
      }
    }

    this.setStatus(disabledStatusFields());
  }

  private startPurgeTimer(): void {
    if (this.purgeTimer) {
      return;
    }

    this.purgeTimer = setInterval(() => {
      try {
        this.store?.pruneExpired(new Date());
      } catch (error) {
        this.recordError('Failed to purge expired local agent trace data', error);
      }
    }, PURGE_INTERVAL_MS);
    this.purgeTimer.unref?.();
  }

  private stopPurgeTimer(): void {
    if (!this.purgeTimer) {
      return;
    }

    clearInterval(this.purgeTimer);
    this.purgeTimer = null;
  }

  private async doShutdown(): Promise<void> {
    this.stopPurgeTimer();

    if (this.receiver) {
      const receiver = this.receiver;
      this.receiver = null;
      await receiver.close();
    }

    if (this.store) {
      const store = this.store;
      this.store = null;
      store.close();
    }

    this.setStatus(disabledStatusFields());
  }

  private recordError(message: string, error: unknown): void {
    logError('agent-trace-service', message, error);
    this.lifecycleErrorMessage = `${message}: ${getErrorMessage(error)}`;
    this.status = {
      ...this.status,
      errorMessage: this.currentErrorMessage(),
    };
  }

  private recordExportOutcome(partialSuccess: AgentTracePartialSuccess | null): void {
    this.partialCoverageMessage = partialSuccess?.errorMessage ?? null;
    this.status = {
      ...this.status,
      errorMessage: this.currentErrorMessage(),
    };
  }

  private currentErrorMessage(): string | null {
    return this.lifecycleErrorMessage ?? this.partialCoverageMessage;
  }

  private setStatus(status: Omit<AgentTraceCollectionStatus, 'errorMessage'>): void {
    this.status = {
      ...status,
      errorMessage: this.currentErrorMessage(),
    };
  }

  private enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.lifecycleQueue.then(operation, operation);
    this.lifecycleQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export function createAgentTraceService(
  userDataPath: string,
  dependencies?: Partial<AgentTraceServiceDependencies>,
): AgentTraceService {
  return new AgentTraceService(userDataPath, dependencies);
}

function disabledStatus(errorMessage: string | null = null): AgentTraceCollectionStatus {
  return {
    enabled: false,
    listening: false,
    endpoint: null,
    errorMessage,
  };
}

function disabledStatusFields(): Omit<AgentTraceCollectionStatus, 'errorMessage'> {
  return {
    enabled: false,
    listening: false,
    endpoint: null,
  };
}

function notCollected(selection: AgentTraceSelection): AgentTraceSession {
  return {
    source: selection.source,
    sessionId: selection.sessionId,
    availability: 'not-collected',
    spans: [],
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
