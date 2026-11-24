// Drives named sequences of real HTTP requests and lifecycle calls through the TypeScript localhost receiver and agent
// trace service. For every step it records the result, the callbacks the step fired, and for each request the exact
// wire bytes and the response. The output is the fixture `rust/agent_trace_receiver/tests/fixtures/scenarios.json`,
// which the Rust port replays step for step.
// Usage: node reference/dist/scenarios/scenarios/agent-trace-receiver-scenarios.js <output path> <work dir>

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import Long from 'long';
import { opentelemetry } from '../src/agent-trace-proto.generated';
import {
  startAgentTraceReceiver,
  type AgentTraceExportRejection,
  type AgentTracePartialSuccess,
  type AgentTraceReceiver,
} from '../src/agent-trace-receiver';
import {
  createAgentTraceService,
  type AgentTraceServiceDependencies,
  type AgentTraceService,
} from '../src/agent-trace-service';
import { openAgentTraceStore, type AgentTraceStore } from '../src/agent-trace-store';
import type { AgentTraceSelection } from '../src/shared/types';

const { ExportTraceServiceRequest } = opentelemetry.proto.collector.trace.v1;

const ENDPOINT_TOKEN = '<endpoint>';
const TRACE_ONE = '0af7651916cd43dd8448eb211c80319c';
const ROOT_ONE = 'b7ad6b7169203331';
const CHILD_ONE = '00f067aa0ba902b7';
const ORPHAN_PARENT = 'f0f0f0f0f0f0f0f0';

interface SpanSpec {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startNs?: string;
  endNs?: string;
  attributes?: Record<string, string>;
}

type BodySpec =
  | { kind: 'otlp'; resource: string | null; spans: SpanSpec[]; truncateTo?: number }
  | { kind: 'empty' }
  | { kind: 'text'; text: string };

type Step =
  | { call: 'startReceiver'; dbPath: string; pendingTtlMs?: number }
  | { call: 'request'; method?: string; path?: string; contentType?: string | null; headers?: Record<string, string>; body: BodySpec | null; target?: 'receiver' | 'service' }
  | { call: 'wait'; ms: number }
  | { call: 'discardPending' }
  | { call: 'getSession'; selection: AgentTraceSelection }
  | { call: 'closeReceiver' }
  | { call: 'serviceCreate'; userDataDir: string; receiverFailure?: string; storeFailure?: string }
  | { call: 'serviceInitialize' }
  | { call: 'serviceStatus' }
  | { call: 'serviceSetEnabled'; enabled: boolean }
  | { call: 'serviceGetSession'; selection: AgentTraceSelection }
  | { call: 'serviceClear' }
  | { call: 'serviceShutdown' };

interface Scenario {
  name: string;
  steps: Step[];
}

interface Event {
  event: 'partialSuccess' | 'exportRejected';
  value: AgentTracePartialSuccess | AgentTraceExportRejection | null;
}

interface State {
  folder: string;
  events: Event[];
  store: AgentTraceStore | null;
  receiver: AgentTraceReceiver | null;
  service: AgentTraceService | null;
}

type Outcome = { ok: unknown } | { error: string };

function at(iso: string): string {
  return (BigInt(Date.parse(iso)) * 1_000_000n).toString();
}

function span(fields: Pick<SpanSpec, 'traceId' | 'spanId' | 'name'> & Partial<SpanSpec>): SpanSpec {
  return {
    startNs: at('2026-11-23T10:00:01.000Z'),
    endNs: at('2026-11-23T10:00:02.000Z'),
    attributes: {},
    ...fields,
  };
}

function root(traceId: string, spanId: string, conversationId: string): SpanSpec {
  return span({
    traceId,
    spanId,
    name: 'invoke_agent copilot',
    startNs: at('2026-11-23T10:00:00.000Z'),
    endNs: at('2026-11-23T10:00:05.000Z'),
    attributes: { 'gen_ai.conversation.id': conversationId },
  });
}

