// Runs named call sequences through the TypeScript correlator and writes what each step returned.
// The output is the fixture `rust/agent_trace_correlator/tests/fixtures/scenarios.json`, which the
// Rust port replays. Time is explicit (`nowMs` is passed to `ingest` and `expire`), so no clock hook
// is needed. Usage: node reference/dist/scenarios/scenarios/correlator-scenarios.js <output path>

import { writeFileSync } from 'node:fs';
import {
  createAgentTraceCorrelator,
  type AgentTraceCorrelationFacts,
  type AgentTraceCorrelationInput,
  type AgentTraceCorrelationResult,
  type AgentTraceCorrelatorOptions,
} from '../src/agent-trace-correlator';
import type { DecodedAgentTraceSourceResolution } from '../src/agent-trace-protocol';
import type { UnattributedAgentTraceSpan } from '../src/agent-trace-sanitizer';
import type { AgentTraceSource } from '../src/shared/types';

type Step =
  | { call: 'ingest'; nowMs: number; inputs: AgentTraceCorrelationInput[] }
  | { call: 'expire'; nowMs: number }
  | { call: 'flushAll' }
  | { call: 'discardPending' };

interface Scenario {
  name: string;
  options: AgentTraceCorrelatorOptions;
  steps: Step[];
}

interface SpanSpec {
  trace: string;
  span: string;
  parent?: string;
  args?: string;
  /** The span carries `traceRootInRequest`: it is the root of its trace in this export. */
  root?: true;
  traceSource?: AgentTraceSource;
  traceSession?: string;
  traceResolution?: DecodedAgentTraceSourceResolution;
  source?: AgentTraceSource;
  spanResolution?: DecodedAgentTraceSourceResolution;
  conversation?: string;
  parentConversation?: string;
}

function item(spec: SpanSpec): AgentTraceCorrelationInput {
  const facts: AgentTraceCorrelationFacts = {
    traceId: spec.trace,
    spanId: spec.span,
    parentSpanId: spec.parent ?? null,
    traceRootInRequest: spec.root ?? false,
    traceSource: spec.traceSource ?? null,
    traceSourceResolution: spec.traceResolution ?? (spec.traceSource ? 'supported' : 'missing'),
    traceSessionId: spec.traceSession ?? null,
    spanSource: spec.source ?? null,
    spanSourceResolution: spec.spanResolution ?? 'supported',
    spanConversationId: spec.conversation ?? null,
    spanParentConversationId: spec.parentConversation ?? null,
  };
  const span: UnattributedAgentTraceSpan = {
    traceId: spec.trace,
    spanId: spec.span,
    parentSpanId: spec.parent ?? null,
    name: 'execute_tool',
    category: 'tool',
    toolName: null,
    skillName: null,
    model: null,
    startedAt: '2026-11-23T00:00:00.000Z',
    endedAt: '2026-11-23T00:00:01.000Z',
    durationMs: 1000,
    status: 'ok',
    errorType: null,
    toolCallId: null,
    argumentsJson: spec.args ?? null,
    resultText: null,
    contentState: 'unavailable',
  };
  return { facts, span };
}

const ROOT_OF = (trace: string, session: string): SpanSpec => ({
  trace,
  span: 'root',
  root: true,
  traceSource: 'vscode',
  traceSession: session,
});

// A root without a source is rejected, and its trace stays in `knownTraces` without ready spans.
const MISSING_ROOT = (trace: string): SpanSpec => ({ trace, span: 'root', root: true, traceResolution: 'missing' });

