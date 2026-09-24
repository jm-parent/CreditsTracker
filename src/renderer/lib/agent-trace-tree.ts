import type { AgentTraceCategory, AgentTraceSpan } from '../../shared/types';

export interface AgentTraceNode {
  span: AgentTraceSpan;
  children: AgentTraceNode[];
  unparented: boolean;
}

export interface AgentTraceTurn {
  traceId: string;
  roots: AgentTraceNode[];
}

const EXPLICIT_TOOL_CHILD_CATEGORIES = new Set<AgentTraceCategory>([
  'tool',
  'skill',
  'shell',
  'hook',
  'other',
]);

export function buildAgentTraceTree(spans: AgentTraceSpan[]): AgentTraceTurn[] {
  const turnsByTraceId = new Map<string, AgentTraceSpan[]>();
  for (const span of spans) {
    const traceSpans = turnsByTraceId.get(span.traceId);
    if (traceSpans) {
      traceSpans.push(span);
    } else {
      turnsByTraceId.set(span.traceId, [span]);
    }
  }

  return [...turnsByTraceId.entries()]
    .map(([traceId, traceSpans]) => buildTurn(traceId, traceSpans))
    .sort(compareTurns);
}

function buildTurn(traceId: string, spans: readonly AgentTraceSpan[]): AgentTraceTurn {
  const nodeBySpanId = new Map<string, AgentTraceNode>();
  const llmSpanIdsByToolCallId = new Map<string, string[]>();

  for (const span of spans) {
    nodeBySpanId.set(span.spanId, {
      span,
      children: [],
      unparented: false,
    });

    if (span.category === 'llm' && span.toolCallId) {
      const existing = llmSpanIdsByToolCallId.get(span.toolCallId);
      if (existing) {
        existing.push(span.spanId);
      } else {
        llmSpanIdsByToolCallId.set(span.toolCallId, [span.spanId]);
      }
    }
  }

  for (const llmSpanIds of llmSpanIdsByToolCallId.values()) {
    llmSpanIds.sort((leftId, rightId) => compareSpans(nodeBySpanId.get(leftId)!.span, nodeBySpanId.get(rightId)!.span));
  }

  const rawParentBySpanId = new Map<string, string>();

  for (const span of spans) {
    const explicitParentId = findExplicitParentSpanId(span, llmSpanIdsByToolCallId);
    if (explicitParentId) {
      rawParentBySpanId.set(span.spanId, explicitParentId);
      continue;
    }

    if (span.parentSpanId && span.parentSpanId !== span.spanId && nodeBySpanId.has(span.parentSpanId)) {
      rawParentBySpanId.set(span.spanId, span.parentSpanId);
    }
  }

  const attachedSpanIds = new Set<string>();

  for (const span of spans) {
    const parentSpanId = rawParentBySpanId.get(span.spanId);
    if (!parentSpanId || hasCycle(span.spanId, rawParentBySpanId)) {
      continue;
    }

    const parentNode = nodeBySpanId.get(parentSpanId);
    const childNode = nodeBySpanId.get(span.spanId);
    if (!parentNode || !childNode) {
      continue;
    }

    parentNode.children.push(childNode);
    attachedSpanIds.add(span.spanId);
  }

  const roots = [...nodeBySpanId.values()]
    .filter((node) => !attachedSpanIds.has(node.span.spanId))
    .sort((left, right) => compareSpans(left.span, right.span))
    .map((node) => ({
      ...node,
      children: sortChildren(node.children),
      unparented: isUnparentedRoot(node.span, attachedSpanIds, rawParentBySpanId),
    }));

  return { traceId, roots };
}

function sortChildren(children: readonly AgentTraceNode[]): AgentTraceNode[] {
  return [...children]
    .sort((left, right) => compareSpans(left.span, right.span))
    .map((child) => ({
      ...child,
      children: sortChildren(child.children),
    }));
}

function findExplicitParentSpanId(
  span: AgentTraceSpan,
  llmSpanIdsByToolCallId: ReadonlyMap<string, readonly string[]>,
): string | null {
  if (!span.toolCallId || !EXPLICIT_TOOL_CHILD_CATEGORIES.has(span.category)) {
    return null;
  }

  const llmSpanIds = llmSpanIdsByToolCallId.get(span.toolCallId);
  if (!llmSpanIds || llmSpanIds.length === 0) {
    return null;
  }

  return llmSpanIds[0] ?? null;
}

function hasCycle(spanId: string, rawParentBySpanId: ReadonlyMap<string, string>): boolean {
  const seen = new Set<string>();
  let currentSpanId: string | undefined = spanId;

  while (currentSpanId) {
    if (seen.has(currentSpanId)) {
      return true;
    }
    seen.add(currentSpanId);
    currentSpanId = rawParentBySpanId.get(currentSpanId);
  }

  return false;
}

function isUnparentedRoot(
  span: AgentTraceSpan,
  attachedSpanIds: ReadonlySet<string>,
  rawParentBySpanId: ReadonlyMap<string, string>,
): boolean {
  if (attachedSpanIds.has(span.spanId)) {
    return false;
  }

  if (hasCycle(span.spanId, rawParentBySpanId)) {
    return true;
  }

  if (span.parentSpanId !== null) {
    return true;
  }

  return span.category !== 'agent';
}

function compareTurns(left: AgentTraceTurn, right: AgentTraceTurn): number {
  const leftFirst = left.roots[0]?.span;
  const rightFirst = right.roots[0]?.span;

  if (leftFirst && rightFirst) {
    const byFirstSpan = compareSpans(leftFirst, rightFirst);
    if (byFirstSpan !== 0) {
      return byFirstSpan;
    }
  }

  return left.traceId.localeCompare(right.traceId);
}

function compareSpans(left: AgentTraceSpan, right: AgentTraceSpan): number {
  return left.startedAt.localeCompare(right.startedAt) || left.spanId.localeCompare(right.spanId);
}
