import { opentelemetry } from './agent-trace-proto.generated';
import type { AgentTraceCategory, AgentTraceSource } from '../shared/types';

type AnyValue = opentelemetry.proto.common.v1.AnyValue | null | undefined;
type KeyValue = opentelemetry.proto.common.v1.KeyValue.$Properties;
type ResourceSpans = opentelemetry.proto.trace.v1.ResourceSpans & opentelemetry.proto.trace.v1.ResourceSpans.$Shape;
type Span = opentelemetry.proto.trace.v1.Span & opentelemetry.proto.trace.v1.Span.$Shape;

interface DecodedSpanEnvelope {
  resourceServiceName: string | null;
  attributes: Map<string, unknown>;
  decoded: DecodedAgentTraceSpan;
}

export type DecodedAgentTraceSourceResolution = 'supported' | 'unsupported' | 'missing';

const RESOURCE_ATTRIBUTE_ALLOWLIST = new Set([
  'service.name',
]);

const SPAN_ATTRIBUTE_ALLOWLIST = new Set([
  'gen_ai.agent.name',
  'gen_ai.conversation.id',
  'gen_ai.operation.name',
  'gen_ai.request.model',
  'gen_ai.response.model',
  'gen_ai.tool.name',
  'gen_ai.tool.call.id',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
  'gen_ai.error.type',
  'github.copilot.agent.type',
  'github.copilot.tool.parameters.command',
  'github.copilot.tool.parameters.file_path',
  'github.copilot.tool.parameters.skill_name',
]);

export interface DecodedAgentTraceSpan {
  source: AgentTraceSource | null;
  sourceResolution: DecodedAgentTraceSourceResolution;
  conversationId: string | null;
  sessionId: string | null;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  category: AgentTraceCategory;
  toolName: string | null;
  skillName: string | null;
  model: string | null;
  startedAtNs: string;
  endedAtNs: string;
  status: 'unset' | 'ok' | 'error';
  errorType: string | null;
  toolCallId: string | null;
  argumentsValue: unknown;
  result: unknown;
}

const ExportTraceServiceRequest = opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;

export function decodeOtlpTraceRequest(body: Uint8Array): DecodedAgentTraceSpan[] {
  let request: opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;
  try {
    request = ExportTraceServiceRequest.decode(body);
  } catch (error) {
    throw new Error(`Failed to decode OTLP trace request: ${getErrorMessage(error)}`);
  }

  const envelopes = (request.resourceSpans ?? []).flatMap((resourceSpans) => decodeResourceSpans(resourceSpans));
  const traceGroups = groupByTraceId(envelopes);

  for (const group of traceGroups.values()) {
    applyTraceMetadata(group);
  }

  return envelopes.map((envelope) => envelope.decoded);
}

function decodeResourceSpans(resourceSpans: ResourceSpans): DecodedSpanEnvelope[] {
  const resourceAttributes = collectAttributes(
    resourceSpans.resource?.attributes ?? [],
    RESOURCE_ATTRIBUTE_ALLOWLIST,
  );
  const resourceServiceName = asString(resourceAttributes.get('service.name'));

  return (resourceSpans.scopeSpans ?? []).flatMap((scopeSpans) => (
    (scopeSpans.spans ?? []).map((span) => decodeSpan(span, resourceServiceName))
  ));
}

function decodeSpan(span: Span, resourceServiceName: string | null): DecodedSpanEnvelope {
  const traceId = decodeRequiredId(span.traceId, 16, 'trace');
  const spanId = decodeRequiredId(span.spanId, 8, 'span');
  const parentSpanId = decodeOptionalId(span.parentSpanId, 8, 'parent span');
  const attributes = collectAttributes(span.attributes ?? [], SPAN_ATTRIBUTE_ALLOWLIST);
  const skillName = asString(attributes.get('github.copilot.tool.parameters.skill_name'));
  const category = classifySpan(span.name, attributes, skillName);
  const startedAtNs = normalizeNanoseconds(span.startTimeUnixNano);
  const endedAtNs = normalizeNanoseconds(span.endTimeUnixNano);

  validateSpanRange(startedAtNs, endedAtNs);

  return {
    resourceServiceName,
    attributes,
    decoded: {
      source: null,
      sourceResolution: 'missing',
      conversationId: null,
      sessionId: null,
      traceId,
      spanId,
      parentSpanId,
      name: span.name,
      category,
      toolName: asString(attributes.get('gen_ai.tool.name')),
      skillName,
      model: asString(attributes.get('gen_ai.request.model'))
        ?? asString(attributes.get('gen_ai.response.model')),
      startedAtNs,
      endedAtNs,
      status: decodeStatus(span.status?.code),
      errorType: asString(attributes.get('gen_ai.error.type')),
      toolCallId: asString(attributes.get('gen_ai.tool.call.id')),
      argumentsValue: attributes.has('gen_ai.tool.call.arguments')
        ? attributes.get('gen_ai.tool.call.arguments')
        : null,
      result: attributes.has('gen_ai.tool.call.result')
        ? attributes.get('gen_ai.tool.call.result')
        : null,
    },
  };
}