function tool(traceId: string, spanId: string, parentSpanId: string, conversationId: string): SpanSpec {
  return span({
    traceId,
    spanId,
    parentSpanId,
    name: 'execute_tool grep',
    attributes: {
      'gen_ai.conversation.id': conversationId,
      'gen_ai.tool.name': 'grep',
      'gen_ai.tool.call.id': 'call-1',
    },
  });
}

function keyValue(key: string, value: string) {
  return { key, value: { stringValue: value } };
}

function toProtoSpan(spec: SpanSpec) {
  return {
    traceId: Buffer.from(spec.traceId, 'hex'),
    spanId: Buffer.from(spec.spanId, 'hex'),
    parentSpanId: spec.parentSpanId === undefined ? undefined : Buffer.from(spec.parentSpanId, 'hex'),
    name: spec.name,
    startTimeUnixNano: spec.startNs === undefined ? undefined : Long.fromString(spec.startNs, true),
    endTimeUnixNano: spec.endNs === undefined ? undefined : Long.fromString(spec.endNs, true),
    attributes: Object.entries(spec.attributes ?? {}).map(([key, value]) => keyValue(key, value)),
  };
}

function buildBody(spec: BodySpec): Buffer {
  switch (spec.kind) {
    case 'empty':
      return Buffer.alloc(0);
    case 'text':
      return Buffer.from(spec.text, 'utf8');
    case 'otlp': {
      const message = ExportTraceServiceRequest.create({
        resourceSpans: [{
          resource: spec.resource === null ? undefined : { attributes: [keyValue('service.name', spec.resource)] },
          scopeSpans: [{ spans: spec.spans.map(toProtoSpan) }],
        }],
      });
      const bytes = Buffer.from(ExportTraceServiceRequest.encode(message).finish());
      return spec.truncateTo === undefined ? bytes : bytes.subarray(0, spec.truncateTo);
    }
  }
}

interface WireRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  bodyBase64: string | null;
}

interface WireResponse {
  status: number;
  contentType: string | null;
  bodyBase64: string;
}

function buildWire(step: Extract<Step, { call: 'request' }>): WireRequest {
  const body = step.body === null ? null : buildBody(step.body);
  const headers: Record<string, string> = { host: '127.0.0.1' };
  if (step.contentType !== null) {
    headers['content-type'] = step.contentType ?? 'application/x-protobuf';
  }
  if (body !== null) {
    headers['content-length'] = String(body.length);
  }
  return {
    method: step.method ?? 'POST',
    path: step.path ?? '/v1/traces',
    headers: { ...headers, ...step.headers },
    bodyBase64: body === null ? null : body.toString('base64'),
  };
}

function sendWire(endpoint: string, wire: WireRequest): Promise<WireResponse> {
  const { port } = new URL(endpoint);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: wire.method,
      path: wire.path,
      headers: wire.headers,
      agent: false,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        contentType: res.headers['content-type'] ?? null,
        bodyBase64: Buffer.concat(chunks).toString('base64'),
      }));
    });
    req.on('error', reject);
    req.end(wire.bodyBase64 === null ? undefined : Buffer.from(wire.bodyBase64, 'base64'));
  });
}

function requireReceiver(state: State): AgentTraceReceiver {
  if (!state.receiver) {
    throw new Error('no receiver is running in this scenario');
  }
  return state.receiver;
}

function requireService(state: State): AgentTraceService {
  if (!state.service) {
    throw new Error('no service exists in this scenario');
  }
  return state.service;
}

function endpointToken<T extends { endpoint: string | null }>(status: T): T {
  return status.endpoint === null ? status : { ...status, endpoint: ENDPOINT_TOKEN };
}

async function startReceiver(step: Extract<Step, { call: 'startReceiver' }>, state: State): Promise<AgentTraceReceiver> {
  state.store = openAgentTraceStore(path.join(state.folder, step.dbPath));
  return await startAgentTraceReceiver({
    store: state.store,
    port: 0,
    correlation: step.pendingTtlMs === undefined ? undefined : { pendingTtlMs: step.pendingTtlMs },
    onPartialSuccess: (value) => state.events.push({ event: 'partialSuccess', value }),
    onExportRejected: (value) => state.events.push({ event: 'exportRejected', value }),
  });
}

