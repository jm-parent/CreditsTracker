import type { AgentTraceSource, AgentTraceSpan } from '../shared/types';
import {
  buildAgentTraceSessionId,
  type DecodedAgentTraceSourceResolution,
  type DecodedAgentTraceSpan,
} from './agent-trace-protocol';
import {
  attributeAgentTraceSpan,
  type AgentTraceAttribution,
  type UnattributedAgentTraceSpan,
} from './agent-trace-sanitizer';

export const PENDING_TRACE_TTL_MS = 30_000;
export const MAX_PENDING_SPANS = 2_000;
export const MAX_PENDING_BYTES = 16 * 1024 * 1024;
const MAX_KNOWN_TRACES = 1_000;
const PENDING_SPAN_OVERHEAD_BYTES = 1_024;

/** Correlation facts copied from a decoded span. Raw tool payloads are never part of them. */
export interface AgentTraceCorrelationFacts {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  traceRootInRequest: boolean;
  traceSource: AgentTraceSource | null;
  traceSourceResolution: DecodedAgentTraceSourceResolution;
  traceSessionId: string | null;
  spanSource: AgentTraceSource | null;
  spanSourceResolution: DecodedAgentTraceSourceResolution;
  spanConversationId: string | null;
  spanParentConversationId: string | null;
}

export interface AgentTraceCorrelationInput {
  facts: AgentTraceCorrelationFacts;
  span: UnattributedAgentTraceSpan;
}

export interface AgentTraceRejectionCounts {
  unsupportedSource: number;
  missingSourceSession: number;
  unresolvedTraceRoot: number;
}

export interface AgentTraceCorrelationResult {
  /** Spans attributed to a conversation, ready to be stored. */
  ready: AgentTraceSpan[];
  /** Spans of the current export rejected immediately; reported in the OTLP response. */
  rejected: AgentTraceRejectionCounts;
  /** Spans held earlier (or evicted) that could not be attributed and were discarded. */
  dropped: AgentTraceRejectionCounts;
  /** Spans of the current export still held while their trace root is awaited. */
  held: number;
}

export interface AgentTraceCorrelatorOptions {
  pendingTtlMs?: number;
  maxPendingSpans?: number;
  maxPendingBytes?: number;
}

export interface AgentTraceCorrelator {
  ingest(inputs: readonly AgentTraceCorrelationInput[], nowMs: number): AgentTraceCorrelationResult;
  expire(nowMs: number): AgentTraceCorrelationResult;
  flushAll(): AgentTraceCorrelationResult;
  discardPending(): void;
  nextExpiryAt(): number | null;
  pendingSpanCount(): number;
}

type TraceResolution =
  | { kind: 'attributed'; attribution: AgentTraceAttribution }
  | { kind: 'rejected'; reason: 'unsupportedSource' | 'missingSourceSession' };

interface PendingSpan extends AgentTraceCorrelationInput {
  bytes: number;
}

interface PendingTrace {
  traceId: string;
  firstReceivedAtMs: number;
  spans: Map<string, PendingSpan>;
}

export function toAgentTraceCorrelationFacts(decoded: DecodedAgentTraceSpan): AgentTraceCorrelationFacts {
  return {
    traceId: decoded.traceId,
    spanId: decoded.spanId,
    parentSpanId: decoded.parentSpanId,
    traceRootInRequest: decoded.traceRootInRequest,
    traceSource: decoded.source,
    traceSourceResolution: decoded.sourceResolution,
    traceSessionId: decoded.sessionId,
    spanSource: decoded.spanSource,
    spanSourceResolution: decoded.spanSourceResolution,
    spanConversationId: decoded.spanConversationId,
    spanParentConversationId: decoded.spanParentConversationId,
  };
}

/**
 * Attributes spans to a conversation across export requests. Exporters batch spans, so children
 * usually arrive before the root `invoke_agent` span that carries the conversation. Sanitized spans
 * without a known trace root are held in memory for a bounded time; when the time or size bounds
 * are reached they fall back to the conversation context carried by their own attested ancestry.
 */
