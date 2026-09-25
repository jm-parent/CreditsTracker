import { describe, expect, it } from 'vitest';
import type { DecodedAgentTraceSpan } from './agent-trace-protocol';
import { makeDecodedAgentTraceSpan } from '../test-utils/agent-trace-fixtures';
import {
  createAgentTraceCorrelator,
  toAgentTraceCorrelationFacts,
  type AgentTraceCorrelationInput,
} from './agent-trace-correlator';
import { sanitizeUnattributedAgentTraceSpan } from './agent-trace-sanitizer';

const TRACE_ID = '00112233445566778899aabbccddeeff';
const OTHER_TRACE_ID = 'ffeeddccbbaa99887766554433221100';

function rootlessSpan(overrides: Partial<DecodedAgentTraceSpan>): AgentTraceCorrelationInput {
  return toInput({
    source: null,
    sourceResolution: 'supported',
    conversationId: null,
    sessionId: null,
    traceRootInRequest: false,
    spanConversationId: null,
    ...overrides,
  });
}

function rootedSpan(overrides: Partial<DecodedAgentTraceSpan>): AgentTraceCorrelationInput {
  return toInput({
    source: 'vscode',
    sourceResolution: 'supported',
    conversationId: 'conversation-1',
    sessionId: 'vscode:conversation-1',
    traceRootInRequest: true,
    ...overrides,
  });
}

function toInput(overrides: Partial<DecodedAgentTraceSpan>): AgentTraceCorrelationInput {
  const decoded = makeDecodedAgentTraceSpan({ traceId: TRACE_ID, ...overrides });
  return {
    facts: toAgentTraceCorrelationFacts(decoded),
    span: sanitizeUnattributedAgentTraceSpan(decoded),
  };
}

const root = rootedSpan({ spanId: 'aaaaaaaaaaaaaaaa', parentSpanId: null, category: 'agent' });
const chat = rootlessSpan({
  spanId: 'bbbbbbbbbbbbbbbb',
  parentSpanId: 'aaaaaaaaaaaaaaaa',
  name: 'chat gpt-5.4',
  category: 'llm',
  spanConversationId: 'conversation-1',
});
const tool = rootlessSpan({
  spanId: 'cccccccccccccccc',
  parentSpanId: 'bbbbbbbbbbbbbbbb',
  name: 'execute_tool runCommand',
  category: 'tool',
  argumentsValue: { command: 'echo ok', token: 'synthetic-secret' },
});

