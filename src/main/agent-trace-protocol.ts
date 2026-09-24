import { opentelemetry } from './agent-trace-proto.generated';
import type { AgentTraceCategory, AgentTraceSource } from '../shared/types';

type AnyValue = opentelemetry.proto.common.v1.AnyValue.$Properties | null | undefined;
type KeyValue = opentelemetry.proto.common.v1.KeyValue.$Properties;
type ResourceSpans = opentelemetry.proto.trace.v1.ResourceSpans.$Properties;
type Span = opentelemetry.proto.trace.v1.Span.$Properties;

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
  'gen_ai.tool.type',
  'gen_ai.tool.call.id',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
  'gen_ai.error.type',
  'error.type',
  'copilot_chat.parent_chat_session_id',
  'github.copilot.agent.type',
  'github.copilot.tool.parameters.command',
  'github.copilot.tool.parameters.file_path',
  'github.copilot.tool.parameters.skill_name',
  'github.copilot.tool.parameters.mcp_tool_name',
]);

export interface DecodedAgentTraceSpan {
  /** Trace context taken from the trace root (parentless agent span) decoded in the same request. */
  source: AgentTraceSource | null;
  sourceResolution: DecodedAgentTraceSourceResolution;
  conversationId: string | null;
  sessionId: string | null;
  /** Whether the trace root that provides the context above was part of the same request. */
  traceRootInRequest: boolean;
  /** Source and conversation carried by the span itself, used only when no trace root arrives. */
  spanSource: AgentTraceSource | null;
  spanSourceResolution: DecodedAgentTraceSourceResolution;
  spanConversationId: string | null;
  spanParentConversationId: string | null;
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
  const category = classifySpan(span.name ?? '', attributes, skillName);
  const startedAtNs = normalizeNanoseconds(span.startTimeUnixNano);
  const endedAtNs = normalizeNanoseconds(span.endTimeUnixNano);
  const spanSource = resolveSource(resourceServiceName);

  validateSpanRange(startedAtNs, endedAtNs);

  return {
    resourceServiceName,
    attributes,
    decoded: {
      source: null,
      sourceResolution: spanSource.resolution,
      conversationId: null,
      sessionId: null,
      traceRootInRequest: false,
      spanSource: spanSource.source,
      spanSourceResolution: spanSource.resolution,
      spanConversationId: asNonEmptyString(attributes.get('gen_ai.conversation.id')),
      spanParentConversationId: asNonEmptyString(attributes.get('copilot_chat.parent_chat_session_id')),
      traceId,
      spanId,
      parentSpanId,
      name: span.name ?? '',
      category,
      toolName: asString(attributes.get('gen_ai.tool.name')),
      skillName,
      model: asString(attributes.get('gen_ai.request.model'))
        ?? asString(attributes.get('gen_ai.response.model')),
      startedAtNs,
      endedAtNs,
      status: decodeStatus(span.status?.code),
      errorType: asString(attributes.get('gen_ai.error.type')) ?? asString(attributes.get('error.type')),
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
  const traceRoot = findTraceRoot(group);
  if (!traceRoot) {
    return;
  }

  const { source, resolution } = resolveSource(traceRoot.resourceServiceName);
  const conversationId = asNonEmptyString(traceRoot.attributes.get('gen_ai.conversation.id'));
  const sessionId = buildAgentTraceSessionId(source, conversationId);

  for (const envelope of group) {
    envelope.decoded.source = source;
    envelope.decoded.sourceResolution = resolution;
    envelope.decoded.conversationId = conversationId;
    envelope.decoded.sessionId = sessionId;
    envelope.decoded.traceRootInRequest = true;
  }
}

// Only a parentless agent span anchors a trace. A span whose parent is merely absent from this
// request (for example a subagent) must not define the conversation of the whole trace.
function findTraceRoot(group: DecodedSpanEnvelope[]): DecodedSpanEnvelope | undefined {
  const parentlessAgents = group.filter((entry) => (
    entry.decoded.parentSpanId === null && entry.decoded.category === 'agent'
  ));

  return parentlessAgents.find((entry) => isRecognizedConversationRoot(entry))
    ?? parentlessAgents.find((entry) => asNonEmptyString(entry.attributes.get('gen_ai.conversation.id')) !== null)
    ?? parentlessAgents[0];
}

function isRecognizedConversationRoot(entry: DecodedSpanEnvelope): boolean {
  return resolveSource(entry.resourceServiceName).resolution === 'supported'
    && asNonEmptyString(entry.attributes.get('gen_ai.conversation.id')) !== null;
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

export function buildAgentTraceSessionId(
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
    if (isMcpTool(attributes)) {
      return 'mcp';
    }
    if (typeof attributes.get('github.copilot.tool.parameters.command') === 'string') {
      return 'shell';
    }
    return 'tool';
  }
  return 'other';
}

function isMcpTool(attributes: Map<string, unknown>): boolean {
  const toolType = asString(attributes.get('gen_ai.tool.type'));
  return asNonEmptyString(attributes.get('github.copilot.tool.parameters.mcp_tool_name')) !== null
    || toolType?.toLowerCase() === 'mcp';
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
      // Binary payloads are kept as bytes so the sanitizer fails closed instead of storing an encoding.
      return value.bytesValue == null ? null : Uint8Array.from(value.bytesValue);
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

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
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