export function createAgentTraceCorrelator(options: AgentTraceCorrelatorOptions = {}): AgentTraceCorrelator {
  const pendingTtlMs = options.pendingTtlMs ?? PENDING_TRACE_TTL_MS;
  const maxPendingSpans = options.maxPendingSpans ?? MAX_PENDING_SPANS;
  const maxPendingBytes = options.maxPendingBytes ?? MAX_PENDING_BYTES;
  const pending = new Map<string, PendingTrace>();
  const knownTraces = new Map<string, TraceResolution>();
  let pendingSpans = 0;
  let pendingBytes = 0;

  return {
    ingest(inputs, nowMs) {
      const result = emptyResult();

      for (const [traceId, group] of groupByTrace(inputs)) {
        const rootResolution = resolveFromTraceRoot(group);
        if (rootResolution) {
          rememberTrace(traceId, rootResolution);
        }

        const resolution = rootResolution ?? knownTraces.get(traceId);
        if (resolution) {
          applyResolution(group, resolution, result, 'rejected');
          const heldTrace = pending.get(traceId);
          if (heldTrace) {
            removePendingTrace(heldTrace);
            applyResolution([...heldTrace.spans.values()], resolution, result, 'dropped');
          }
          continue;
        }

        if (!pending.has(traceId) && !group.some((input) => input.facts.spanSourceResolution === 'supported')) {
          for (const input of group) {
            result.rejected[rejectionReasonFor(input.facts.spanSourceResolution)] += 1;
          }
          continue;
        }

        holdSpans(traceId, group, nowMs);
      }

      enforceLimits(result);
      result.held = inputs.filter((input) => pending.get(input.facts.traceId)?.spans.has(input.facts.spanId)).length;
      return result;
    },

    expire(nowMs) {
      const result = emptyResult();
      for (const heldTrace of [...pending.values()]) {
        if (nowMs - heldTrace.firstReceivedAtMs < pendingTtlMs) {
          break;
        }
        resolveByFallback(heldTrace, result);
      }
      return result;
    },

    flushAll() {
      const result = emptyResult();
      for (const heldTrace of [...pending.values()]) {
        resolveByFallback(heldTrace, result);
      }
      return result;
    },

    discardPending() {
      pending.clear();
      knownTraces.clear();
      pendingSpans = 0;
      pendingBytes = 0;
    },

    nextExpiryAt() {
      const oldest = pending.values().next();
      return oldest.done ? null : oldest.value.firstReceivedAtMs + pendingTtlMs;
    },

    pendingSpanCount() {
      return pendingSpans;
    },
  };

  function holdSpans(traceId: string, group: readonly AgentTraceCorrelationInput[], nowMs: number): void {
    let heldTrace = pending.get(traceId);
    if (!heldTrace) {
      heldTrace = { traceId, firstReceivedAtMs: nowMs, spans: new Map() };
      pending.set(traceId, heldTrace);
    }

    for (const input of group) {
      const previous = heldTrace.spans.get(input.facts.spanId);
      if (previous) {
        pendingSpans -= 1;
        pendingBytes -= previous.bytes;
      }

      const bytes = estimateSpanBytes(input.span);
      heldTrace.spans.set(input.facts.spanId, { ...input, bytes });
      pendingSpans += 1;
      pendingBytes += bytes;
    }
  }

  function enforceLimits(result: AgentTraceCorrelationResult): void {
    while ((pendingSpans > maxPendingSpans || pendingBytes > maxPendingBytes) && pending.size > 0) {
      const oldest = pending.values().next().value as PendingTrace;
      resolveByFallback(oldest, result);
    }
  }

  function resolveByFallback(heldTrace: PendingTrace, result: AgentTraceCorrelationResult): void {
    removePendingTrace(heldTrace);

    for (const heldSpan of heldTrace.spans.values()) {
      const attribution = findAncestorAttribution(heldSpan, heldTrace.spans);
      if (attribution) {
        result.ready.push(attributeAgentTraceSpan(heldSpan.span, attribution));
        continue;
      }

      const reason = heldSpan.facts.spanSourceResolution === 'unsupported'
        ? 'unsupportedSource'
        : 'unresolvedTraceRoot';
      result.dropped[reason] += 1;
    }
  }

  function removePendingTrace(heldTrace: PendingTrace): void {
    if (!pending.delete(heldTrace.traceId)) {
      return;
    }

    for (const heldSpan of heldTrace.spans.values()) {
      pendingSpans -= 1;
      pendingBytes -= heldSpan.bytes;
    }
  }

  function rememberTrace(traceId: string, resolution: TraceResolution): void {
    knownTraces.delete(traceId);
    knownTraces.set(traceId, resolution);
    if (knownTraces.size > MAX_KNOWN_TRACES) {
      const oldestTraceId = knownTraces.keys().next().value as string;
      knownTraces.delete(oldestTraceId);
    }
  }
}