async function execute(step: Step, state: State): Promise<unknown> {
  switch (step.call) {
    case 'startReceiver':
      state.receiver = await startReceiver(step, state);
      return null;
    case 'request': {
      const wire = buildWire(step);
      const endpoint = step.target === 'service'
        ? requireService(state).getStatus().endpoint
        : requireReceiver(state).endpoint;
      if (endpoint === null) {
        throw new Error('the service is not listening');
      }
      return { wire, response: await sendWire(endpoint, wire) };
    }
    case 'wait':
      await new Promise((resolve) => setTimeout(resolve, step.ms));
      return null;
    case 'discardPending':
      requireReceiver(state).discardPending();
      return null;
    case 'getSession':
      return state.store!.getSession(step.selection);
    case 'closeReceiver':
      await requireReceiver(state).close();
      state.receiver = null;
      state.store?.close();
      return null;
    case 'serviceCreate': {
      const deps: Partial<AgentTraceServiceDependencies> = {
        receiverFactory: step.receiverFailure === undefined
          ? (options) => startAgentTraceReceiver({ ...options, port: 0 })
          : async () => {
            throw new Error(step.receiverFailure);
          },
      };
      if (step.storeFailure !== undefined) {
        deps.storeFactory = () => {
          throw new Error(step.storeFailure);
        };
      }
      state.service = createAgentTraceService(path.join(state.folder, step.userDataDir), deps);
      return null;
    }
    case 'serviceInitialize':
      await requireService(state).initialize();
      return null;
    case 'serviceStatus':
      return endpointToken(requireService(state).getStatus());
    case 'serviceSetEnabled':
      return endpointToken(await requireService(state).setEnabled(step.enabled));
    case 'serviceGetSession':
      return requireService(state).getSession(step.selection);
    case 'serviceClear':
      requireService(state).clear();
      return null;
    case 'serviceShutdown':
      await requireService(state).shutdown();
      return null;
  }
}

