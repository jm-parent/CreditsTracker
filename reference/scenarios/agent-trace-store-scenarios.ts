// Runs named call sequences through the TypeScript agent trace store and records what each step
// returned and what the SQLite file held afterwards. The output is the fixture
// `rust/agent_trace_store/tests/fixtures/scenarios.json`, which the Rust port replays step for step.
// Usage: node reference/dist/scenarios/scenarios/agent-trace-store-scenarios.js <output path> <work dir>

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openAgentTraceStore, type AgentTraceStore } from '../src/agent-trace-store';
import { resolveDefaultDbPath } from '../src/db';
import type { AgentTraceSelection, AgentTraceSpan } from '../src/shared/types';

// Stands for the Copilot CLI usage database path, which differs between machines.
const DEFAULT_DB_TOKEN = '<default>';

type Step =
  | { call: 'open'; dbPath: string }
  | { call: 'reopen' }
  | { call: 'insertSpans'; spans: AgentTraceSpan[] }
  | { call: 'getSession'; selection: AgentTraceSelection }
  | { call: 'getCollectionEnabled' }
  | { call: 'setCollectionEnabled'; enabled: boolean }
  | { call: 'pruneExpired'; nowMs: number }
  | { call: 'clear' }
  | { call: 'close' }
  | { call: 'exec'; sql: string; params: (string | number | null)[] };

interface Scenario {
  name: string;
  steps: Step[];
}

interface State {
  folder: string;
  store: AgentTraceStore | null;
  dbPath: string | null;
}

type Outcome = { ok: unknown } | { error: string };

function span(fields: Pick<AgentTraceSpan, 'sessionId' | 'traceId' | 'spanId'> & Partial<AgentTraceSpan>): AgentTraceSpan {
  return {
    source: 'copilot-cli',
    parentSpanId: null,
    name: 'execute_tool',
    category: 'tool',
    toolName: null,
    skillName: null,
    model: null,
    startedAt: '2026-11-23T10:00:00.000Z',
    endedAt: '2026-11-23T10:00:01.000Z',
    durationMs: 1000,
    status: 'ok',
    errorType: null,
    toolCallId: null,
    argumentsJson: '{}',
    resultText: 'ok',
    contentState: 'stored',
    ...fields,
  };
}