const SCENARIOS: Scenario[] = [
  {
    name: 'ttl-expiry-boundary',
    options: {},
    steps: [
      {
        call: 'ingest',
        nowMs: 0,
        inputs: [
          item({ trace: 't1', span: 'child', parent: 'root' }),
          item({ trace: 't1', span: 'root', source: 'vscode', conversation: 'conv' }),
        ],
      },
      { call: 'ingest', nowMs: 10_000, inputs: [item({ trace: 't2', span: 'orphan' })] },
      { call: 'expire', nowMs: 29_999 },
      { call: 'expire', nowMs: 30_000 },
      { call: 'expire', nowMs: 39_999 },
      { call: 'expire', nowMs: 40_000 },
    ],
  },
  {
    name: 'span-cap-evicts-oldest-trace',
    options: { maxPendingSpans: 2 },
    steps: [
      {
        call: 'ingest',
        nowMs: 0,
        inputs: [
          item({ trace: 'old', span: 'a' }),
          item({ trace: 'old', span: 'b', parent: 'a', source: 'vscode', conversation: 'oc' }),
        ],
      },
      { call: 'ingest', nowMs: 1_000, inputs: [item({ trace: 'new', span: 'c' })] },
      { call: 'ingest', nowMs: 2_000, inputs: [item({ trace: 'new', span: 'd' })] },
      { call: 'flushAll' },
    ],
  },
  {
    name: 'span-cap-single-trace-over-cap',
    options: { maxPendingSpans: 1 },
    steps: [
      {
        call: 'ingest',
        nowMs: 0,
        inputs: [item({ trace: 'x', span: 'x1' }), item({ trace: 'x', span: 'x2' })],
      },
      { call: 'ingest', nowMs: 1, inputs: [item({ trace: 'y', span: 'y1' })] },
    ],
  },
  {
    // Each span costs (UTF-16 units of arguments + result) * 2 + 1024. The emoji is 2 UTF-16 units
    // (4 UTF-8 bytes), so a UTF-8 estimate would put the second step over the cap.
    name: 'bytes-cap-utf16-estimate',
    options: { maxPendingBytes: 2064 },
    steps: [
      { call: 'ingest', nowMs: 0, inputs: [item({ trace: 't1', span: 'p' })] },
      { call: 'ingest', nowMs: 1, inputs: [item({ trace: 't2', span: 'q', args: '😀'.repeat(4) })] },
      { call: 'ingest', nowMs: 2, inputs: [item({ trace: 't3', span: 'r', args: 'x'.repeat(500) })] },
      { call: 'flushAll' },
    ],
  },
  {
    name: 'root-after-held-spans-flushes-them',
    options: {},
    steps: [
      {
        call: 'ingest',
        nowMs: 0,
        inputs: [
          item({ trace: 't1', span: 'c1', parent: 'root', args: 'a' }),
          item({ trace: 't1', span: 'c2', parent: 'c1' }),
        ],
      },
      { call: 'ingest', nowMs: 500, inputs: [item(ROOT_OF('t1', 'vscode:s1'))] },
      { call: 'ingest', nowMs: 600, inputs: [item({ trace: 't1', span: 'late' })] },
      {
        call: 'ingest',
        nowMs: 700,
        inputs: [
          item({ trace: 't2', span: 'root', root: true, traceSource: 'copilot-cli', traceResolution: 'missing' }),
          item({ trace: 't2', span: 'late', parent: 'root' }),
        ],
      },
    ],
  },
  {
    name: 'flush-all-attributes-ancestry-and-drops-the-rest',
    options: {},
    steps: [
      {
        call: 'ingest',
        nowMs: 0,
        inputs: [
          item({ trace: 'A', span: 'a1', parent: 'a2' }),
          item({
            trace: 'A',
            span: 'a2',
            source: 'copilot-cli',
            conversation: 'cli-1',
            parentConversation: 'parent-cli',
          }),
          item({ trace: 'B', span: 'b1' }),
        ],
      },
      { call: 'flushAll' },
      { call: 'flushAll' },
    ],
  },
  {
    name: 'discard-pending-clears-held-and-known-traces',
    options: {},
    steps: [
      { call: 'ingest', nowMs: 0, inputs: [item(ROOT_OF('K', 'vscode:k'))] },
      { call: 'ingest', nowMs: 0, inputs: [item({ trace: 'H', span: 'h1' })] },
      { call: 'discardPending' },
      { call: 'ingest', nowMs: 10, inputs: [item({ trace: 'K', span: 'kc', parent: 'root' })] },
      { call: 'flushAll' },
    ],
  },
  {
    name: 'known-trace-eviction-after-1000-traces',
    options: {},
    steps: [
      {
        call: 'ingest',
        nowMs: 0,
        inputs: Array.from({ length: 1001 }, (_, i) => item(MISSING_ROOT(`r${i}`))),
      },
      {
        call: 'ingest',
        nowMs: 1,
        inputs: [item({ trace: 'r0', span: 'c0' }), item({ trace: 'r1000', span: 'c1000' })],
      },
      { call: 'flushAll' },
    ],
  },
  {
    // Bytes per span: no arguments 1024; 200 characters 1424. A re-held spanId must replace its
    // entry, not add to the pending bytes, or the second step would evict trace D.
    name: 'duplicate-span-rehold-accounting',
    options: { maxPendingBytes: 2100 },
    steps: [
      { call: 'ingest', nowMs: 0, inputs: [item({ trace: 'D', span: 's', args: 'a'.repeat(200) })] },
      { call: 'ingest', nowMs: 1, inputs: [item({ trace: 'D', span: 's', args: 'b'.repeat(200) })] },
      { call: 'ingest', nowMs: 2, inputs: [item({ trace: 'E', span: 's2' })] },
      {
        call: 'ingest',
        nowMs: 3,
        inputs: [item({ trace: 'E', span: 's2' }), item({ trace: 'E', span: 's2' })],
      },
      { call: 'flushAll' },
    ],
  },
  {
    name: 'unsupported-root-drops-held-spans',
    options: {},
    steps: [
      {
        call: 'ingest',
        nowMs: 0,
        inputs: [
          item({ trace: 'U', span: 'u1' }),
          item({ trace: 'U', span: 'u2', parent: 'u1', source: 'vscode', conversation: 'x' }),
        ],
      },
      {
        call: 'ingest',
        nowMs: 1,
        inputs: [item({ trace: 'U', span: 'root', root: true, traceResolution: 'unsupported' })],
      },
      { call: 'ingest', nowMs: 2, inputs: [item({ trace: 'U', span: 'late' })] },
    ],
  },
  {
    name: 'unsupported-span-without-root-is-rejected-not-held',
    options: {},
    steps: [
      {
        call: 'ingest',
        nowMs: 0,
        inputs: [
          item({ trace: 'X', span: 'x1', spanResolution: 'unsupported' }),
          item({ trace: 'X', span: 'x2', spanResolution: 'missing' }),
        ],
      },
      { call: 'ingest', nowMs: 1, inputs: [item({ trace: 'X', span: 'x3' })] },
    ],
  },
];

function run(scenario: Scenario): unknown {
  const correlator = createAgentTraceCorrelator(scenario.options);
  const steps = scenario.steps.map((step) => {
    let result: AgentTraceCorrelationResult | null = null;
    switch (step.call) {
      case 'ingest':
        result = correlator.ingest(step.inputs, step.nowMs);
        break;
      case 'expire':
        result = correlator.expire(step.nowMs);
        break;
      case 'flushAll':
        result = correlator.flushAll();
        break;
      case 'discardPending':
        correlator.discardPending();
        break;
    }
    return {
      ...step,
      result,
      nextExpiryAt: correlator.nextExpiryAt(),
      pendingSpanCount: correlator.pendingSpanCount(),
    };
  });
  return { name: scenario.name, options: scenario.options, steps };
}

const output = JSON.stringify(SCENARIOS.map(run), null, 1) + '\n';
const outputPath = process.argv[2];
if (outputPath) {
  writeFileSync(outputPath, output);
} else {
  process.stdout.write(output);
}