async function perform(step: Step, state: State): Promise<Outcome> {
  try {
    return { ok: await execute(step, state) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const SCENARIOS: Scenario[] = [
  {
    name: 'receiver-http-contract',
    steps: [
      { call: 'startReceiver', dbPath: 'receiver.db' },
      {
        call: 'request',
        body: { kind: 'otlp', resource: 'github-copilot', spans: [root(TRACE_ONE, ROOT_ONE, 'sess-1'), tool(TRACE_ONE, CHILD_ONE, ROOT_ONE, 'sess-1')] },
      },
      { call: 'getSession', selection: { source: 'copilot-cli', sessionId: 'sess-1' } },
      {
        call: 'request',
        body: { kind: 'otlp', resource: 'github-copilot', spans: [tool('1111111111111111111111111111aaaa', '1111111111111111', ORPHAN_PARENT, 'sess-2')] },
      },
      { call: 'getSession', selection: { source: 'copilot-cli', sessionId: 'sess-2' } },
      {
        call: 'request',
        body: { kind: 'otlp', resource: 'github-copilot', spans: [root('1111111111111111111111111111aaaa', ORPHAN_PARENT, 'sess-2')] },
      },
      { call: 'getSession', selection: { source: 'copilot-cli', sessionId: 'sess-2' } },
      {
        call: 'request',
        body: { kind: 'otlp', resource: 'github-copilot', spans: [root(TRACE_ONE, ROOT_ONE, 'sess-1'), tool(TRACE_ONE, CHILD_ONE, ROOT_ONE, 'sess-1')], truncateTo: 20 },
      },
      { call: 'request', body: { kind: 'empty' } },
      { call: 'request', body: { kind: 'text', text: 'not protobuf' } },
      {
        call: 'request',
        body: { kind: 'otlp', resource: 'github-copilot', spans: [root('2222222222222222222222222222bbbb', '2222222222222222', 'sess-3')] },
      },
      {
        call: 'request',
        body: { kind: 'otlp', resource: 'unknown-app', spans: [root('3333333333333333333333333333cccc', '3333333333333333', 'sess-4')] },
      },
      {
        call: 'request',
        body: { kind: 'otlp', resource: 'github-copilot', spans: [span({ traceId: '4444444444444444444444444444dddd', spanId: '4444444444444444', name: 'invoke_agent copilot', startNs: at('2026-11-23T10:00:05.000Z'), endNs: at('2026-11-23T10:00:00.000Z'), attributes: { 'gen_ai.conversation.id': 'sess-5' } })] },
      },
      {
        call: 'request',
        body: { kind: 'otlp', resource: 'github-copilot', spans: [span({ traceId: '5555555555555555555555555555eeee', spanId: '5555555555555555', name: 'invoke_agent copilot', startNs: undefined, endNs: at('2026-11-23T10:00:00.000Z'), attributes: { 'gen_ai.conversation.id': 'sess-6' } })] },
      },
      {
        call: 'request',
        body: { kind: 'otlp', resource: 'github-copilot', spans: [span({ traceId: '6666', spanId: '6666666666666666', name: 'invoke_agent copilot', attributes: { 'gen_ai.conversation.id': 'sess-7' } })] },
      },
      { call: 'request', contentType: 'application/json', body: { kind: 'otlp', resource: 'github-copilot', spans: [root(TRACE_ONE, ROOT_ONE, 'sess-1')] } },
      { call: 'request', contentType: null, body: { kind: 'otlp', resource: 'github-copilot', spans: [root(TRACE_ONE, ROOT_ONE, 'sess-1')] } },
      { call: 'request', method: 'GET', body: null },
      { call: 'request', path: '/nope', body: { kind: 'empty' } },
      { call: 'request', headers: { origin: 'http://evil.example' }, body: { kind: 'empty' } },
      { call: 'request', headers: { host: 'evil.example' }, body: { kind: 'empty' } },
      { call: 'request', headers: { host: '127.0.0.1:1' }, body: { kind: 'empty' } },
      { call: 'getSession', selection: { source: 'copilot-cli', sessionId: 'sess-1' } },
      { call: 'closeReceiver' },
    ],
  },
  {
    name: 'receiver-expiry-and-discard',
    steps: [
      { call: 'startReceiver', dbPath: 'expiry.db', pendingTtlMs: 100 },
      {
        call: 'request',
        body: { kind: 'otlp', resource: 'github-copilot', spans: [tool('7777777777777777777777777777ffff', '7777777777777777', ORPHAN_PARENT, 'sess-8')] },
      },
      { call: 'wait', ms: 400 },
      { call: 'getSession', selection: { source: 'copilot-cli', sessionId: 'sess-8' } },
      {
        call: 'request',
        body: { kind: 'otlp', resource: 'github-copilot', spans: [tool('8888888888888888888888888888aaaa', '8888888888888888', ORPHAN_PARENT, 'sess-9')] },
      },
      { call: 'discardPending' },
      { call: 'wait', ms: 300 },
      { call: 'closeReceiver' },
      { call: 'getSession', selection: { source: 'copilot-cli', sessionId: 'sess-9' } },
    ],
  },
  {
    name: 'receiver-close-flushes-held',
    steps: [
      { call: 'startReceiver', dbPath: 'flush.db' },
      {
        call: 'request',
        body: { kind: 'otlp', resource: 'github-copilot', spans: [span({ traceId: '9999999999999999999999999999bbbb', spanId: '9999999999999999', parentSpanId: ORPHAN_PARENT, name: 'execute_tool grep' })] },
      },
      { call: 'closeReceiver' },
      { call: 'getSession', selection: { source: 'copilot-cli', sessionId: 'sess-10' } },
    ],
  },
  {
    name: 'service-lifecycle',
    steps: [
      { call: 'serviceCreate', userDataDir: 'service-a' },
      { call: 'serviceInitialize' },
      { call: 'serviceStatus' },
      { call: 'serviceSetEnabled', enabled: true },
      { call: 'request', target: 'service', body: { kind: 'otlp', resource: 'github-copilot', spans: [root(TRACE_ONE, ROOT_ONE, 'sess-1'), tool(TRACE_ONE, CHILD_ONE, ROOT_ONE, 'sess-1')] } },
      { call: 'serviceGetSession', selection: { source: 'copilot-cli', sessionId: 'sess-1' } },
      { call: 'request', target: 'service', body: { kind: 'otlp', resource: 'unknown-app', spans: [root('3333333333333333333333333333cccc', '3333333333333333', 'sess-4')] } },
      { call: 'serviceStatus' },
      { call: 'request', target: 'service', body: { kind: 'otlp', resource: 'github-copilot', spans: [root('2222222222222222222222222222bbbb', '2222222222222222', 'sess-3')] } },
      { call: 'serviceStatus' },
      { call: 'serviceSetEnabled', enabled: false },
      { call: 'serviceSetEnabled', enabled: true },
      { call: 'serviceClear' },
      { call: 'serviceGetSession', selection: { source: 'copilot-cli', sessionId: 'sess-1' } },
      { call: 'serviceShutdown' },
      { call: 'serviceStatus' },
      { call: 'serviceGetSession', selection: { source: 'copilot-cli', sessionId: 'sess-1' } },
    ],
  },
  {
    name: 'service-reopen-keeps-opt-in',
    steps: [
      { call: 'serviceCreate', userDataDir: 'service-b' },
      { call: 'serviceInitialize' },
      { call: 'serviceSetEnabled', enabled: true },
      { call: 'serviceShutdown' },
      { call: 'serviceCreate', userDataDir: 'service-b' },
      { call: 'serviceInitialize' },
      { call: 'serviceStatus' },
      { call: 'serviceShutdown' },
    ],
  },
  {
    name: 'service-receiver-start-failure',
    steps: [
      { call: 'serviceCreate', userDataDir: 'service-c', receiverFailure: 'listen EADDRINUSE: address already in use' },
      { call: 'serviceInitialize' },
      { call: 'serviceSetEnabled', enabled: true },
      { call: 'serviceStatus' },
      { call: 'serviceShutdown' },
    ],
  },
  {
    name: 'service-store-open-failure',
    steps: [
      { call: 'serviceCreate', userDataDir: 'service-d', storeFailure: 'disk unavailable' },
      { call: 'serviceInitialize' },
      { call: 'serviceStatus' },
      { call: 'serviceGetSession', selection: { source: 'copilot-cli', sessionId: 'sess-1' } },
      { call: 'serviceSetEnabled', enabled: true },
      { call: 'serviceShutdown' },
    ],
  },
];

async function runScenario(scenario: Scenario, workDir: string): Promise<unknown> {
  const folder = path.join(workDir, scenario.name);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });

  const state: State = { folder, events: [], store: null, receiver: null, service: null };
  const steps: unknown[] = [];
  for (const step of scenario.steps) {
    const outcome = await perform(step, state);
    const events = state.events.splice(0);
    steps.push({ ...step, result: outcome, events });
  }

  await state.receiver?.close();
  state.store?.close();
  await state.service?.shutdown();
  return { name: scenario.name, steps };
}

async function main(): Promise<void> {
  const [outputPath, workDir] = process.argv.slice(2);
  if (!outputPath || !workDir) {
    console.error('usage: node agent-trace-receiver-scenarios.js <output path> <work dir>');
    process.exit(2);
  }

  const recorded: unknown[] = [];
  for (const scenario of SCENARIOS) {
    recorded.push(await runScenario(scenario, workDir));
  }
  writeFileSync(outputPath, `${JSON.stringify(recorded, null, 2)}\n`);
}

void main();
