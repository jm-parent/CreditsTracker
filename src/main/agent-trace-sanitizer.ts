import type { DecodedAgentTraceSpan } from './agent-trace-protocol';
import type { AgentTraceContentState, AgentTraceSource, AgentTraceSpan } from '../shared/types';

const MAX_CONTENT_BYTES = 32 * 1024;
// Bounds the text scanned for secrets so a pathological payload cannot stall the main process.
const MAX_REDACTION_INPUT_BYTES = 256 * 1024;
const MAX_ERROR_TYPE_BYTES = 256;
const MAX_NESTED_JSON_DEPTH = 4;
const REDACTED = '[REDACTED]';
const FILTERED_KEYS = new Set(['prompt', 'response', 'system', 'message', 'messages', 'schema', 'attributes']);
const SENSITIVE_KEY_PARTS = [
  'token',
  'secret',
  'password',
  'passwd',
  'passphrase',
  'apikey',
  'authorization',
  'privatekey',
  'accesskey',
  'accountkey',
  'credential',
  'cookie',
];
const SENSITIVE_EXACT_KEYS = new Set(['auth', 'pass', 'pwd']);

export type UnattributedAgentTraceSpan = Omit<AgentTraceSpan, 'source' | 'sessionId'>;

export interface AgentTraceAttribution {
  source: AgentTraceSource;
  sessionId: string;
}

export function sanitizeAgentTraceSpan(span: DecodedAgentTraceSpan): AgentTraceSpan | null {
  if (!span.source || !span.sessionId || !span.conversationId) {
    return null;
  }

  return attributeAgentTraceSpan(sanitizeUnattributedAgentTraceSpan(span), {
    source: span.source,
    sessionId: span.sessionId,
  });
}

/**
 * Redacts and bounds a decoded span without deciding which conversation it belongs to, so the
 * receiver can hold only sanitized content while it waits for the trace root.
 */
export function sanitizeUnattributedAgentTraceSpan(span: DecodedAgentTraceSpan): UnattributedAgentTraceSpan {
  const metadata = {
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
    errorType: sanitizeErrorType(span.errorType),
    toolCallId: span.toolCallId,
  };

  try {
    const argumentsContent = sanitizeContent(span.argumentsValue);
    const resultContent = sanitizeContent(span.result);

    if (argumentsContent === null && resultContent === null) {
      return {
        ...metadata,
        argumentsJson: null,
        resultText: null,
        contentState: 'unavailable',
      };
    }

    return {
      ...metadata,
      argumentsJson: argumentsContent?.text ?? null,
      resultText: resultContent?.text ?? null,
      contentState: combineContentStates(argumentsContent?.state, resultContent?.state),
    };
  } catch {
    return {
      ...metadata,
      argumentsJson: null,
      resultText: null,
      contentState: 'omitted',
    };
  }
}

export function attributeAgentTraceSpan(
  span: UnattributedAgentTraceSpan,
  attribution: AgentTraceAttribution,
): AgentTraceSpan {
  return {
    source: attribution.source,
    sessionId: attribution.sessionId,
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    category: span.category,
    toolName: span.toolName,
    skillName: span.skillName,
    model: span.model,
    startedAt: span.startedAt,
    endedAt: span.endedAt,
    durationMs: span.durationMs,
    status: span.status,
    errorType: span.errorType,
    toolCallId: span.toolCallId,
    argumentsJson: span.argumentsJson,
    resultText: span.resultText,
    contentState: span.contentState,
  };
}

function sanitizeErrorType(errorType: string | null): string | null {
  if (errorType === null) {
    return null;
  }

  try {
    return truncateUtf8(redactSensitiveText(errorType).text, MAX_ERROR_TYPE_BYTES).text;
  } catch {
    return null;
  }
}