function applyTraceMetadata(group: DecodedSpanEnvelope[]): void {
  const rootSpan = findRootSpan(group);
  const { source, resolution } = resolveSource(rootSpan?.resourceServiceName ?? null);
  const conversationId = asString(rootSpan?.attributes.get('gen_ai.conversation.id'));
  const sessionId = buildSessionId(source, conversationId);

  for (const envelope of group) {
    envelope.decoded.source = source;
    envelope.decoded.sourceResolution = resolution;
    envelope.decoded.conversationId = conversationId;
    envelope.decoded.sessionId = sessionId;
  }
}

function findRootSpan(group: DecodedSpanEnvelope[]): DecodedSpanEnvelope | undefined {
  const spanIds = new Set(group.map((entry) => entry.decoded.spanId));
  const rootCandidates = group.filter((entry) => (
    entry.decoded.parentSpanId === null
    || !spanIds.has(entry.decoded.parentSpanId)
  ));

  return rootCandidates.find((entry) => isRecognizedConversationRoot(entry))
    ?? rootCandidates.find((entry) => isConversationRoot(entry))
    ?? rootCandidates.find((entry) => (
      hasSupportedSource(entry.resourceServiceName)
      && entry.attributes.has('gen_ai.conversation.id')
    ))
    ?? rootCandidates.find((entry) => entry.attributes.has('gen_ai.conversation.id'))
    ?? rootCandidates.find((entry) => entry.decoded.category === 'agent')
    ?? rootCandidates.find((entry) => hasSupportedSource(entry.resourceServiceName))
    ?? rootCandidates[0]
    ?? group[0];
}

function isRecognizedConversationRoot(entry: DecodedSpanEnvelope): boolean {
  return hasSupportedSource(entry.resourceServiceName)
    && isConversationRoot(entry);
}

function isConversationRoot(entry: DecodedSpanEnvelope): boolean {
  return entry.decoded.category === 'agent'
    && asString(entry.attributes.get('gen_ai.conversation.id')) !== null;
}

function hasSupportedSource(serviceName: string | null): boolean {
  return resolveSource(serviceName).resolution === 'supported';
}

function resolveSource(serviceName: string | null): {
  source: AgentTraceSource | null;
  resolution: DecodedAgentTraceSourceResolution;
} {
  if (serviceName === 'copilot-chat') {
    return { source: 'vscode', resolution: 'supported' };
  }
  if (serviceName === 'github-copilot') {
    return { source: 'copilot-cli', resolution: 'supported' };
  }
  return serviceName === null
    ? { source: null, resolution: 'missing' }
    : { source: null, resolution: 'unsupported' };
}

function buildSessionId(
  source: AgentTraceSource | null,
  conversationId: string | null,
): string | null {
  if (source === null || conversationId === null) {
    return null;
  }
  return source === 'vscode' ? `vscode:${conversationId}` : conversationId;
}

function classifySpan(
  name: string,
  attributes: Map<string, unknown>,
  skillName: string | null,
): AgentTraceCategory {
  if (name.startsWith('invoke_agent')) {
    return 'agent';
  }
  if (name.startsWith('chat')) {
    return 'llm';
  }
  if (name.startsWith('execute_hook')) {
    return 'hook';
  }
  if (name.startsWith('execute_tool')) {
    if (skillName !== null) {
      return 'skill';
    }
    if (typeof attributes.get('github.copilot.tool.parameters.command') === 'string') {
      return 'shell';
    }
    return 'tool';
  }
  return 'other';
}

