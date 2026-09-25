import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentTraceSpan } from '../shared/types';
import { makeAgentTraceSpan } from '../test-utils/agent-trace-fixtures';
import { resolveDefaultDbPath } from './db';
import { openAgentTraceStore, type AgentTraceStore } from './agent-trace-store';

const SESSION = { source: 'vscode' as const, sessionId: 'vscode:conversation-1' };

const openStores = new Set<AgentTraceStore>();
const tempDirs = new Set<string>();

afterEach(() => {
  vi.useRealTimers();

  for (const store of openStores) {
    store.close();
  }
  openStores.clear();

  for (const tempDir of tempDirs) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

function openMemoryStore(): AgentTraceStore {
  const store = openAgentTraceStore(':memory:');
  openStores.add(store);
  return store;
}

function createPersistentStore(): { dbPath: string; store: AgentTraceStore } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-trace-store-'));
  tempDirs.add(tempDir);
  const dbPath = path.join(tempDir, 'agent-trace-store.db');
  const store = openAgentTraceStore(dbPath);
  openStores.add(store);
  return { dbPath, store };
}

function makeSpan(overrides: Partial<AgentTraceSpan> = {}): AgentTraceSpan {
  return {
    source: 'vscode',
    sessionId: 'session-1',
    traceId: 'trace-1',
    spanId: 'span-1',
    parentSpanId: null,
    name: 'tool call',
    category: 'tool',
    toolName: 'search',
    skillName: null,
    model: 'model-a',
    startedAt: '2026-09-25T10:00:00.000Z',
    endedAt: '2026-09-25T10:00:00.001Z',
    durationMs: 1,
    status: 'ok',
    errorType: null,
    toolCallId: null,
    argumentsJson: null,
    resultText: null,
    contentState: 'unavailable',
    ...overrides,
  };
}

function makeLocalIso(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour, 0, 0, 0).toISOString();
}

function makeSessionFilters(overrides: Partial<{
  query: string;
  source: AgentTraceSpan['source'] | null;
  from: string | null;
  to: string | null;
  category: AgentTraceSpan['category'] | null;
  status: AgentTraceSpan['status'] | null;
  page: number;
}> = {}) {
  return {
    query: '',
    source: null,
    from: null,
    to: null,
    category: null,
    status: null,
    page: 0,
    ...overrides,
  };
}

