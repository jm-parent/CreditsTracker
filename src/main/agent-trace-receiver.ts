import http from 'node:http';
import type { AgentTraceStore } from './agent-trace-store';
import { decodeOtlpTraceRequest } from './agent-trace-protocol';
import { opentelemetry } from './agent-trace-proto.generated';
import { sanitizeAgentTraceSpan } from './agent-trace-sanitizer';
import { logError } from './logger';
import type { AgentTraceSpan } from '../shared/types';

const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_PORT = 4318;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const OTLP_PATH = '/v1/traces';
const OTLP_CONTENT_TYPE = 'application/x-protobuf';

const ExportTraceServiceResponse = opentelemetry.proto.collector.trace.v1.ExportTraceServiceResponse;

interface SpanRejectionCounts {
  unsupportedSource: number;
  missingSourceSession: number;
}

export interface AgentTraceReceiver {
  endpoint: string;
  close(): Promise<void>;
}

export async function startAgentTraceReceiver(options: {
  store: AgentTraceStore;
  port?: number;
}): Promise<AgentTraceReceiver> {
  const { store, port = DEFAULT_PORT } = options;
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, store);
  });

  await listen(server, port);

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Agent trace receiver did not bind to a TCP address');
  }

  let closePromise: Promise<void> | null = null;

  return {
    endpoint: `http://${LOOPBACK_HOST}:${address.port}`,
    close() {
      if (closePromise) {
        return closePromise;
      }
      closePromise = closeServer(server);
      return closePromise;
    },
  };
}

async function handleRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  store: AgentTraceStore,
): Promise<void> {
  const route = getRoute(request);

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
    response.statusCode = 415;
    response.end();
    return;
  }

  try {
    const body = await readRequestBody(request, response);
    if (body === null) {
      return;
    }

    const decodedSpans = decodeRequestBody(body);
    const acceptedSpans: AgentTraceSpan[] = [];
    const rejectedSpans: SpanRejectionCounts = {
      unsupportedSource: 0,
      missingSourceSession: 0,
    };

    for (const decodedSpan of decodedSpans) {
      const sanitizedSpan = sanitizeAgentTraceSpan(decodedSpan);
      if (sanitizedSpan !== null) {
        acceptedSpans.push(sanitizedSpan);
        continue;
      }

      if (decodedSpan.sourceResolution === 'unsupported') {
        rejectedSpans.unsupportedSource += 1;
        continue;
      }

      rejectedSpans.missingSourceSession += 1;
    }

    store.insertSpans(acceptedSpans);

    writeOtlpResponse(response, rejectedSpans);
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

function hasOtlpContentType(contentType: string | string[] | undefined): boolean {
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  return value?.split(';', 1)[0]?.trim().toLowerCase() === OTLP_CONTENT_TYPE;
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

function writeOtlpResponse(response: http.ServerResponse, rejectedSpans: SpanRejectionCounts): void {
  const totalRejectedSpans = rejectedSpans.unsupportedSource + rejectedSpans.missingSourceSession;
  const payload = ExportTraceServiceResponse.encode(ExportTraceServiceResponse.create(
    totalRejectedSpans > 0
      ? {
        partialSuccess: {
          rejectedSpans: totalRejectedSpans,
          errorMessage: buildPartialSuccessErrorMessage(rejectedSpans, totalRejectedSpans),
        },
      }
      : {},
  )).finish();

  response.statusCode = 200;
  response.setHeader('content-type', OTLP_CONTENT_TYPE);
  response.setHeader('content-length', String(payload.length));
  response.end(payload);
}

function buildPartialSuccessErrorMessage(
  rejectedSpans: SpanRejectionCounts,
  totalRejectedSpans: number,
): string {
  const reasons: string[] = [];

  if (rejectedSpans.unsupportedSource > 0) {
    reasons.push(`${rejectedSpans.unsupportedSource} from unsupported source`);
  }
  if (rejectedSpans.missingSourceSession > 0) {
    reasons.push(`${rejectedSpans.missingSourceSession} without source/session context`);
  }

  return `partial trace coverage: rejected ${totalRejectedSpans} span(s): ${reasons.join(', ')}`;
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