function decodeStatus(code: number | null | undefined): 'unset' | 'ok' | 'error' {
  if (code === 1) {
    return 'ok';
  }
  if (code === 2) {
    return 'error';
  }
  return 'unset';
}

function collectAttributes(
  attributes: readonly KeyValue[],
  allowlist: ReadonlySet<string>,
): Map<string, unknown> {
  const map = new Map<string, unknown>();

  for (const attribute of attributes) {
    if (!attribute.key || !allowlist.has(attribute.key)) {
      continue;
    }
    map.set(attribute.key, decodeAnyValue(attribute.value));
  }

  return map;
}

function decodeAnyValue(value: AnyValue): unknown {
  if (value == null || value.value == null) {
    return null;
  }

  switch (value.value) {
    case 'stringValue':
      return value.stringValue ?? null;
    case 'boolValue':
      return value.boolValue ?? null;
    case 'intValue':
      return value.intValue == null ? null : longToString(value.intValue);
    case 'doubleValue':
      return value.doubleValue ?? null;
    case 'arrayValue':
      return value.arrayValue?.values?.map((entry) => decodeAnyValue(entry)) ?? [];
    case 'kvlistValue':
      return Object.fromEntries(
        (value.kvlistValue?.values ?? [])
          .filter((entry) => Boolean(entry.key))
          .map((entry) => [entry.key as string, decodeAnyValue(entry.value)]),
      );
    case 'bytesValue':
      return value.bytesValue == null ? null : Buffer.from(value.bytesValue).toString('base64');
    case 'stringValueStrindex':
      return value.stringValueStrindex ?? null;
    default:
      return null;
  }
}

function normalizeNanoseconds(value: number | { toString(): string } | null | undefined): string {
  if (value == null) {
    throw new Error('Span timestamp is missing');
  }
  const normalized = longToString(value);
  BigInt(normalized);
  return normalized;
}

function validateSpanRange(startedAtNs: string, endedAtNs: string): void {
  const startedAtMs = BigInt(startedAtNs) / 1_000_000n;
  const endedAtMs = BigInt(endedAtNs) / 1_000_000n;
  const startedAt = new Date(Number(startedAtMs));
  const endedAt = new Date(Number(endedAtMs));

  if (Number.isNaN(startedAt.valueOf()) || Number.isNaN(endedAt.valueOf())) {
    throw new Error('Span timestamp is invalid');
  }
  if (BigInt(endedAtNs) < BigInt(startedAtNs)) {
    throw new Error('Span end timestamp is earlier than start timestamp');
  }
}

function decodeRequiredId(
  value: Uint8Array | null | undefined,
  size: number,
  label: 'trace' | 'span',
): string {
  const bytes = normalizeIdBytes(value, size, label);
  if (bytes.every((byte) => byte === 0)) {
    throw new Error(`Invalid ${label} id: all-zero ${label} ids are not allowed`);
  }
  return Buffer.from(bytes).toString('hex');
}

function decodeOptionalId(
  value: Uint8Array | null | undefined,
  size: number,
  label: 'parent span',
): string | null {
  if (value == null || value.length === 0) {
    return null;
  }
  const bytes = normalizeIdBytes(value, size, label);
  if (bytes.every((byte) => byte === 0)) {
    return null;
  }
  return Buffer.from(bytes).toString('hex');
}

function normalizeIdBytes(
  value: Uint8Array | null | undefined,
  size: number,
  label: 'trace' | 'span' | 'parent span',
): Uint8Array {
  if (value == null) {
    throw new Error(`Invalid ${label} id: missing bytes`);
  }
  if (value.length !== size) {
    throw new Error(`Invalid ${label} id: expected ${size} bytes but received ${value.length}`);
  }
  return value;
}

function groupByTraceId(envelopes: readonly DecodedSpanEnvelope[]): Map<string, DecodedSpanEnvelope[]> {
  const groups = new Map<string, DecodedSpanEnvelope[]>();

  for (const envelope of envelopes) {
    const existing = groups.get(envelope.decoded.traceId);
    if (existing) {
      existing.push(envelope);
      continue;
    }
    groups.set(envelope.decoded.traceId, [envelope]);
  }

  return groups;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function longToString(value: number | { toString(): string }): string {
  return typeof value === 'number' ? String(value) : value.toString();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