const INSERT_RAW_ROW = `INSERT INTO agent_trace_spans (
  source, session_id, trace_id, span_id, parent_span_id, started_at, received_at, span_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

const SCENARIOS: Scenario[] = [
  {
    name: 'reopen-keeps-rows',
    steps: [
      { call: 'open', dbPath: 'missing/parent/agent-trace-store.db' },
      {
        call: 'insertSpans',
        spans: [
          span({ sessionId: 'sess-1', traceId: 't1', spanId: 's1', parentSpanId: null, category: 'agent', name: 'invoke_agent', durationMs: 1234.5, toolName: null, argumentsJson: null, resultText: null }),
          span({ sessionId: 'sess-1', traceId: 't1', spanId: 's2', parentSpanId: 's1', startedAt: '2026-11-23T10:00:02.000Z', endedAt: '2026-11-23T10:00:03.000Z', toolName: 'grep', toolCallId: 'call-1', argumentsJson: '{"q":"x"}' }),
        ],
      },
      { call: 'getSession', selection: { source: 'copilot-cli', sessionId: 'sess-1' } },
      { call: 'reopen' },
      { call: 'getSession', selection: { source: 'copilot-cli', sessionId: 'sess-1' } },
      { call: 'setCollectionEnabled', enabled: true },
      { call: 'reopen' },
      { call: 'getCollectionEnabled' },
      {
        call: 'insertSpans',
        spans: [span({ sessionId: 'sess-1', traceId: 't1', spanId: 's2', parentSpanId: 's1', startedAt: '2026-11-23T10:00:02.000Z', endedAt: '2026-11-23T10:00:03.000Z', toolName: 'other', toolCallId: 'call-2', argumentsJson: '{}' })],
      },
      { call: 'close' },
      { call: 'getSession', selection: { source: 'copilot-cli', sessionId: 'sess-1' } },
    ],
  },
  {
    name: 'availability-and-order',
    steps: [
      { call: 'open', dbPath: 'availability.db' },
      {
        call: 'insertSpans',
        spans: [
          span({ sessionId: 'sess-2', traceId: 'b', spanId: 'z', parentSpanId: 'a', startedAt: '2026-11-23T10:00:05.000Z', endedAt: '2026-11-23T10:00:06.000Z' }),
          span({ sessionId: 'sess-2', traceId: 'a', spanId: 'root', parentSpanId: null, category: 'agent', name: 'invoke_agent', startedAt: '2026-11-23T10:00:00.000Z' }),
          span({ sessionId: 'sess-2', traceId: 'a', spanId: 'b1', parentSpanId: 'root', startedAt: '2026-11-23T10:00:00.000Z' }),
          span({ sessionId: 'sess-2', traceId: 'a', spanId: 'a1', parentSpanId: 'root', startedAt: '2026-11-23T10:00:00.000Z' }),
          span({ sessionId: 'sess-2', traceId: 'a', spanId: 'b1', parentSpanId: 'root', startedAt: '2026-11-23T10:00:00.000Z', toolName: 'duplicate' }),
        ],
      },
      { call: 'getSession', selection: { source: 'copilot-cli', sessionId: 'sess-2' } },
      {
        call: 'insertSpans',
        spans: [
          span({ sessionId: 'sess-3', traceId: 'c', spanId: 'root', parentSpanId: null, category: 'llm', name: 'chat' }),
          span({ sessionId: 'sess-3', traceId: 'c', spanId: 'orphan', parentSpanId: 'missing', startedAt: '2026-11-23T10:00:01.000Z' }),
        ],
      },
      { call: 'getSession', selection: { source: 'copilot-cli', sessionId: 'sess-3' } },
      {
        call: 'insertSpans',
        spans: [span({ sessionId: 'sess-4', traceId: 'd', spanId: 'shell', parentSpanId: null, category: 'agent', name: 'invoke_agent' }), span({ sessionId: 'sess-4', traceId: 'd', spanId: 'pending', parentSpanId: 'shell', category: 'shell', argumentsJson: null, resultText: null })],
      },
      { call: 'getSession', selection: { source: 'copilot-cli', sessionId: 'sess-4' } },
      {
        call: 'exec',
        sql: INSERT_RAW_ROW,
        params: ['vscode', 'sess-5', 't5', 'bad', null, '2026-11-23T10:00:00.000Z', '2026-11-23T10:00:00.000Z', '{not json'],
      },
      { call: 'getSession', selection: { source: 'vscode', sessionId: 'sess-5' } },
      {
        call: 'exec',
        sql: INSERT_RAW_ROW,
        params: [
          'copilot-cli',
          'sess-7',
          'g',
          'h',
          null,
          'not-a-date',
          '2026-11-23T10:00:00.000Z',
          '{"source":"copilot-cli","sessionId":"sess-7","traceId":"g","spanId":"h","parentSpanId":null,"name":"execute_tool","category":"tool","toolName":null,"skillName":null,"model":null,"startedAt":"not-a-date","endedAt":"2026-11-23T10:00:01.000Z","durationMs":1000,"status":"ok","errorType":null,"toolCallId":null,"argumentsJson":"{}","resultText":"ok","contentState":"stored"}',
        ],
      },
      { call: 'getSession', selection: { source: 'copilot-cli', sessionId: 'sess-7' } },
      { call: 'getSession', selection: { source: 'copilot-cli', sessionId: 'nobody' } },
    ],
  },
  {
    name: 'retention-and-clear',
    steps: [
      { call: 'open', dbPath: 'retention.db' },
      { call: 'insertSpans', spans: [span({ sessionId: 'sess-6', traceId: 'e', spanId: 'root', parentSpanId: null, category: 'agent', name: 'invoke_agent' })] },
      { call: 'pruneExpired', nowMs: Date.parse('2026-11-24T00:00:00.000Z') },
      { call: 'getSession', selection: { source: 'copilot-cli', sessionId: 'sess-6' } },
      { call: 'pruneExpired', nowMs: Date.parse('2100-01-01T00:00:00.000Z') },
      { call: 'getSession', selection: { source: 'copilot-cli', sessionId: 'sess-6' } },
      { call: 'setCollectionEnabled', enabled: true },
      { call: 'clear' },
      { call: 'getSession', selection: { source: 'copilot-cli', sessionId: 'sess-6' } },
      { call: 'getCollectionEnabled' },
    ],
  },
  {
    name: 'refuses-copilot-cli-database',
    steps: [{ call: 'open', dbPath: DEFAULT_DB_TOKEN }],
  },
];

function requireStore(state: State): AgentTraceStore {
  if (!state.store) {
    throw new Error('no store is open in this scenario');
  }
  return state.store;
}

function execute(step: Step, state: State): unknown {
  switch (step.call) {
    case 'open': {
      const target = step.dbPath === DEFAULT_DB_TOKEN ? resolveDefaultDbPath() : path.join(state.folder, step.dbPath);
      state.store = openAgentTraceStore(target);
      state.dbPath = target;
      return null;
    }
    case 'reopen':
      requireStore(state).close();
      state.store = openAgentTraceStore(state.dbPath!);
      return null;
    case 'insertSpans':
      requireStore(state).insertSpans(step.spans);
      return null;
    case 'getSession':
      return requireStore(state).getSession(step.selection);
    case 'getCollectionEnabled':
      return requireStore(state).getCollectionEnabled();
    case 'setCollectionEnabled':
      requireStore(state).setCollectionEnabled(step.enabled);
      return null;
    case 'pruneExpired':
      requireStore(state).pruneExpired(new Date(step.nowMs));
      return null;
    case 'clear':
      requireStore(state).clear();
      return null;
    case 'close':
      requireStore(state).close();
      return null;
    case 'exec': {
      const db = new Database(state.dbPath!);
      try {
        db.prepare(step.sql).run(...step.params);
      } finally {
        db.close();
      }
      return null;
    }
  }
}

function perform(step: Step, state: State): Outcome {
  try {
    return { ok: execute(step, state) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message.split(resolveDefaultDbPath()).join(DEFAULT_DB_TOKEN) };
  }
}

// Reads the file without touching the store's connection. Returns null before a database exists.
function snapshot(dbPath: string | null): unknown {
  if (dbPath === null || !existsSync(dbPath)) {
    return null;
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return {
      schema: db
        .prepare('SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name')
        .all()
        .map((row) => {
          const entry = row as { type: string; name: string; tbl_name: string; sql: string };
          return { ...entry, sql: entry.sql.replace(/\s+/g, ' ').trim() };
        }),
      metadata: db.prepare('SELECT key, value FROM agent_trace_metadata ORDER BY key').all(),
      spans: db
        .prepare(
          'SELECT source, session_id, trace_id, span_id, parent_span_id, started_at, span_json FROM agent_trace_spans ORDER BY source, trace_id, span_id',
        )
        .all(),
    };
  } finally {
    db.close();
  }
}

function runScenario(scenario: Scenario, workDir: string): unknown {
  const folder = path.join(workDir, scenario.name);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });

  const state: State = { folder, store: null, dbPath: null };
  const steps = scenario.steps.map((step) => {
    const result = perform(step, state);
    return { ...step, result, db: snapshot(state.dbPath) };
  });
  state.store?.close();
  return { name: scenario.name, steps };
}

const [outputPath, workDir] = process.argv.slice(2);
if (!outputPath || !workDir) {
  console.error('usage: node agent-trace-store-scenarios.js <output path> <work dir>');
  process.exit(2);
}

const recorded = SCENARIOS.map((scenario) => runScenario(scenario, workDir));
writeFileSync(outputPath, `${JSON.stringify(recorded, null, 2)}\n`);