function sanitizeContent(input: unknown): SanitizedContent | null {
  if (input == null) {
    return null;
  }

  if (typeof input === 'string') {
    const parsed = tryParseJson(input);
    if (parsed !== undefined && parsed !== null && (Array.isArray(parsed) || isPlainObject(parsed))) {
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
  const sanitized = sanitizeJsonValue(value, 0);
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

function sanitizeJsonValue(
  value: unknown,
  depth: number,
  seen = new WeakSet<object>(),
): { value: unknown; state: AgentTraceContentState } {
  if (value === null) {
    return { value: null, state: 'stored' };
  }

  switch (typeof value) {
    case 'string':
      return sanitizeJsonStringValue(value, depth);
    case 'number':
    case 'boolean':
      return { value, state: 'stored' };
    case 'object': {
      if (value instanceof Date) {
        return { value: value.toJSON(), state: 'stored' };
      }

      if (isBinaryView(value) || value instanceof ArrayBuffer) {
        throw new Error('Binary content cannot be serialized');
      }

      if (seen.has(value)) {
        throw new Error('Circular content cannot be serialized');
      }

      if (Array.isArray(value)) {
        seen.add(value);

        const items: unknown[] = [];
        let state: AgentTraceContentState = 'stored';
        for (const item of value) {
          if (item === undefined) {
            state = combineContentStates(state, 'redacted');
            continue;
          }

          const sanitizedItem = sanitizeJsonValue(item, depth, seen);
          items.push(sanitizedItem.value);
          state = combineContentStates(state, sanitizedItem.state);
        }

        seen.delete(value);
        return { value: items, state };
      }

      if (!isPlainObject(value)) {
        throw new Error('Unsupported structured content');
      }

      seen.add(value);

      const output: Record<string, unknown> = {};
      let state: AgentTraceContentState = 'stored';

      for (const [key, rawValue] of Object.entries(value)) {
        if (FILTERED_KEYS.has(key.toLowerCase()) || rawValue === undefined) {
          state = combineContentStates(state, 'redacted');
          continue;
        }

        if (isSensitiveKey(key)) {
          output[key] = REDACTED;
          state = combineContentStates(state, 'redacted');
          continue;
        }

        const sanitizedValue = sanitizeJsonValue(rawValue, depth, seen);
        output[key] = sanitizedValue.value;
        state = combineContentStates(state, sanitizedValue.state);
      }

      seen.delete(value);
      return { value: output, state };
    }
    default:
      throw new Error('Unsupported content type');
  }
}

function sanitizeJsonStringValue(value: string, depth: number): { value: string; state: AgentTraceContentState } {
  // Tool payloads often carry JSON encoded inside a string; sanitize it structurally so key rules apply.
  const nested = depth < MAX_NESTED_JSON_DEPTH ? parseJsonContainer(value) : undefined;
  if (nested !== undefined) {
    const sanitized = sanitizeJsonValue(nested, depth + 1);
    if (sanitized.state !== 'stored') {
      const serialized = JSON.stringify(sanitized.value);
      if (serialized === undefined) {
        throw new Error('Nested structured content could not be serialized');
      }
      return { value: serialized, state: sanitized.state };
    }
  }

  const redacted = redactBoundedText(value);
  return { value: redacted.text, state: redacted.state };
}

function sanitizeText(text: string): SanitizedContent {
  const redacted = redactBoundedText(text);
  const truncated = truncateUtf8(redacted.text, MAX_CONTENT_BYTES);

  return {
    text: truncated.text,
    state: combineContentStates(redacted.state, truncated.truncated ? 'truncated' : undefined),
  };
}

function redactBoundedText(text: string): SanitizedContent {
  const bounded = truncateUtf8(text, MAX_REDACTION_INPUT_BYTES);
  const redacted = redactSensitiveText(bounded.text);

  return {
    text: redacted.text,
    state: combineContentStates(redacted.state, bounded.truncated ? 'truncated' : undefined),
  };
}

function redactSensitiveText(text: string): SanitizedContent {
  if (PRIVATE_KEY_BEGIN_PATTERN.test(text) && !PRIVATE_KEY_END_PATTERN.test(text)) {
    throw new Error('Private key material could not be bounded');
  }

  let result = text;
  let changed = false;

  for (const { pattern, replace } of REDACTION_RULES) {
    const next = typeof replace === 'string'
      ? result.replace(pattern, replace)
      : result.replace(pattern, replace);
    if (next !== result) {
      changed = true;
      result = next;
    }

    if (pattern === PRIVATE_KEY_BLOCK_PATTERN && PRIVATE_KEY_MARKER_PATTERN.test(result)) {
      // A private key header or footer without its matching boundary cannot be redacted safely.
      throw new Error('Private key material could not be bounded');
    }
  }

  return { text: result, state: changed ? 'redacted' : 'stored' };
}

const PRIVATE_KEY_BLOCK_PATTERN =
  /-----BEGIN[ A-Z0-9]{0,40}PRIVATE KEY[ A-Z0-9]{0,40}-----[\s\S]*?-----END[ A-Z0-9]{0,40}PRIVATE KEY[ A-Z0-9]{0,40}-----/gi;
const PRIVATE_KEY_MARKER_PATTERN = /-----(?:BEGIN|END)[ A-Z0-9]{0,40}PRIVATE KEY/i;
const PRIVATE_KEY_BEGIN_PATTERN = /-----BEGIN[ A-Z0-9]{0,40}PRIVATE KEY/i;
const PRIVATE_KEY_END_PATTERN = /-----END[ A-Z0-9]{0,40}PRIVATE KEY/i;

const SECRET_KEYWORDS = String.raw`token|secret|passw(?:or)?d|passphrase|credential|(?:api|private|access|account)[ _.\-]?key`;
const SECRET_KEY = String.raw`[A-Za-z0-9_.\-]{0,64}?(?:${SECRET_KEYWORDS})[A-Za-z0-9_.\-]{0,64}`;
const HEADER_SECRET_KEY = String.raw`[A-Za-z0-9_\-]{0,32}(?:authorization|cookie)[A-Za-z0-9_\-]{0,32}`;
const ASSIGNMENT = String.raw`\\?["']?[ \t]*(?:=>|[:=])[ \t]*`;
const QUOTED_VALUE = String.raw`"(?:[^"\\\r\n]|\\.)*"?|'(?:[^'\\\r\n]|\\.)*'?`;

type RedactionReplacer = (match: string, ...groups: string[]) => string;

const REDACTION_RULES: ReadonlyArray<{
  pattern: RegExp;
  replace: string | RedactionReplacer;
}> = [
  {
    pattern: PRIVATE_KEY_BLOCK_PATTERN,
    replace: REDACTED,
  },
  {
    pattern: /\b([a-z][a-z0-9+.-]{0,20}:\/\/)([^\s:@/?#]{1,256}):([^\s@/?#]{1,256})@/gi,
    replace: `$1$2:${REDACTED}@`,
  },
  {
    // Header-style credentials are redacted up to the end of the line (cookies, digest parameters).
    pattern: new RegExp(String.raw`\b(${HEADER_SECRET_KEY})(${ASSIGNMENT})(${QUOTED_VALUE}|[^\s"'][^\r\n]*)`, 'gi'),
    replace: redactAssignment,
  },
  {
    pattern: new RegExp(
      String.raw`\b(${SECRET_KEY}|(?:auth|pass|pwd)\b)(${ASSIGNMENT})(${QUOTED_VALUE}|[^\s"',;][^\r\n,;]*)`,
      'gi',
    ),
    replace: redactAssignment,
  },
  {
    pattern: new RegExp(
      String.raw`(?<![A-Za-z0-9_.\-])(--?${SECRET_KEY})([ \t]+)(${QUOTED_VALUE}|[^\s"'-]\S*)`,
      'gi',
    ),
    replace: redactAssignment,
  },
  {
    pattern: /\bgh[pousr]_[A-Za-z0-9_]+\b/gi,
    replace: REDACTED,
  },
  {
    pattern: /\bgithub_pat_[A-Za-z0-9_]+\b/gi,
    replace: REDACTED,
  },
  {
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replace: REDACTED,
  },
  {
    pattern: /\b(Bearer)[ \t]+[^\s"'`]+/gi,
    replace: `$1 ${REDACTED}`,
  },
];

function redactAssignment(_match: string, key: string, separator: string, value: string): string {
  const quote = value[0];
  const redactedValue = quote === '"' || quote === "'" ? `${quote}${REDACTED}${quote}` : REDACTED;
  return `${key}${separator}${redactedValue}`;
}

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

  const redacted = states.includes('redacted') || states.includes('redacted-truncated');
  const truncated = states.includes('truncated') || states.includes('redacted-truncated');

  if (redacted && truncated) {
    return 'redacted-truncated';
  }

  if (redacted) {
    return 'redacted';
  }

  if (truncated) {
    return 'truncated';
  }

  return states.includes('stored') ? 'stored' : 'unavailable';
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
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_EXACT_KEYS.has(normalized)
    || SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function parseJsonContainer(text: string): object | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return undefined;
  }

  const parsed = tryParseJson(trimmed);
  return parsed !== null && typeof parsed === 'object' ? parsed : undefined;
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