function resolveFromTraceRoot(group: readonly AgentTraceCorrelationInput[]): TraceResolution | null {
  const anchor = group.find((input) => input.facts.traceRootInRequest);
  if (!anchor) {
    return null;
  }

  const { traceSource, traceSessionId, traceSourceResolution } = anchor.facts;
  if (traceSource !== null && traceSessionId !== null) {
    return { kind: 'attributed', attribution: { source: traceSource, sessionId: traceSessionId } };
  }

  return {
    kind: 'rejected',
    reason: traceSourceResolution === 'unsupported' ? 'unsupportedSource' : 'missingSourceSession',
  };
}

function applyResolution(
  inputs: readonly AgentTraceCorrelationInput[],
  resolution: TraceResolution,
  result: AgentTraceCorrelationResult,
  countsKey: 'rejected' | 'dropped',
): void {
  if (resolution.kind === 'rejected') {
    result[countsKey][resolution.reason] += inputs.length;
    return;
  }

  for (const input of inputs) {
    result.ready.push(attributeAgentTraceSpan(input.span, resolution.attribution));
  }
}

// Walks the attested parent chain inside the held trace and keeps the top-most explicit context.
function findAncestorAttribution(
  heldSpan: PendingSpan,
  heldSpans: ReadonlyMap<string, PendingSpan>,
): AgentTraceAttribution | null {
  const visited = new Set<string>();
  let attribution: AgentTraceAttribution | null = null;
  let current: PendingSpan | undefined = heldSpan;

  while (current && !visited.has(current.facts.spanId)) {
    visited.add(current.facts.spanId);
    attribution = explicitAttribution(current.facts) ?? attribution;
    current = current.facts.parentSpanId === null ? undefined : heldSpans.get(current.facts.parentSpanId);
  }

  return attribution;
}

function explicitAttribution(facts: AgentTraceCorrelationFacts): AgentTraceAttribution | null {
  const conversationId = facts.spanParentConversationId ?? facts.spanConversationId;
  const sessionId = buildAgentTraceSessionId(facts.spanSource, conversationId);
  if (facts.spanSource === null || sessionId === null) {
    return null;
  }
  return { source: facts.spanSource, sessionId };
}

function rejectionReasonFor(
  resolution: DecodedAgentTraceSourceResolution,
): 'unsupportedSource' | 'missingSourceSession' {
  return resolution === 'unsupported' ? 'unsupportedSource' : 'missingSourceSession';
}

function groupByTrace(
  inputs: readonly AgentTraceCorrelationInput[],
): Map<string, AgentTraceCorrelationInput[]> {
  const groups = new Map<string, AgentTraceCorrelationInput[]>();
  for (const input of inputs) {
    const group = groups.get(input.facts.traceId);
    if (group) {
      group.push(input);
    } else {
      groups.set(input.facts.traceId, [input]);
    }
  }
  return groups;
}

function estimateSpanBytes(span: UnattributedAgentTraceSpan): number {
  return ((span.argumentsJson?.length ?? 0) + (span.resultText?.length ?? 0)) * 2 + PENDING_SPAN_OVERHEAD_BYTES;
}

function emptyResult(): AgentTraceCorrelationResult {
  return {
    ready: [],
    rejected: emptyCounts(),
    dropped: emptyCounts(),
    held: 0,
  };
}

export function emptyCounts(): AgentTraceRejectionCounts {
  return {
    unsupportedSource: 0,
    missingSourceSession: 0,
    unresolvedTraceRoot: 0,
  };
}