describe('openAgentTraceStore', () => {
  it('returns not-collected when no spans were stored for the selection', () => {
    const store = openMemoryStore();

    expect(store.getSession(SESSION)).toEqual({
      ...SESSION,
      availability: 'not-collected',
      spans: [],
    });
  });

  it('stores sanitized spans once and returns them ordered across all traces in the session', () => {
    const store = openMemoryStore();
    const rootSpan = makeAgentTraceSpan({
      traceId: 'trace-1',
      spanId: 'root-span',
      category: 'agent',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1000,
    });
    const toolSpan = makeAgentTraceSpan({
      traceId: 'trace-1',
      spanId: 'tool-span',
      parentSpanId: 'root-span',
      name: 'execute_tool runCommand',
      category: 'shell',
      toolName: 'runCommand',
      startedAt: '2026-01-01T00:00:00.500Z',
      endedAt: '2026-01-01T00:00:00.900Z',
      durationMs: 400,
    });
    const secondRoot = makeAgentTraceSpan({
      traceId: 'trace-2',
      spanId: 'second-root',
      toolCallId: 'call-2',
      startedAt: '2026-01-01T00:01:00.000Z',
      endedAt: '2026-01-01T00:01:00.100Z',
      durationMs: 100,
    });

    store.insertSpans([secondRoot, rootSpan, toolSpan, rootSpan]);

    const session = store.getSession(SESSION);

    expect(session.availability).toBe('available');
    expect(session.spans).toHaveLength(3);
    expect(session.spans.map((span) => span.spanId)).toEqual(['root-span', 'tool-span', 'second-root']);
  });

  it('persists and rehydrates only allowlisted span fields while preserving nested payload JSON keys', () => {
    const { dbPath, store } = createPersistentStore();
    const argumentsJson = JSON.stringify({
      command: 'echo trace-probe',
      nested: {
        keepMe: true,
        extraConfig: {
          retries: 2,
          mode: 'fast',
        },
      },
    });
    const resultText = JSON.stringify({
      ok: true,
      nested: {
        keepMe: ['alpha', 'beta'],
        metadata: {
          dynamic: 'value',
        },
      },
    });
    const spanWithRuntimeExtra = {
      ...makeAgentTraceSpan({
        traceId: 'trace-runtime-extra',
        spanId: 'span-runtime-extra',
        argumentsJson,
        resultText,
      }),
      runtimeExtra: {
        shouldNotPersist: true,
      },
    };

    store.insertSpans([spanWithRuntimeExtra]);

    const inspector = new Database(dbPath, { readonly: true });
    const stored = inspector.prepare('SELECT span_json FROM agent_trace_spans WHERE span_id = ?').get(
      'span-runtime-extra',
    ) as { span_json: string };
    inspector.close();

    expect(JSON.parse(stored.span_json)).toEqual({
      source: 'vscode',
      sessionId: 'vscode:conversation-1',
      traceId: 'trace-runtime-extra',
      spanId: 'span-runtime-extra',
      parentSpanId: null,
      name: 'invoke_agent copilot',
      category: 'agent',
      toolName: null,
      skillName: null,
      model: 'gpt-5.4',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:00.100Z',
      durationMs: 100,
      status: 'ok',
      errorType: null,
      toolCallId: 'call-1',
      argumentsJson,
      resultText,
      contentState: 'stored',
    });

    const session = store.getSession(SESSION);

    expect(session.spans).toHaveLength(1);
    expect(session.spans[0]).toEqual({
      source: 'vscode',
      sessionId: 'vscode:conversation-1',
      traceId: 'trace-runtime-extra',
      spanId: 'span-runtime-extra',
      parentSpanId: null,
      name: 'invoke_agent copilot',
      category: 'agent',
      toolName: null,
      skillName: null,
      model: 'gpt-5.4',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:00.100Z',
      durationMs: 100,
      status: 'ok',
      errorType: null,
      toolCallId: 'call-1',
      argumentsJson,
      resultText,
      contentState: 'stored',
    });
    expect(session.spans[0]).not.toHaveProperty('runtimeExtra');
  });

  it('marks the session partial when tool spans are unparented or reference a missing parent', () => {
    const store = openMemoryStore();
    const rootSpan = makeAgentTraceSpan({
      traceId: 'trace-1',
      spanId: 'root-span',
      category: 'agent',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    const missingParentTool = makeAgentTraceSpan({
      traceId: 'trace-1',
      spanId: 'orphaned-tool',
      parentSpanId: 'missing-parent',
      name: 'execute_tool runCommand',
      category: 'shell',
      toolName: 'runCommand',
      startedAt: '2026-01-01T00:00:01.000Z',
    });
    const rootlessTool = makeAgentTraceSpan({
      traceId: 'trace-2',
      spanId: 'rootless-tool',
      parentSpanId: null,
      name: 'execute_tool listFiles',
      category: 'tool',
      toolName: 'listFiles',
      startedAt: '2026-01-01T00:00:02.000Z',
    });

    store.insertSpans([rootSpan, missingParentTool, rootlessTool]);

    const session = store.getSession(SESSION);

    expect(session.availability).toBe('partial');
    expect(session.spans.map((span) => span.spanId)).toEqual(['root-span', 'orphaned-tool', 'rootless-tool']);
  });

  it('marks the session partial when a tool span does not have sanitized payloads to display', () => {
    const store = openMemoryStore();
    const rootSpan = makeAgentTraceSpan({
      traceId: 'trace-1',
      spanId: 'root-span',
      category: 'agent',
    });
    const toolSpan = makeAgentTraceSpan({
      traceId: 'trace-1',
      spanId: 'tool-span',
      parentSpanId: 'root-span',
      name: 'execute_tool runCommand',
      category: 'shell',
      toolName: 'runCommand',
      argumentsJson: null,
      resultText: null,
      contentState: 'unavailable',
    });

    store.insertSpans([rootSpan, toolSpan]);

    expect(store.getSession(SESSION).availability).toBe('partial');
  });

  it('marks the session partial when a stored span is incomplete', () => {
    const { dbPath, store } = createPersistentStore();
    store.insertSpans([
      makeAgentTraceSpan({
        traceId: 'trace-1',
        spanId: 'root-span',
        category: 'agent',
      }),
    ]);
    store.close();
    openStores.delete(store);

    const db = new Database(dbPath);
    db.prepare(`UPDATE agent_trace_spans SET span_json = ? WHERE span_id = ?`).run(
      JSON.stringify({
        source: 'vscode',
        sessionId: 'vscode:conversation-1',
        traceId: 'trace-1',
        spanId: 'root-span',
        parentSpanId: null,
        name: 'invoke_agent copilot',
        category: 'agent',
      }),
      'root-span',
    );
    db.close();

    const reopened = openAgentTraceStore(dbPath);
    openStores.add(reopened);

    const session = reopened.getSession(SESSION);

    expect(session.availability).toBe('partial');
    expect(session.spans).toEqual([]);
  });

  it('prunes spans older than 30 days while keeping newer spans', () => {
    vi.useFakeTimers();
    const store = openMemoryStore();
    const now = new Date('2026-02-01T00:00:00.000Z');

    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    store.insertSpans([
      makeAgentTraceSpan({
        traceId: 'expired-trace',
        spanId: 'expired-span',
        startedAt: '2026-01-01T00:00:00.000Z',
      }),
    ]);

    vi.setSystemTime(new Date('2026-01-03T00:00:00.000Z'));
    store.insertSpans([
      makeAgentTraceSpan({
        traceId: 'kept-trace',
        spanId: 'kept-span',
        startedAt: '2026-01-03T00:00:00.000Z',
      }),
    ]);

    store.pruneExpired(now);

    const session = store.getSession(SESSION);

    expect(session.spans.map((span) => span.spanId)).toEqual(['kept-span']);
  });

  it('prunes expired spans when the store opens and again before reads', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const { dbPath, store } = createPersistentStore();
    store.insertSpans([
      makeAgentTraceSpan({
        traceId: 'expired-trace',
        spanId: 'expired-on-open',
        startedAt: '2026-01-01T00:00:00.000Z',
      }),
    ]);
    store.close();
    openStores.delete(store);

    vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
    const reopened = openAgentTraceStore(dbPath);
    openStores.add(reopened);

    const inspector = new Database(dbPath, { readonly: true });
    const rowCountAfterOpen = (
      inspector.prepare('SELECT COUNT(*) AS count FROM agent_trace_spans').get() as { count: number }
    ).count;
    inspector.close();

    expect(rowCountAfterOpen).toBe(0);

    reopened.insertSpans([
      makeAgentTraceSpan({
        traceId: 'read-prune-trace',
        spanId: 'pruned-on-read',
        startedAt: '2026-02-01T00:00:00.000Z',
      }),
    ]);

    vi.setSystemTime(new Date('2026-03-04T00:00:00.000Z'));

    expect(reopened.getSession(SESSION)).toEqual({
      ...SESSION,
      availability: 'not-collected',
      spans: [],
    });
  });

  it('keeps collection disabled by default, persists the preference, and clear only removes spans', () => {
    const { dbPath, store } = createPersistentStore();
    store.insertSpans([
      makeAgentTraceSpan({
        traceId: 'trace-1',
        spanId: 'root-span',
      }),
    ]);

    expect(store.getCollectionEnabled()).toBe(false);

    store.setCollectionEnabled(true);
    store.clear();

    expect(store.getCollectionEnabled()).toBe(true);
    expect(store.getSession(SESSION).availability).toBe('not-collected');

    store.close();
    openStores.delete(store);

    const reopened = openAgentTraceStore(dbPath);
    openStores.add(reopened);

    expect(reopened.getCollectionEnabled()).toBe(true);
    expect(reopened.getSession(SESSION)).toEqual({
      ...SESSION,
      availability: 'not-collected',
      spans: [],
    });
  });

  it('refuses to open the Copilot CLI usage database path for writable trace storage', () => {
    expect(() => openAgentTraceStore(resolveDefaultDbPath())).toThrow(/Copilot CLI/i);
  });

  it('counts distinct source/session pairs, not session IDs alone', () => {
    const store = openMemoryStore();
    try {
      store.insertSpans([
        makeSpan({ source: 'vscode', sessionId: 'shared', traceId: 'vscode-trace', spanId: 'vscode-1' }),
        makeSpan({ source: 'vscode', sessionId: 'shared', traceId: 'vscode-trace', spanId: 'vscode-2' }),
        makeSpan({ source: 'copilot-cli', sessionId: 'shared', traceId: 'cli-trace', spanId: 'cli-1' }),
      ]);

      expect(store.countSessions()).toBe(2);
    } finally {
      store.close();
    }
  });

  it('returns an empty first page when no sessions match filters', () => {
    const store = openMemoryStore();
    try {
      expect(store.listSessions(makeSessionFilters())).toEqual({
        items: [],
        total: 0,
        page: 0,
        pageSize: 50,
      });
    } finally {
      store.close();
    }
  });

  it('searches session IDs, tool names, skill names, and models with a trimmed literal query', () => {
    const store = openMemoryStore();
    try {
      store.insertSpans([
        makeSpan({ sessionId: 'literal%session', traceId: 'literal', spanId: 'literal-1' }),
        makeSpan({ sessionId: 'tool-session', traceId: 'tool', spanId: 'tool-1', toolName: 'literal search' }),
        makeSpan({ sessionId: 'skill-session', traceId: 'skill', spanId: 'skill-1', skillName: 'literal helper' }),
        makeSpan({ sessionId: 'model-session', traceId: 'model', spanId: 'model-1', model: 'literal-model' }),
        makeSpan({ sessionId: 'literal_session', traceId: 'underscore', spanId: 'underscore-1' }),
      ]);

      expect(store.listSessions(makeSessionFilters({ query: '  literal%  ' })).items).toEqual([
        { source: 'vscode', sessionId: 'literal%session', spanCount: 1 },
      ]);
      expect(store.listSessions(makeSessionFilters({ query: 'literal' })).items).toEqual([
        { source: 'vscode', sessionId: 'literal%session', spanCount: 1 },
        { source: 'vscode', sessionId: 'literal_session', spanCount: 1 },
        { source: 'vscode', sessionId: 'model-session', spanCount: 1 },
        { source: 'vscode', sessionId: 'skill-session', spanCount: 1 },
        { source: 'vscode', sessionId: 'tool-session', spanCount: 1 },
      ]);
    } finally {
      store.close();
    }
  });

  it('truncates search queries to 200 characters before matching', () => {
    const store = openMemoryStore();
    try {
      const exactSessionId = 'x'.repeat(200);
      store.insertSpans([
        makeSpan({ sessionId: exactSessionId, traceId: 'long', spanId: 'long-1' }),
      ]);

      expect(store.listSessions(makeSessionFilters({ query: `${'x'.repeat(210)}trimmed-away` })).items).toEqual([
        { source: 'vscode', sessionId: exactSessionId, spanCount: 1 },
      ]);
    } finally {
      store.close();
    }
  });

  it('filters sessions by source', () => {
    const store = openMemoryStore();
    try {
      store.insertSpans([
        makeSpan({ source: 'vscode', sessionId: 'editor-session', traceId: 'editor', spanId: 'editor-1' }),
        makeSpan({ source: 'copilot-cli', sessionId: 'cli-session', traceId: 'cli', spanId: 'cli-1' }),
      ]);

      expect(store.listSessions(makeSessionFilters({ source: 'copilot-cli' })).items).toEqual([
        { source: 'copilot-cli', sessionId: 'cli-session', spanCount: 1 },
      ]);
    } finally {
      store.close();
    }
  });

  it('filters sessions by inclusive local-day date bounds', () => {
    const store = openMemoryStore();
    try {
      store.insertSpans([
        makeSpan({
          sessionId: 'day-before',
          traceId: 'day-before',
          spanId: 'day-before-1',
          startedAt: makeLocalIso(2026, 9, 24),
        }),
        makeSpan({
          sessionId: 'day-of',
          traceId: 'day-of',
          spanId: 'day-of-1',
          startedAt: makeLocalIso(2026, 9, 25),
        }),
        makeSpan({
          sessionId: 'day-after',
          traceId: 'day-after',
          spanId: 'day-after-1',
          startedAt: makeLocalIso(2026, 9, 26),
        }),
      ]);

      expect(store.listSessions(makeSessionFilters({ from: '2026-09-25', to: '2026-09-25' })).items).toEqual([
        { source: 'vscode', sessionId: 'day-of', spanCount: 1 },
      ]);
    } finally {
      store.close();
    }
  });

  it('filters sessions by category', () => {
    const store = openMemoryStore();
    try {
      store.insertSpans([
        makeSpan({ sessionId: 'tool-session', traceId: 'tool', spanId: 'tool-1', category: 'tool' }),
        makeSpan({ sessionId: 'llm-session', traceId: 'llm', spanId: 'llm-1', category: 'llm' }),
      ]);

      expect(store.listSessions(makeSessionFilters({ category: 'llm' })).items).toEqual([
        { source: 'vscode', sessionId: 'llm-session', spanCount: 1 },
      ]);
    } finally {
      store.close();
    }
  });

  it('filters sessions by status', () => {
    const store = openMemoryStore();
    try {
      store.insertSpans([
        makeSpan({ sessionId: 'ok-session', traceId: 'ok', spanId: 'ok-1', status: 'ok' }),
        makeSpan({ sessionId: 'error-session', traceId: 'error', spanId: 'error-1', status: 'error' }),
      ]);

      expect(store.listSessions(makeSessionFilters({ status: 'error' })).items).toEqual([
        { source: 'vscode', sessionId: 'error-session', spanCount: 1 },
      ]);
    } finally {
      store.close();
    }
  });

  it('filters sessions by fields from the same matching span', () => {
    const store = openMemoryStore();
    try {
      store.insertSpans([
        makeSpan({ source: 'vscode', sessionId: 'matching', traceId: 'match', spanId: 'match-1' }),
        makeSpan({ source: 'vscode', sessionId: 'matching', traceId: 'match', spanId: 'match-2', category: 'llm', status: 'error', model: 'model-b' }),
        makeSpan({ source: 'vscode', sessionId: 'split-match', traceId: 'split', spanId: 'split-1', category: 'llm' }),
        makeSpan({ source: 'vscode', sessionId: 'split-match', traceId: 'split', spanId: 'split-2', model: 'model-b' }),
        makeSpan({ source: 'copilot-cli', sessionId: 'wrong-source', traceId: 'source', spanId: 'source-1' }),
      ]);

      const page = store.listSessions({
        query: 'model-a',
        source: 'vscode',
        from: '2026-09-25',
        to: '2026-09-25',
        category: 'tool',
        status: 'ok',
        page: 0,
      });

      expect(page.items).toEqual([{ source: 'vscode', sessionId: 'matching', spanCount: 2 }]);
      expect(page.total).toBe(1);
    } finally {
      store.close();
    }
  });

  it('paginates distinct sessions with 50 items on page 0 and the remainder on page 1', () => {
    const store = openMemoryStore();
    try {
      store.insertSpans(
        Array.from({ length: 51 }, (_, index) => makeSpan({
          sessionId: `session-${index.toString().padStart(2, '0')}`,
          traceId: `trace-${index.toString().padStart(2, '0')}`,
          spanId: `span-${index.toString().padStart(2, '0')}`,
          startedAt: '2026-09-25T10:00:00.000Z',
        })),
      );

      expect(store.listSessions(makeSessionFilters({ page: 0 }))).toEqual({
        items: Array.from({ length: 50 }, (_, index) => ({
          source: 'vscode' as const,
          sessionId: `session-${index.toString().padStart(2, '0')}`,
          spanCount: 1,
        })),
        total: 51,
        page: 0,
        pageSize: 50,
      });
      expect(store.listSessions(makeSessionFilters({ page: 1 }))).toEqual({
        items: [{ source: 'vscode', sessionId: 'session-50', spanCount: 1 }],
        total: 51,
        page: 1,
        pageSize: 50,
      });
    } finally {
      store.close();
    }
  });
});
