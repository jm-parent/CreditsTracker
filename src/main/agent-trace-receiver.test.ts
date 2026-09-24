import http, { type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLogEntries, resetLoggerForTests } from './logger';
import { openAgentTraceStore, type AgentTraceStore } from './agent-trace-store';
import { opentelemetry } from './agent-trace-proto.generated';
import type { AgentTraceSpan } from '../shared/types';

type Receiver = Awaited<ReturnType<typeof import('./agent-trace-receiver').startAgentTraceReceiver>>;

const ExportTraceServiceRequest = opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;
const ExportTraceServiceResponse = opentelemetry.proto.collector.trace.v1.ExportTraceServiceResponse;
const BODY_LIMIT_BYTES = 8 * 1024 * 1024;

const openStores = new Set<AgentTraceStore>();
const openReceivers = new Set<Receiver>();
const openServers = new Set<http.Server>();

beforeEach(() => {
  resetLoggerForTests();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  for (const receiver of openReceivers) {
    await receiver.close();
  }
  openReceivers.clear();

  for (const store of openStores) {
    store.close();
  }
  openStores.clear();

  for (const server of openServers) {
    await closeServer(server);
  }
  openServers.clear();

  vi.restoreAllMocks();
  resetLoggerForTests();
});

describe('startAgentTraceReceiver', () => {
  it('listens on loopback and stores sanitized spans from OTLP posts', async () => {
    const store = openMemoryStore();
    const receiver = await startReceiver({ store, port: 0 });

    expect(receiver.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const response = await fetch(`${receiver.endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf' },
      body: encodeTraceRequest({
        serviceName: 'copilot-chat',
        spans: [
          makeSpan({
            traceId: '00112233445566778899aabbccddeeff',
            spanId: '1111222233334444',
            name: 'invoke_agent copilot',
            attributes: [
              attribute('gen_ai.agent.name', 'copilot'),
              attribute('gen_ai.conversation.id', 'conversation-1'),
              attribute('gen_ai.input.messages', 'raw prompt that must never be stored'),
            ],
            statusCode: 1,
          }),
          makeSpan({
            traceId: '00112233445566778899aabbccddeeff',
            spanId: '5555666677778888',
            parentSpanId: '1111222233334444',
            name: 'execute_tool runCommand',
            attributes: [
              attribute('gen_ai.tool.name', 'runCommand'),
              attribute('gen_ai.tool.call.id', 'call-1'),
              attribute(
                'gen_ai.tool.call.arguments',
                JSON.stringify({ command: 'echo trace-probe', token: 'super-secret-token' }),
              ),
              attribute(
                'gen_ai.tool.call.result',
                JSON.stringify({ stdout: 'trace-probe', authorization: 'Bearer ultra-secret' }),
              ),
            ],
            statusCode: 1,
          }),
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/x-protobuf');

    const responseMessage = decodeTraceResponse(new Uint8Array(await response.arrayBuffer()));
    expect(responseMessage.partialSuccess).toBeNull();

    const session = store.getSession({ source: 'vscode', sessionId: 'vscode:conversation-1' });
    expect(session.availability).toBe('available');
    expect(session.spans).toHaveLength(2);
    expect(session.spans[1]).toMatchObject({
      spanId: '5555666677778888',
      category: 'tool',
      argumentsJson: '{"command":"echo trace-probe","token":"[REDACTED]"}',
      resultText: '{"stdout":"trace-probe","authorization":"[REDACTED]"}',
      contentState: 'redacted',
    });
    expect(JSON.stringify(session.spans)).not.toContain('raw prompt that must never be stored');
    expect(JSON.stringify(session.spans)).not.toContain('super-secret-token');
    expect(getLogEntries()).toEqual([]);
  });

  it('sends only sanitized spans to the store', async () => {
    const insertedBatches: AgentTraceSpan[][] = [];
    const store = makeStoreDouble({
      insertSpans: (spans) => {
        insertedBatches.push(spans.map((span) => ({ ...span })));
      },
    });
    const receiver = await startReceiver({ store, port: 0 });

    const response = await fetch(`${receiver.endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf' },
      body: encodeTraceRequest({
        serviceName: 'copilot-chat',
        spans: [
          makeSpan({
            traceId: '10112233445566778899aabbccddeeff',
            spanId: '1111222233334444',
            name: 'invoke_agent copilot',
            attributes: [
              attribute('gen_ai.conversation.id', 'conversation-1'),
              attribute('gen_ai.input.messages', 'highly sensitive prompt'),
            ],
          }),
          makeSpan({
            traceId: '10112233445566778899aabbccddeeff',
            spanId: '5555666677778888',
            parentSpanId: '1111222233334444',
            name: 'execute_tool runCommand',
            attributes: [
              attribute('gen_ai.tool.name', 'runCommand'),
              attribute('gen_ai.tool.call.arguments', '{"password":"top-secret"}'),
              attribute('gen_ai.tool.call.result', '{"stdout":"ok"}'),
            ],
          }),
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(insertedBatches).toHaveLength(1);
    expect(insertedBatches[0]).toHaveLength(2);
    expect(JSON.stringify(insertedBatches[0])).not.toContain('highly sensitive prompt');
    expect(JSON.stringify(insertedBatches[0])).not.toContain('top-secret');
    expect(insertedBatches[0][1]).toMatchObject({
      argumentsJson: '{"password":"[REDACTED]"}',
      resultText: '{"stdout":"ok"}',
      contentState: 'redacted',
    });
  });

  it('continues storing spans even when the persisted collection flag is false because Task 6 owns opt-in gating', async () => {
    const insertedBatches: AgentTraceSpan[][] = [];
    const store = makeStoreDouble({
      insertSpans: (spans) => {
        insertedBatches.push(spans.map((span) => ({ ...span })));
      },
      getCollectionEnabled: () => false,
    });
    const receiver = await startReceiver({ store, port: 0 });

    const response = await fetch(`${receiver.endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf' },
      body: encodeTraceRequest({
        serviceName: 'copilot-chat',
        spans: [
          makeSpan({
            traceId: '15112233445566778899aabbccddeeff',
            spanId: '1111222233334444',
            name: 'invoke_agent copilot',
            attributes: [attribute('gen_ai.conversation.id', 'conversation-1')],
          }),
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(insertedBatches).toHaveLength(1);
    expect(insertedBatches[0]).toHaveLength(1);
    expect(insertedBatches[0][0]).toMatchObject({
      source: 'vscode',
      sessionId: 'vscode:conversation-1',
      spanId: '1111222233334444',
    });
  });

  it('rejects unsupported methods for the OTLP route', async () => {
    const receiver = await startReceiver({ store: openMemoryStore(), port: 0 });

    const response = await fetch(`${receiver.endpoint}/v1/traces`, { method: 'GET' });

    expect(response.status).toBe(405);
    expect(await response.text()).toBe('');
  });

  it('rejects unsupported paths', async () => {
    const receiver = await startReceiver({ store: openMemoryStore(), port: 0 });

    const response = await fetch(`${receiver.endpoint}/wrong-path`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf' },
      body: new Uint8Array(),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });

  it('rejects unsupported content types', async () => {
    const receiver = await startReceiver({ store: openMemoryStore(), port: 0 });

    const response = await fetch(`${receiver.endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(415);
    expect(await response.text()).toBe('');
  });

  it('returns 400 for malformed protobuf without logging payload values', async () => {
    const receiver = await startReceiver({ store: openMemoryStore(), port: 0 });

    const response = await fetch(`${receiver.endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf' },
      body: Buffer.from('super-secret-payload'),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('');

    const [entry] = getLogEntries();
    expect(entry).toMatchObject({
      level: 'error',
      scope: 'agent-trace-receiver',
      message: 'Failed to handle OTLP trace request',
    });
    expect(entry.detail).toContain('"route":"/v1/traces"');
    expect(entry.detail).toContain('"status":400');
    expect(entry.detail).not.toContain('super-secret-payload');
  });

  it('returns 500 for store errors without logging payload values', async () => {
    const receiver = await startReceiver({
      store: makeStoreDouble({
        insertSpans: () => {
          throw new Error('db locked');
        },
      }),
      port: 0,
    });

    const response = await fetch(`${receiver.endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf' },
      body: encodeTraceRequest({
        serviceName: 'copilot-chat',
        spans: [
          makeSpan({
            traceId: '20112233445566778899aabbccddeeff',
            spanId: '1111222233334444',
            name: 'invoke_agent copilot',
            attributes: [attribute('gen_ai.conversation.id', 'conversation-1')],
          }),
          makeSpan({
            traceId: '20112233445566778899aabbccddeeff',
            spanId: '5555666677778888',
            parentSpanId: '1111222233334444',
            name: 'execute_tool runCommand',
            attributes: [
              attribute('gen_ai.tool.name', 'runCommand'),
              attribute('gen_ai.tool.call.arguments', '{"token":"never-log-me"}'),
            ],
          }),
        ],
      }),
    });

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('');

    const [entry] = getLogEntries();
    expect(entry).toMatchObject({
      level: 'error',
      scope: 'agent-trace-receiver',
      message: 'Failed to handle OTLP trace request',
    });
    expect(entry.detail).toContain('"route":"/v1/traces"');
    expect(entry.detail).toContain('"status":500');
    expect(entry.detail).toContain('"error":"db locked"');
    expect(entry.detail).not.toContain('never-log-me');
  });

  it('returns partial success counts for spans that cannot be associated to a source session', async () => {
    const store = openMemoryStore();
    const receiver = await startReceiver({ store, port: 0 });

    const response = await fetch(`${receiver.endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf' },
      body: encodeTraceRequest({
        resourceSpans: [
          {
            resource: {
              attributes: [attribute('service.name', 'copilot-chat')],
            },
            scopeSpans: [{
              spans: [
                makeSpan({
                  traceId: '30112233445566778899aabbccddeeff',
                  spanId: '1111222233334444',
                  name: 'invoke_agent copilot',
                  attributes: [attribute('gen_ai.conversation.id', 'conversation-1')],
                }),
                makeSpan({
                  traceId: '30112233445566778899aabbccddeeff',
                  spanId: '5555666677778888',
                  parentSpanId: '1111222233334444',
                  name: 'execute_tool runCommand',
                  attributes: [attribute('gen_ai.tool.name', 'runCommand')],
                }),
              ],
            }],
          },
          {
            resource: {
              attributes: [attribute('service.name', 'unknown-client')],
            },
            scopeSpans: [{
              spans: [
                makeSpan({
                  traceId: '40112233445566778899aabbccddeeff',
                  spanId: 'aaaaaaaaaaaaaaaa',
                  name: 'execute_tool listFiles',
                  attributes: [attribute('gen_ai.tool.name', 'listFiles')],
                }),
              ],
            }],
          },
        ],
      }),
    });

    expect(response.status).toBe(200);

    const responseMessage = decodeTraceResponse(new Uint8Array(await response.arrayBuffer()));
    expect(Number(responseMessage.partialSuccess?.rejectedSpans ?? 0)).toBe(1);
    expect(responseMessage.partialSuccess?.errorMessage).toContain('unsupported source');
    expect(responseMessage.partialSuccess?.errorMessage).not.toContain('without source/session');

    const session = store.getSession({ source: 'vscode', sessionId: 'vscode:conversation-1' });
    expect(session.spans).toHaveLength(2);
    expect(session.spans.map((span) => span.spanId)).toEqual(['1111222233334444', '5555666677778888']);
  });

  it('reports missing source/session context separately from unsupported sources', async () => {
    const store = openMemoryStore();
    const receiver = await startReceiver({ store, port: 0 });

    const response = await fetch(`${receiver.endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf' },
      body: encodeTraceRequest({
        serviceName: 'copilot-chat',
        spans: [
          makeSpan({
            traceId: '50112233445566778899aabbccddeeff',
            spanId: '1111222233334444',
            name: 'invoke_agent copilot',
            attributes: [attribute('gen_ai.agent.name', 'copilot')],
          }),
        ],
      }),
    });

    expect(response.status).toBe(200);

    const responseMessage = decodeTraceResponse(new Uint8Array(await response.arrayBuffer()));
    expect(Number(responseMessage.partialSuccess?.rejectedSpans ?? 0)).toBe(1);
    expect(responseMessage.partialSuccess?.errorMessage).toContain('without source/session');
    expect(responseMessage.partialSuccess?.errorMessage).not.toContain('unsupported source');
    expect(store.getSession({ source: 'vscode', sessionId: 'vscode:conversation-1' }).spans).toHaveLength(0);
  });

  it('combines unsupported-source and missing-source/session rejection reasons in one partial success response', async () => {
    const store = openMemoryStore();
    const receiver = await startReceiver({ store, port: 0 });

    const response = await fetch(`${receiver.endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf' },
      body: encodeTraceRequest({
        resourceSpans: [
          {
            resource: {
              attributes: [attribute('service.name', 'copilot-chat')],
            },
            scopeSpans: [{
              spans: [
                makeSpan({
                  traceId: '60112233445566778899aabbccddeeff',
                  spanId: '1111222233334444',
                  name: 'invoke_agent copilot',
                  attributes: [attribute('gen_ai.conversation.id', 'conversation-1')],
                }),
                makeSpan({
                  traceId: '60112233445566778899aabbccddeeff',
                  spanId: '5555666677778888',
                  parentSpanId: '1111222233334444',
                  name: 'execute_tool runCommand',
                  attributes: [attribute('gen_ai.tool.name', 'runCommand')],
                }),
              ],
            }],
          },
          {
            resource: {
              attributes: [attribute('service.name', 'unknown-client')],
            },
            scopeSpans: [{
              spans: [
                makeSpan({
                  traceId: '70112233445566778899aabbccddeeff',
                  spanId: 'aaaaaaaaaaaaaaaa',
                  name: 'invoke_agent unsupported',
                  attributes: [attribute('gen_ai.conversation.id', 'conversation-2')],
                }),
              ],
            }],
          },
          {
            resource: {
              attributes: [attribute('service.name', 'copilot-chat')],
            },
            scopeSpans: [{
              spans: [
                makeSpan({
                  traceId: '80112233445566778899aabbccddeeff',
                  spanId: 'bbbbbbbbbbbbbbbb',
                  name: 'invoke_agent missingContext',
                  attributes: [attribute('gen_ai.agent.name', 'copilot')],
                }),
              ],
            }],
          },
        ],
      }),
    });

    expect(response.status).toBe(200);

    const responseMessage = decodeTraceResponse(new Uint8Array(await response.arrayBuffer()));
    expect(Number(responseMessage.partialSuccess?.rejectedSpans ?? 0)).toBe(2);
    expect(responseMessage.partialSuccess?.errorMessage).toContain('1 from unsupported source');
    expect(responseMessage.partialSuccess?.errorMessage).toContain('1 without source/session context');

    const session = store.getSession({ source: 'vscode', sessionId: 'vscode:conversation-1' });
    expect(session.spans.map((span) => span.spanId)).toEqual(['1111222233334444', '5555666677778888']);
  });

  it('reports safe partial-coverage counts to the receiver callback without exposing payload values', async () => {
    const store = openMemoryStore();
    const onPartialSuccess = vi.fn();
    const receiver = await startReceiver({ store, port: 0, onPartialSuccess });

    const response = await fetch(`${receiver.endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf' },
      body: encodeTraceRequest({
        resourceSpans: [
          {
            resource: {
              attributes: [attribute('service.name', 'copilot-chat')],
            },
            scopeSpans: [{
              spans: [
                makeSpan({
                  traceId: '90112233445566778899aabbccddeeff',
                  spanId: '1111222233334444',
                  name: 'invoke_agent copilot',
                  attributes: [attribute('gen_ai.conversation.id', 'conversation-1')],
                }),
                makeSpan({
                  traceId: '90112233445566778899aabbccddeeff',
                  spanId: '5555666677778888',
                  parentSpanId: '1111222233334444',
                  name: 'execute_tool runCommand',
                  attributes: [
                    attribute('gen_ai.tool.name', 'runCommand'),
                    attribute('gen_ai.tool.call.arguments', '{"token":"do-not-expose"}'),
                  ],
                }),
              ],
            }],
          },
          {
            resource: {
              attributes: [attribute('service.name', 'unknown-client')],
            },
            scopeSpans: [{
              spans: [
                makeSpan({
                  traceId: 'a0112233445566778899aabbccddeeff',
                  spanId: 'aaaaaaaaaaaaaaaa',
                  name: 'invoke_agent unsupported',
                  attributes: [attribute('gen_ai.conversation.id', 'conversation-2')],
                }),
              ],
            }],
          },
          {
            resource: {
              attributes: [attribute('service.name', 'copilot-chat')],
            },
            scopeSpans: [{
              spans: [
                makeSpan({
                  traceId: 'b0112233445566778899aabbccddeeff',
                  spanId: 'bbbbbbbbbbbbbbbb',
                  name: 'invoke_agent missingContext',
                  attributes: [attribute('gen_ai.agent.name', 'copilot')],
                }),
              ],
            }],
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(onPartialSuccess).toHaveBeenCalledTimes(1);
    expect(onPartialSuccess).toHaveBeenCalledWith({
      totalRejectedSpans: 2,
      unsupportedSourceSpans: 1,
      missingSourceSessionSpans: 1,
      errorMessage:
        'partial trace coverage: rejected 2 span(s): 1 from unsupported source, 1 without source/session context',
    });
  });

  it('notifies the receiver callback with null after a fully accepted export', async () => {
    const store = openMemoryStore();
    const onPartialSuccess = vi.fn<(partialSuccess: import('./agent-trace-receiver').AgentTracePartialSuccess | null) => void>();
    const receiver = await startReceiver({ store, port: 0, onPartialSuccess });

    const response = await fetch(`${receiver.endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf' },
      body: encodeTraceRequest({
        serviceName: 'copilot-chat',
        spans: [
          makeSpan({
            traceId: 'c0112233445566778899aabbccddeeff',
            spanId: '1111222233334444',
            name: 'invoke_agent copilot',
            attributes: [attribute('gen_ai.conversation.id', 'conversation-1')],
          }),
          makeSpan({
            traceId: 'c0112233445566778899aabbccddeeff',
            spanId: '5555666677778888',
            parentSpanId: '1111222233334444',
            name: 'execute_tool runCommand',
            attributes: [attribute('gen_ai.tool.name', 'runCommand')],
          }),
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(onPartialSuccess).toHaveBeenCalledTimes(1);
    expect(onPartialSuccess).toHaveBeenCalledWith(null);
  });

  it('returns 413 when a chunked request body exceeds the 8 MiB limit', async () => {
    const receiver = await startReceiver({ store: openMemoryStore(), port: 0 });

    const response = await sendChunkedRequest(receiver.endpoint, [
      Buffer.alloc(BODY_LIMIT_BYTES, 0x61),
      Buffer.from([0x62]),
    ]);

    expect(response.statusCode).toBe(413);
    expect(response.body.length).toBe(0);
  });

  it('closes an oversized in-flight stream promptly so shutdown does not hang on the socket', async () => {
    const receiver = await startReceiver({ store: openMemoryStore(), port: 0 });
    const request = openStreamingRequest(receiver.endpoint);
    const responsePromise = readStreamingResponse(request);
    const closedPromise = onceRequestClosed(request);

    request.write(Buffer.alloc(BODY_LIMIT_BYTES, 0x61));
    request.write(Buffer.from([0x62]));

    const response = await responsePromise;
    expect(response.statusCode).toBe(413);
    expect(response.body.length).toBe(0);

    await expect(Promise.race([
      receiver.close().then(() => 'closed'),
      delay(500).then(() => 'timed-out'),
    ])).resolves.toBe('closed');
    await expect(Promise.race([
      closedPromise.then(() => 'closed'),
      delay(500).then(() => 'timed-out'),
    ])).resolves.toBe('closed');
  });

  it('fails to start when the requested loopback port is already in use', async () => {
    const server = http.createServer((_request, response) => {
      response.statusCode = 204;
      response.end();
    });
    openServers.add(server);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const port = (server.address() as AddressInfo).port;

    await expect(startReceiver({ store: openMemoryStore(), port })).rejects.toThrow(/EADDRINUSE/i);
  });

  it('closes idempotently and stops accepting requests', async () => {
    const receiver = await startReceiver({ store: openMemoryStore(), port: 0 });

    await expect(receiver.close()).resolves.toBeUndefined();
    await expect(receiver.close()).resolves.toBeUndefined();

    await expect(fetch(`${receiver.endpoint}/v1/traces`, { method: 'POST' })).rejects.toThrow();
  });
});

function openMemoryStore(): AgentTraceStore {
  const store = openAgentTraceStore(':memory:');
  store.setCollectionEnabled(true);
  openStores.add(store);
  return store;
}

function makeStoreDouble(overrides: {
  insertSpans: AgentTraceStore['insertSpans'];
  getCollectionEnabled?: AgentTraceStore['getCollectionEnabled'];
}): AgentTraceStore {
  return {
    insertSpans: overrides.insertSpans,
    getSession: () => ({
      source: 'vscode',
      sessionId: 'vscode:conversation-1',
      availability: 'not-collected',
      spans: [],
    }),
    getCollectionEnabled: overrides.getCollectionEnabled ?? (() => true),
    setCollectionEnabled: () => undefined,
    pruneExpired: () => undefined,
    clear: () => undefined,
    close: () => undefined,
  };
}

async function startReceiver(options: Parameters<typeof import('./agent-trace-receiver').startAgentTraceReceiver>[0]) {
  const { startAgentTraceReceiver } = await import('./agent-trace-receiver');
  const receiver = await startAgentTraceReceiver(options);
  openReceivers.add(receiver);
  return receiver;
}

function decodeTraceResponse(body: Uint8Array) {
  return ExportTraceServiceResponse.decode(body);
}

function encodeTraceRequest(input: {
  serviceName?: string;
  spans?: ReturnType<typeof makeSpan>[];
  resourceSpans?: Array<{
    resource: { attributes: ReturnType<typeof attribute>[] };
    scopeSpans: Array<{ spans: ReturnType<typeof makeSpan>[] }>;
  }>;
}): BodyInit {
  const resourceSpans = input.resourceSpans ?? [{
    resource: {
      attributes: [attribute('service.name', input.serviceName ?? 'copilot-chat')],
    },
    scopeSpans: [{ spans: input.spans ?? [] }],
  }];

  const payload = ExportTraceServiceRequest.encode(
    ExportTraceServiceRequest.fromObject({ resourceSpans }),
  ).finish();
  return Buffer.from(payload) as unknown as BodyInit;
}

function makeSpan(input: {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  attributes: ReturnType<typeof attribute>[];
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  statusCode?: number;
}) {
  return {
    traceId: hexBytes(input.traceId),
    spanId: hexBytes(input.spanId),
    parentSpanId: input.parentSpanId ? hexBytes(input.parentSpanId) : undefined,
    name: input.name,
    startTimeUnixNano: input.startTimeUnixNano ?? '1780000000000000000',
    endTimeUnixNano: input.endTimeUnixNano ?? '1780000000100000000',
    attributes: input.attributes,
    status: input.statusCode === undefined ? undefined : { code: input.statusCode },
  };
}

function attribute(key: string, stringValue: string) {
  return {
    key,
    value: { stringValue },
  };
}

function hexBytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'hex'));
}

async function sendChunkedRequest(endpoint: string, chunks: Buffer[]): Promise<{ statusCode: number; body: Buffer }> {
  const request = openStreamingRequest(endpoint);
  const responsePromise = readStreamingResponse(request);

  for (const chunk of chunks) {
    request.write(chunk);
  }
  request.end();

  return responsePromise;
}

function openStreamingRequest(endpoint: string): http.ClientRequest {
  const url = new URL(`${endpoint}/v1/traces`);

  return http.request({
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    headers: {
      'content-type': 'application/x-protobuf',
    },
  });
}

function readStreamingResponse(request: http.ClientRequest): Promise<{ statusCode: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    request.on('response', (response) => {
      const bodyChunks: Buffer[] = [];
      response.on('data', (chunk) => {
        bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          body: Buffer.concat(bodyChunks),
        });
      });
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}

function onceRequestClosed(request: http.ClientRequest): Promise<void> {
  return new Promise((resolve) => {
    request.once('close', () => resolve());
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
