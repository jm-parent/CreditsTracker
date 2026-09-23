import type { DecodedAgentTraceSpan } from './agent-trace-protocol';
import type { AgentTraceSpan, AgentTraceContentState } from '../shared/types';

const MAX_CONTENT_BYTES = 32 * 1024;
const REDACTED = '[REDACTED]';
const FILTERED_KEYS = new Set(['prompt', 'response', 'system', 'message', 'messages', 'schema', 'attributes']);
const SENSITIVE_KEY_PARTS = ['token', 'secret', 'password', 'api_key', 'api-key', 'authorization'];

export function sanitizeAgentTraceSpan(span: DecodedAgentTraceSpan): AgentTraceSpan | null {
  if (!span.source || !span.sessionId || !span.conversationId) {
    return null;
  }

  try {
    const argumentsContent = sanitizeContent(span.argumentsValue);
    const resultContent = sanitizeContent(span.result);

    if (argumentsContent === null && resultContent === null) {
      return {
        source: span.source,
        sessionId: span.sessionId,
        traceId: span.traceId,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId,
        name: span.name,
        category: span.category,
        toolName: span.toolName,
        skillName: span.skillName,
        model: span.model,
        startedAt: nanosToIso(span.startedAtNs),
        endedAt: nanosToIso(span.endedAtNs),
        durationMs: nanosToDurationMs(span.startedAtNs, span.endedAtNs),
        status: span.status,
        errorType: span.errorType,
        toolCallId: span.toolCallId,
        argumentsJson: null,
        resultText: null,
        contentState: 'unavailable',
      };
    }

    const contentState = combineContentStates(argumentsContent?.state, resultContent?.state);

    return {
      source: span.source,
      sessionId: span.sessionId,
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      category: span.category,
      toolName: span.toolName,
      skillName: span.skillName,
      model: span.model,
      startedAt: nanosToIso(span.startedAtNs),
      endedAt: nanosToIso(span.endedAtNs),
      durationMs: nanosToDurationMs(span.startedAtNs, span.endedAtNs),
      status: span.status,
      errorType: span.errorType,
      toolCallId: span.toolCallId,
      argumentsJson: argumentsContent?.text ?? null,
      resultText: resultContent?.text ?? null,
      contentState,
    };
  } catch {
    return {
      source: span.source,
      sessionId: span.sessionId,
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      category: span.category,
      toolName: span.toolName,
      skillName: span.skillName,
      model: span.model,
      startedAt: nanosToIso(span.startedAtNs),
      endedAt: nanosToIso(span.endedAtNs),
      durationMs: nanosToDurationMs(span.startedAtNs, span.endedAtNs),
      status: span.status,
      errorType: span.errorType,
      toolCallId: span.toolCallId,
      argumentsJson: null,
      resultText: null,
      contentState: 'omitted',
    };
  }
}

function sanitizeContent(input: unknown): SanitizedContent | null {
  if (input == null) {
    return null;
  }

  if (typeof input === 'string') {
    const parsed = tryParseJson(input);
    if (parsed !== undefined && (Array.isArray(parsed) || isPlainObject(parsed))) {
      return serializeSanitizedJsonValue(parsed);
    }

    return sanitizeText(input);
  }

  if (isJsonContainer(input)) {
    return serializeSanitizedJsonValue(input);
  }

  if (isJsonSerializablePrimitive(input)) {
    return sanitizeText(JSON.stringify(input));
  }

  throw new Error('Unsupported content type');
}

function serializeSanitizedJsonValue(value: unknown): SanitizedContent {
  const sanitized = sanitizeJsonValue(value);
  const serialized = JSON.stringify(sanitized.value);
  if (serialized === undefined) {
    throw new Error('Structured content could not be serialized');
  }

  const truncated = truncateUtf8(serialized, MAX_CONTENT_BYTES);
  const state = combineContentStates(sanitized.state, truncated.truncated ? 'truncated' : undefined);
  return {
    text: truncated.text,
    state,
  };
}

