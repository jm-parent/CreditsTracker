import { describe, expect, it } from 'vitest';
import { makeAgentTraceSpan } from '../../test-utils/agent-trace-fixtures';
import { buildAgentTraceTree } from './agent-trace-tree';

describe('buildAgentTraceTree', () => {
  it('builds per-trace trees, sorts siblings, and keeps disconnected roots visible', () => {
    const root = makeAgentTraceSpan({
      traceId: 'trace-1',
      spanId: 'root',
      category: 'agent',
      startedAt: '2026-09-23T10:00:00.000Z',
    });
    const siblingEarlier = makeAgentTraceSpan({
      traceId: 'trace-1',
      spanId: 'sibling-earlier',
      parentSpanId: 'root',
      startedAt: '2026-09-23T10:00:00.100Z',
    });
    const toolLater = makeAgentTraceSpan({
      traceId: 'trace-1',
      spanId: 'tool-later',
      parentSpanId: 'root',
      name: 'execute_tool runCommand',
      category: 'shell',
      startedAt: '2026-09-23T10:00:00.200Z',
    });
    const orphan = makeAgentTraceSpan({
      traceId: 'trace-1',
      spanId: 'orphan',
      parentSpanId: 'missing-parent',
      startedAt: '2026-09-23T10:00:00.300Z',
    });
    const unlinkedTool = makeAgentTraceSpan({
      traceId: 'trace-1',
      spanId: 'unlinked-tool',
      category: 'shell',
      parentSpanId: null,
      startedAt: '2026-09-23T10:00:00.400Z',
    });
    const cycleA = makeAgentTraceSpan({
      traceId: 'trace-1',
      spanId: 'cycle-a',
      parentSpanId: 'cycle-b',
      startedAt: '2026-09-23T10:00:00.500Z',
    });
    const cycleB = makeAgentTraceSpan({
      traceId: 'trace-1',
      spanId: 'cycle-b',
      parentSpanId: 'cycle-a',
      startedAt: '2026-09-23T10:00:00.600Z',
    });

    const turns = buildAgentTraceTree([
      toolLater,
      cycleB,
      root,
      siblingEarlier,
      orphan,
      unlinkedTool,
      cycleA,
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0].traceId).toBe('trace-1');
    expect(turns[0].roots.map((node) => node.span.spanId)).toEqual([
      'root',
      'orphan',
      'unlinked-tool',
      'cycle-a',
      'cycle-b',
    ]);
    expect(turns[0].roots[0].unparented).toBe(false);
    expect(turns[0].roots[0].children.map((node) => node.span.spanId)).toEqual([
      'sibling-earlier',
      'tool-later',
    ]);
    expect(turns[0].roots.slice(1).every((node) => node.unparented)).toBe(true);
  });

  it('keeps traces separate, orders turns deterministically, and uses explicit toolCallId links', () => {
    const traceOneRoot = makeAgentTraceSpan({
      traceId: 'trace-1',
      spanId: 'root-1',
      category: 'agent',
      startedAt: '2026-09-23T10:00:00.000Z',
    });
    const llmRequest = makeAgentTraceSpan({
      traceId: 'trace-1',
      spanId: 'llm-1',
      parentSpanId: 'root-1',
      category: 'llm',
      name: 'chat turn',
      toolCallId: 'call-7',
      startedAt: '2026-09-23T10:00:00.050Z',
    });
    const toolChild = makeAgentTraceSpan({
      traceId: 'trace-1',
      spanId: 'tool-1',
      parentSpanId: null,
      category: 'tool',
      name: 'execute_tool readFile',
      toolName: 'readFile',
      toolCallId: 'call-7',
      startedAt: '2026-09-23T10:00:00.060Z',
    });
    const traceTwoRoot = makeAgentTraceSpan({
      traceId: 'trace-2',
      spanId: 'root-2',
      category: 'agent',
      startedAt: '2026-09-23T10:00:00.000Z',
    });

    const turns = buildAgentTraceTree([traceTwoRoot, toolChild, llmRequest, traceOneRoot]);

    expect(turns.map((turn) => turn.traceId)).toEqual(['trace-1', 'trace-2']);
    expect(turns[0].roots.map((node) => node.span.spanId)).toEqual(['root-1']);
    expect(turns[0].roots[0].children.map((node) => node.span.spanId)).toEqual(['llm-1']);
    expect(turns[0].roots[0].children[0].children.map((node) => node.span.spanId)).toEqual([
      'tool-1',
    ]);
    expect(turns[0].roots[0].children[0].children[0].unparented).toBe(false);
    expect(turns[1].roots.map((node) => node.span.spanId)).toEqual(['root-2']);
  });

  it('reparents approved action categories to matching llm spans via explicit toolCallId links', () => {
    const root = makeAgentTraceSpan({
      traceId: 'trace-1',
      spanId: 'root-1',
      category: 'agent',
      startedAt: '2026-09-23T10:00:00.000Z',
    });
    const llmRequest = makeAgentTraceSpan({
      traceId: 'trace-1',
      spanId: 'llm-1',
      parentSpanId: 'root-1',
      category: 'llm',
      toolCallId: 'call-7',
      startedAt: '2026-09-23T10:00:00.050Z',
    });

    const childCategories = ['tool', 'skill', 'shell', 'hook', 'other'] as const;
    const children = childCategories.map((category, index) =>
      makeAgentTraceSpan({
        traceId: 'trace-1',
        spanId: `${category}-1`,
        parentSpanId: null,
        category,
        toolCallId: 'call-7',
        startedAt: `2026-09-23T10:00:00.0${60 + index}Z`,
      }),
    );

    const turns = buildAgentTraceTree([root, ...children, llmRequest]);

    expect(turns).toHaveLength(1);
    expect(turns[0].roots).toHaveLength(1);
    expect(turns[0].roots[0].children.map((node) => node.span.spanId)).toEqual(['llm-1']);
    expect(
      turns[0].roots[0].children[0].children.map((node) => ({
        spanId: node.span.spanId,
        category: node.span.category,
        unparented: node.unparented,
      })),
    ).toEqual([
      { spanId: 'tool-1', category: 'tool', unparented: false },
      { spanId: 'skill-1', category: 'skill', unparented: false },
      { spanId: 'shell-1', category: 'shell', unparented: false },
      { spanId: 'hook-1', category: 'hook', unparented: false },
      { spanId: 'other-1', category: 'other', unparented: false },
    ]);
  });
});
