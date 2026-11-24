import http from 'node:http';
import type { AgentTraceStore } from './agent-trace-store';
import {
  createAgentTraceCorrelator,
  emptyCounts,
  PENDING_TRACE_TTL_MS,
  toAgentTraceCorrelationFacts,
  type AgentTraceCorrelationInput,
  type AgentTraceCorrelationResult,
  type AgentTraceCorrelatorOptions,
  type AgentTraceRejectionCounts,
} from './agent-trace-correlator';
import { decodeOtlpTraceRequest } from './agent-trace-protocol';
import { opentelemetry } from './agent-trace-proto.generated';
import { sanitizeUnattributedAgentTraceSpan } from './agent-trace-sanitizer';
import { logError, logOnce } from './logger';

const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_PORT = 4318;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const OTLP_PATH = '/v1/traces';
const OTLP_CONTENT_TYPE = 'application/x-protobuf';
const LOOPBACK_HOST_PATTERN = /^(?:127\.0\.0\.1|localhost)(?::(\d{1,5}))?$/i;
const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/;

const ExportTraceServiceResponse = opentelemetry.proto.collector.trace.v1.ExportTraceServiceResponse;

export interface AgentTracePartialSuccess {
  totalRejectedSpans: number;
  unsupportedSourceSpans: number;
  missingSourceSessionSpans: number;
  unresolvedTraceRootSpans: number;
  errorMessage: string;
}

/** An export refused before decoding (wrong wire format or oversized body). */
export interface AgentTraceExportRejection {
  status: 413 | 415;
  errorMessage: string;
}

export interface AgentTraceReceiver {
  endpoint: string;
  close(): Promise<void>;
  /** Forgets spans held in memory while their trace root is awaited. */
  discardPending(): void;
}

export async function startAgentTraceReceiver(options: {
  store: AgentTraceStore;
  port?: number;
  onPartialSuccess?(partialSuccess: AgentTracePartialSuccess | null): void;
  onExportRejected?(rejection: AgentTraceExportRejection): void;
  correlation?: AgentTraceCorrelatorOptions;
}): Promise<AgentTraceReceiver> {
  const { store, port = DEFAULT_PORT, onPartialSuccess, onExportRejected } = options;
  const correlator = createAgentTraceCorrelator(options.correlation);
  const pendingTtlMs = options.correlation?.pendingTtlMs ?? PENDING_TRACE_TTL_MS;
  let listeningPort = port;
  let closing = false;
  let expiryTimer: NodeJS.Timeout | null = null;
  let scheduledExpiryAt: number | null = null;

  const context: RequestContext = {
    store,
    pendingTtlMs,
    getListeningPort: () => listeningPort,
    ingest: (inputs) => correlator.ingest(inputs, Date.now()),
    afterIngest: () => scheduleExpiry(),
    onPartialSuccess,
    onExportRejected,
  };
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, context);
  });

  await listen(server, port);

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Agent trace receiver did not bind to a TCP address');
  }
  listeningPort = address.port;

  let closePromise: Promise<void> | null = null;

  return {
    endpoint: `http://${LOOPBACK_HOST}:${address.port}`,
    close() {
      if (closePromise) {
        return closePromise;
      }
      closing = true;
      clearExpiryTimer();
      closePromise = closeServer(server).finally(() => {
        storeHeldResult(correlator.flushAll());
      });
      return closePromise;
    },
    discardPending() {
      correlator.discardPending();
      clearExpiryTimer();
    },
  };

  function scheduleExpiry(): void {
    if (closing) {
      return;
    }

    const nextExpiryAt = correlator.nextExpiryAt();
    if (nextExpiryAt === null) {
      clearExpiryTimer();
      return;
    }
    if (expiryTimer && scheduledExpiryAt === nextExpiryAt) {
      return;
    }

    clearExpiryTimer();
    scheduledExpiryAt = nextExpiryAt;
    expiryTimer = setTimeout(() => {
      expiryTimer = null;
      scheduledExpiryAt = null;
      storeHeldResult(correlator.expire(Date.now()));
      scheduleExpiry();
    }, Math.max(0, nextExpiryAt - Date.now()));
    expiryTimer.unref?.();
  }

  function clearExpiryTimer(): void {
    if (expiryTimer) {
      clearTimeout(expiryTimer);
    }
    expiryTimer = null;
    scheduledExpiryAt = null;
  }

  function storeHeldResult(result: AgentTraceCorrelationResult): void {
    if (result.ready.length > 0) {
      try {
        store.insertSpans(result.ready);
      } catch (error) {
        logError('agent-trace-receiver', 'Failed to store held OTLP spans', {
          spans: result.ready.length,
          error: getErrorMessage(error),
        });
      }
    }

    const partialCoverage = buildPartialCoverage(emptyCounts(), result.dropped, pendingTtlMs);
    if (partialCoverage) {
      onPartialSuccess?.(partialCoverage);
    }
  }
}