function sanitizeJsonValue(value: unknown, seen = new WeakSet<object>()): { value: unknown; state: AgentTraceContentState } {
  if (value === null) {
    return { value: null, state: 'stored' };
  }

  switch (typeof value) {
    case 'string':
      return sanitizeJsonStringValue(value);
    case 'number':
    case 'boolean':
      return { value, state: 'stored' };
    case 'object':
      if (value instanceof Date) {
        return { value: value.toJSON(), state: 'stored' };
      }

      if (isBinaryView(value) || value instanceof ArrayBuffer) {
        throw new Error('Binary content cannot be serialized');
      }

      if (Array.isArray(value)) {
        if (seen.has(value)) {
          throw new Error('Circular content cannot be serialized');
        }
        seen.add(value);

        const items: unknown[] = [];
        let changed = false;
        for (const item of value) {
          if (item === undefined) {
            changed = true;
            continue;
          }

          const sanitizedItem = sanitizeJsonValue(item, seen);
          items.push(sanitizedItem.value);
          changed = changed || sanitizedItem.state !== 'stored';
        }

        seen.delete(value);
        return { value: items, state: changed ? 'redacted' : 'stored' };
      }

      if (!isPlainObject(value)) {
        throw new Error('Unsupported structured content');
      }

      if (seen.has(value)) {
        throw new Error('Circular content cannot be serialized');
      }
      seen.add(value);

      const output: Record<string, unknown> = {};
      let changed = false;

      for (const [key, rawValue] of Object.entries(value)) {
        if (FILTERED_KEYS.has(key.toLowerCase())) {
          changed = true;
          continue;
        }

        if (isSensitiveKey(key)) {
          output[key] = REDACTED;
          changed = true;
          continue;
        }

        if (rawValue === undefined) {
          changed = true;
          continue;
        }

        const sanitizedValue = sanitizeJsonValue(rawValue, seen);
        output[key] = sanitizedValue.value;
        changed = changed || sanitizedValue.state !== 'stored';
      }

      seen.delete(value);
      return { value: output, state: changed ? 'redacted' : 'stored' };
    default:
      throw new Error('Unsupported content type');
  }
}

function sanitizeJsonStringValue(value: string): { value: string; state: AgentTraceContentState } {
  const redacted = redactSensitiveText(value);
  if (redacted.state === 'stored') {
    return { value, state: 'stored' };
  }

  return { value: redacted.text, state: 'redacted' };
}

function sanitizeText(text: string): SanitizedContent {
  const redacted = redactSensitiveText(text);
  const truncated = truncateUtf8(redacted.text, MAX_CONTENT_BYTES);

  if (redacted.state === 'stored' && !truncated.truncated) {
    return { text: truncated.text, state: 'stored' };
  }

  if (redacted.state === 'redacted' && !truncated.truncated) {
    return { text: truncated.text, state: 'redacted' };
  }

  if (redacted.state === 'stored' && truncated.truncated) {
    return { text: truncated.text, state: 'truncated' };
  }

  return { text: truncated.text, state: 'redacted-truncated' };
}

function redactSensitiveText(text: string): SanitizedContent {
  let result = text;
  let changed = false;

  for (const { pattern, replacement } of REDACTION_RULES) {
    const next = result.replace(pattern, replacement);
    if (next !== result) {
      changed = true;
      result = next;
    }
  }

  return { text: result, state: changed ? 'redacted' : 'stored' };
}

const REDACTION_RULES: ReadonlyArray<{
  pattern: RegExp;
  replacement: string;
}> = [
  {
    pattern: /-----BEGIN(?: [^-]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [^-]+)? PRIVATE KEY-----/gi,
    replacement: REDACTED,
  },
  {
    pattern: /\bgh[pousr]_[A-Za-z0-9_]+\b/gi,
    replacement: REDACTED,
  },
  {
    pattern: /\bgithub_pat_[A-Za-z0-9_]+\b/gi,
    replacement: REDACTED,
  },
  {
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replacement: REDACTED,
  },
  {
    pattern: /\bBearer\s+[^\s"'`]+/gi,
    replacement: 'Bearer [REDACTED]',
  },
  {
    pattern: /\bAuthorization\s*:\s*[^\r\n]+/gi,
    replacement: 'Authorization: [REDACTED]',
  },
  {
    pattern: /\b(?:token|secret|password|api[_-]?key)\s*[:=]\s*[^\r\n,;]+/gi,
    replacement: REDACTED,
  },
];

function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return { text, truncated: false };
  }

  let bytes = 0;
  let truncatedText = '';

  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maxBytes) {
      break;
    }
    bytes += characterBytes;
    truncatedText += character;
  }

  return { text: truncatedText, truncated: true };
}

function combineContentStates(first?: AgentTraceContentState, second?: AgentTraceContentState): AgentTraceContentState {
  const states = [first, second].filter((state): state is AgentTraceContentState => state !== undefined);
  if (states.length === 0) {
    return 'unavailable';
  }

  if (states.includes('omitted')) {
    return 'omitted';
  }

  if (states.includes('redacted-truncated')) {
    return 'redacted-truncated';
  }

  if (states.includes('redacted')) {
    return 'redacted';
  }

  if (states.includes('truncated')) {
    return 'truncated';
  }

  return 'stored';
}

function nanosToIso(value: string): string {
  const milliseconds = BigInt(value) / 1_000_000n;
  return new Date(Number(milliseconds)).toISOString();
}

function nanosToDurationMs(startedAtNs: string, endedAtNs: string): number {
  return Number((BigInt(endedAtNs) - BigInt(startedAtNs)) / 1_000_000n);
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isBinaryView(value: object): value is ArrayBufferView {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

function isJsonSerializablePrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isJsonContainer(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

interface SanitizedContent {
  text: string;
  state: AgentTraceContentState;
}