describe('createAgentTraceCorrelator', () => {
  it('attributes spans immediately when the trace root is in the same export', () => {
    const correlator = createAgentTraceCorrelator();

    const result = correlator.ingest([
      root,
      rootedSpan({ spanId: 'bbbbbbbbbbbbbbbb', parentSpanId: 'aaaaaaaaaaaaaaaa', category: 'llm' }),
    ], 0);

    expect(result.ready.map((span) => [span.spanId, span.sessionId])).toEqual([
      ['aaaaaaaaaaaaaaaa', 'vscode:conversation-1'],
      ['bbbbbbbbbbbbbbbb', 'vscode:conversation-1'],
    ]);
    expect(result.held).toBe(0);
    expect(correlator.pendingSpanCount()).toBe(0);
  });

  it('holds children exported before their root and attributes them when the root arrives', () => {
    const correlator = createAgentTraceCorrelator();

    const first = correlator.ingest([chat, tool], 1_000);
    expect(first.ready).toEqual([]);
    expect(first.rejected).toEqual({ unsupportedSource: 0, missingSourceSession: 0, unresolvedTraceRoot: 0 });
    expect(first.held).toBe(2);
    expect(correlator.nextExpiryAt()).toBe(31_000);

    const second = correlator.ingest([root], 6_000);
    expect(second.held).toBe(0);
    expect(second.ready.map((span) => span.spanId).sort()).toEqual([
      'aaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbb',
      'cccccccccccccccc',
    ]);
    expect(second.ready.every((span) => span.source === 'vscode' && span.sessionId === 'vscode:conversation-1'))
      .toBe(true);
    expect(JSON.stringify(second.ready)).not.toContain('synthetic-secret');
    expect(correlator.pendingSpanCount()).toBe(0);
    expect(correlator.nextExpiryAt()).toBeNull();
  });

  it('remembers the trace root so later spans of the same trace are attributed without waiting', () => {
    const correlator = createAgentTraceCorrelator();
    correlator.ingest([root], 0);

    const late = correlator.ingest([tool], 1_000);

    expect(late.held).toBe(0);
    expect(late.ready).toEqual([expect.objectContaining({
      spanId: 'cccccccccccccccc',
      sessionId: 'vscode:conversation-1',
    })]);
  });

  it('does not attribute a trace to a nested agent whose own parent is still missing', () => {
    const correlator = createAgentTraceCorrelator();
    const subagent = rootlessSpan({
      spanId: 'dddddddddddddddd',
      parentSpanId: 'eeeeeeeeeeeeeeee',
      name: 'invoke_agent explore',
      category: 'agent',
      spanConversationId: 'subagent-conversation',
    });

    expect(correlator.ingest([subagent], 0)).toMatchObject({ ready: [], held: 1 });

    const withRoot = correlator.ingest([root], 5_000);
    expect(withRoot.ready).toEqual(expect.arrayContaining([
      expect.objectContaining({ spanId: 'dddddddddddddddd', sessionId: 'vscode:conversation-1' }),
    ]));
  });

  it('falls back to the top-most attested conversation context when the root never arrives', () => {
    const correlator = createAgentTraceCorrelator();
    const subagentTool = rootlessSpan({
      spanId: '1111111111111111',
      parentSpanId: '2222222222222222',
      category: 'tool',
      spanConversationId: 'subagent-conversation',
      spanParentConversationId: 'conversation-1',
    });
    const contextless = rootlessSpan({
      spanId: '3333333333333333',
      parentSpanId: null,
      category: 'tool',
    });
    correlator.ingest([chat, tool, subagentTool, contextless], 1_000);

    expect(correlator.expire(30_999).ready).toEqual([]);
    const expired = correlator.expire(31_000);

    expect(expired.ready.map((span) => [span.spanId, span.sessionId]).sort()).toEqual([
      ['1111111111111111', 'vscode:conversation-1'],
      ['bbbbbbbbbbbbbbbb', 'vscode:conversation-1'],
      ['cccccccccccccccc', 'vscode:conversation-1'],
    ]);
    expect(expired.dropped).toEqual({ unsupportedSource: 0, missingSourceSession: 0, unresolvedTraceRoot: 1 });
    expect(correlator.pendingSpanCount()).toBe(0);
    expect(correlator.nextExpiryAt()).toBeNull();
  });

  it('evicts the oldest held trace through the fallback when the span cap is exceeded', () => {
    const correlator = createAgentTraceCorrelator({ maxPendingSpans: 2 });
    correlator.ingest([chat, tool], 0);

    const result = correlator.ingest([
      rootlessSpan({ traceId: OTHER_TRACE_ID, spanId: '4444444444444444', spanConversationId: 'conversation-2' }),
    ], 1_000);

    expect(result.ready.map((span) => span.spanId).sort()).toEqual(['bbbbbbbbbbbbbbbb', 'cccccccccccccccc']);
    expect(result.held).toBe(1);
    expect(correlator.pendingSpanCount()).toBe(1);
    expect(correlator.nextExpiryAt()).toBe(31_000);
  });

  it('evicts held traces when their sanitized payloads exceed the byte cap', () => {
    const correlator = createAgentTraceCorrelator({ maxPendingBytes: 4_000 });

    const result = correlator.ingest([
      rootlessSpan({ spanId: '5555555555555555', result: 'x'.repeat(4_000) }),
    ], 0);

    expect(result.held).toBe(0);
    expect(result.dropped.unresolvedTraceRoot).toBe(1);
    expect(correlator.pendingSpanCount()).toBe(0);
  });

  it('rejects exports that contain no supported source without holding them', () => {
    const correlator = createAgentTraceCorrelator();

    const result = correlator.ingest([
      rootlessSpan({ spanId: '6666666666666666', spanSource: null, spanSourceResolution: 'unsupported' }),
      rootlessSpan({ traceId: OTHER_TRACE_ID, spanId: '7777777777777777', spanSource: null, spanSourceResolution: 'missing' }),
    ], 0);

    expect(result.rejected).toEqual({ unsupportedSource: 1, missingSourceSession: 1, unresolvedTraceRoot: 0 });
    expect(result.held).toBe(0);
  });

  it('rejects held and later spans for the root reason when the root has no usable context', () => {
    const correlator = createAgentTraceCorrelator();
    correlator.ingest([tool], 0);

    const unusableRoot = rootedSpan({
      spanId: 'aaaaaaaaaaaaaaaa',
      source: 'vscode',
      conversationId: null,
      sessionId: null,
    });
    const withRoot = correlator.ingest([unusableRoot], 1_000);
    const later = correlator.ingest([chat], 2_000);

    expect(withRoot.rejected.missingSourceSession).toBe(1);
    expect(withRoot.dropped.missingSourceSession).toBe(1);
    expect(later.rejected.missingSourceSession).toBe(1);
    expect(later.held).toBe(0);
  });

  it('discards held payloads and remembered traces on demand', () => {
    const correlator = createAgentTraceCorrelator();
    correlator.ingest([root], 0);
    correlator.ingest(
      [rootlessSpan({ traceId: OTHER_TRACE_ID, spanId: '8888888888888888', spanConversationId: 'conversation-2' })],
      0,
    );

    correlator.discardPending();

    expect(correlator.pendingSpanCount()).toBe(0);
    expect(correlator.flushAll().ready).toEqual([]);
    expect(correlator.ingest([tool], 1_000).held).toBe(1);
  });

  it('flushes every held trace through the fallback', () => {
    const correlator = createAgentTraceCorrelator();
    correlator.ingest([chat, tool], 0);

    const flushed = correlator.flushAll();

    expect(flushed.ready.map((span) => span.spanId).sort()).toEqual(['bbbbbbbbbbbbbbbb', 'cccccccccccccccc']);
    expect(correlator.pendingSpanCount()).toBe(0);
  });
});