interface RequestContext {
  store: AgentTraceStore;
  pendingTtlMs: number;
  getListeningPort(): number;
  ingest(inputs: readonly AgentTraceCorrelationInput[]): AgentTraceCorrelationResult;
  afterIngest(): void;
  onPartialSuccess: ((partialSuccess: AgentTracePartialSuccess | null) => void) | undefined;
  onExportRejected: ((rejection: AgentTraceExportRejection) => void) | undefined;
}

async function handleRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext,
): Promise<void> {
  const route = getRoute(request);

  const forbiddenReason = getForbiddenReason(request, context.getListeningPort());
  if (forbiddenReason) {
    logOnce(
      `agent-trace-receiver:forbidden:${forbiddenReason}`,
      'warn',
      'agent-trace-receiver',
      'Rejected an OTLP request that did not come from a local exporter',
      { route, status: 403, reason: forbiddenReason },
    );
    response.statusCode = 403;
    response.end();
    return;
  }

  if (route !== OTLP_PATH) {
    response.statusCode = 404;
    response.end();
    return;
  }

  if (request.method !== 'POST') {
    response.statusCode = 405;
    response.end();
    return;
  }

  if (!hasOtlpContentType(request.headers['content-type'])) {
    const mediaType = describeMediaType(request.headers['content-type']);
    reportExportRejection(context, route, {
      status: 415,
      errorMessage:
        `OTLP export rejected (HTTP 415): content type ${mediaType} is not supported; `
        + 'set the exporter protocol to http/protobuf.',
    }, mediaType);
    response.statusCode = 415;
    response.end();
    return;
  }

  try {
    const body = await readRequestBody(request, response);
    if (body === null) {
      reportExportRejection(context, route, {
        status: 413,
        errorMessage: 'OTLP export rejected (HTTP 413): the request body exceeded the 8 MiB limit.',
      });
      return;
    }

    const decodedSpans = decodeRequestBody(body);
    const result = context.ingest(decodedSpans.map((decoded) => ({
      facts: toAgentTraceCorrelationFacts(decoded),
      span: sanitizeUnattributedAgentTraceSpan(decoded),
    })));
    context.afterIngest();

    context.store.insertSpans(result.ready);

    const partialCoverage = buildPartialCoverage(result.rejected, result.dropped, context.pendingTtlMs);
    if (partialCoverage) {
      context.onPartialSuccess?.(partialCoverage);
    } else if (result.held === 0) {
      context.onPartialSuccess?.(null);
    }

    writeOtlpResponse(response, buildPartialCoverage(result.rejected, emptyCounts(), context.pendingTtlMs));
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    logError('agent-trace-receiver', 'Failed to handle OTLP trace request', {
      route,
      status,
      error: getErrorMessage(error),
    });
    response.statusCode = status;
    response.end();
  }
}

function getForbiddenReason(request: http.IncomingMessage, listeningPort: number): 'host' | 'origin' | null {
  // Browsers attach an Origin header and may reach loopback through DNS rebinding; exporters do neither.
  if (request.headers.origin !== undefined) {
    return 'origin';
  }

  const match = LOOPBACK_HOST_PATTERN.exec(request.headers.host?.trim() ?? '');
  if (!match) {
    return 'host';
  }

  const hostPort = match[1];
  return hostPort === undefined || Number(hostPort) === listeningPort ? null : 'host';
}

