import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
});