function reportExportRejection(
  context: RequestContext,
  route: string,
  rejection: AgentTraceExportRejection,
  contentType?: string,
): void {
  logOnce(
    `agent-trace-receiver:${rejection.status}:${contentType ?? ''}`,
    'warn',
    'agent-trace-receiver',
    'Rejected an OTLP export before decoding',
    contentType === undefined
      ? { route, status: rejection.status }
      : { route, status: rejection.status, contentType },
  );
  context.onExportRejected?.(rejection);
}

function hasOtlpContentType(contentType: string | string[] | undefined): boolean {
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  return value?.split(';', 1)[0]?.trim().toLowerCase() === OTLP_CONTENT_TYPE;
}

function describeMediaType(contentType: string | string[] | undefined): string {
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  const mediaType = value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (mediaType === '') {
    return '(missing)';
  }
  return MEDIA_TYPE_PATTERN.test(mediaType) ? mediaType : '(unrecognized)';
}

function readRequestBody(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let limited = false;

    request.on('data', (chunk: Buffer | string) => {
      if (limited) {
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;

      if (size > MAX_BODY_BYTES) {
        limited = true;
        chunks.length = 0;
        response.statusCode = 413;
        response.end();
        request.destroy();
        resolve(null);
        return;
      }

      chunks.push(buffer);
    });

    request.once('end', () => {
      if (limited) {
        resolve(null);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    request.once('error', (error) => reject(error));
    response.once('error', (error) => reject(error));
  });
}

function writeOtlpResponse(
  response: http.ServerResponse,
  partialSuccess: AgentTracePartialSuccess | null,
): void {
  const payload = ExportTraceServiceResponse.encode(ExportTraceServiceResponse.create(
    partialSuccess
      ? {
        partialSuccess: {
          rejectedSpans: partialSuccess.totalRejectedSpans,
          errorMessage: partialSuccess.errorMessage,
        },
      }
      : {},
  )).finish();

  response.statusCode = 200;
  response.setHeader('content-type', OTLP_CONTENT_TYPE);
  response.setHeader('content-length', String(payload.length));
  response.end(payload);
}

function buildPartialCoverage(
  rejected: AgentTraceRejectionCounts,
  dropped: AgentTraceRejectionCounts,
  pendingTtlMs: number,
): AgentTracePartialSuccess | null {
  const unsupportedSourceSpans = rejected.unsupportedSource + dropped.unsupportedSource;
  const missingSourceSessionSpans = rejected.missingSourceSession + dropped.missingSourceSession;
  const unresolvedTraceRootSpans = rejected.unresolvedTraceRoot + dropped.unresolvedTraceRoot;
  const totalRejectedSpans = unsupportedSourceSpans + missingSourceSessionSpans + unresolvedTraceRootSpans;
  if (totalRejectedSpans === 0) {
    return null;
  }

  const reasons: string[] = [];
  if (unsupportedSourceSpans > 0) {
    reasons.push(`${unsupportedSourceSpans} from unsupported source`);
  }
  if (missingSourceSessionSpans > 0) {
    reasons.push(`${missingSourceSessionSpans} without source/session context`);
  }
  if (unresolvedTraceRootSpans > 0) {
    reasons.push(
      `${unresolvedTraceRootSpans} without a trace root or conversation context after ${formatHoldDuration(pendingTtlMs)}`,
    );
  }

  return {
    totalRejectedSpans,
    unsupportedSourceSpans,
    missingSourceSessionSpans,
    unresolvedTraceRootSpans,
    errorMessage: `partial trace coverage: rejected ${totalRejectedSpans} span(s): ${reasons.join(', ')}`,
  };
}

function formatHoldDuration(milliseconds: number): string {
  return milliseconds < 1_000 ? `${milliseconds} ms` : `${Math.round(milliseconds / 1_000)} s`;
}

function getRoute(request: http.IncomingMessage): string {
  try {
    return new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`).pathname;
  } catch {
    return request.url ?? '/';
  }
}

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, LOOPBACK_HOST);
  });
}

function closeServer(server: http.Server): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

function decodeRequestBody(body: Uint8Array) {
  try {
    return decodeOtlpTraceRequest(body);
  } catch (error) {
    throw new HttpError(400, getErrorMessage(error));
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
