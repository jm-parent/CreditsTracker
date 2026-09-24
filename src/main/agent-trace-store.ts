import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  AgentTraceCategory,
  AgentTraceSelection,
  AgentTraceSession,
  AgentTraceSpan,
} from '../shared/types';
import { resolveDefaultDbPath } from './db';

const COLLECTION_ENABLED_KEY = 'collectionEnabled';
const RETENTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const VALID_SOURCES = new Set(['vscode', 'copilot-cli']);
const VALID_CATEGORIES = new Set(['agent', 'llm', 'tool', 'skill', 'shell', 'mcp', 'hook', 'other']);
const VALID_CONTENT_STATES = new Set([
  'unavailable',
  'stored',
  'redacted',
  'truncated',
  'redacted-truncated',
  'omitted',
]);
const VALID_STATUSES = new Set(['unset', 'ok', 'error']);

export interface AgentTraceStore {
  insertSpans(spans: readonly AgentTraceSpan[]): void;
  getSession(selection: AgentTraceSelection): AgentTraceSession;
  getCollectionEnabled(): boolean;
  setCollectionEnabled(enabled: boolean): void;
  pruneExpired(now: Date): void;
  clear(): void;
  close(): void;
}

interface SpanRow {
  source: string;
  session_id: string;
  trace_id: string;
  span_id: string;
  started_at: string;
  span_json: string;
}

interface MetadataRow {
  value: string;
}

export function openAgentTraceStore(dbPath: string): AgentTraceStore {
  if (isProtectedUsageDatabasePath(dbPath)) {
    throw new Error(`Refusing to open the Copilot CLI usage database for writable agent traces: ${dbPath}`);
  }

  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  let closed = false;

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_trace_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_trace_spans (
      source TEXT NOT NULL,
      session_id TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      span_id TEXT NOT NULL,
      parent_span_id TEXT,
      started_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      span_json TEXT NOT NULL,
      PRIMARY KEY (source, trace_id, span_id)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_trace_session
      ON agent_trace_spans (source, session_id, started_at);
  `);

  const insertSpanStatement = db.prepare(`
    INSERT OR IGNORE INTO agent_trace_spans (
      source,
      session_id,
      trace_id,
      span_id,
      parent_span_id,
      started_at,
      received_at,
      span_json
    ) VALUES (
      @source,
      @session_id,
      @trace_id,
      @span_id,
      @parent_span_id,
      @started_at,
      @received_at,
      @span_json
    )
  `);
  const insertSpansTransaction = db.transaction((spans: readonly AgentTraceSpan[]) => {
    const receivedAt = new Date().toISOString();
    for (const span of spans) {
      insertSpanStatement.run({
        source: span.source,
        session_id: span.sessionId,
        trace_id: span.traceId,
        span_id: span.spanId,
        parent_span_id: span.parentSpanId,
        started_at: span.startedAt,
        received_at: receivedAt,
        span_json: JSON.stringify(projectStoredSpan(span)),
      });
    }
  });
  const selectSessionRows = db.prepare(`
    SELECT source, session_id, trace_id, span_id, started_at, span_json
    FROM agent_trace_spans
    WHERE source = ? AND session_id = ?
    ORDER BY started_at ASC, trace_id ASC, span_id ASC
  `);
  const selectCollectionEnabled = db.prepare(`
    SELECT value
    FROM agent_trace_metadata
    WHERE key = ?
  `);
  const upsertCollectionEnabled = db.prepare(`
    INSERT INTO agent_trace_metadata (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const deleteExpired = db.prepare(`
    DELETE FROM agent_trace_spans
    WHERE received_at < ?
  `);
  const clearSpans = db.prepare('DELETE FROM agent_trace_spans');

  const store: AgentTraceStore = {
    insertSpans(spans) {
      ensureOpen(closed);
      if (spans.length === 0) {
        return;
      }
      insertSpansTransaction(spans);
    },

    getSession(selection) {
      ensureOpen(closed);
      store.pruneExpired(new Date());

      const rows = selectSessionRows.all(selection.source, selection.sessionId) as SpanRow[];
      if (rows.length === 0) {
        return {
          source: selection.source,
          sessionId: selection.sessionId,
          availability: 'not-collected',
          spans: [],
        };
      }

      let partial = false;
      const spans: AgentTraceSpan[] = [];

      for (const row of rows) {
        const span = parseStoredSpan(row);
        if (!span) {
          partial = true;
          continue;
        }

        spans.push(span);
      }

      const traceSpanIds = new Map<string, Set<string>>();
      for (const span of spans) {
        const spanIds = traceSpanIds.get(span.traceId) ?? new Set<string>();
        spanIds.add(span.spanId);
        traceSpanIds.set(span.traceId, spanIds);
      }

      for (const span of spans) {
        if (span.parentSpanId === null) {
          if (span.category !== 'agent') {
            partial = true;
          }
          continue;
        }

        const spanIds = traceSpanIds.get(span.traceId);
        if (!spanIds?.has(span.parentSpanId)) {
          partial = true;
        }
      }

      if (spans.some(isIncompleteToolSpan)) {
        partial = true;
      }

      spans.sort(compareSpans);

      return {
        source: selection.source,
        sessionId: selection.sessionId,
        availability: partial ? 'partial' : 'available',
        spans,
      };
    },

    getCollectionEnabled() {
      ensureOpen(closed);
      const row = selectCollectionEnabled.get(COLLECTION_ENABLED_KEY) as MetadataRow | undefined;
      return row?.value === 'true';
    },

    setCollectionEnabled(enabled) {
      ensureOpen(closed);
      upsertCollectionEnabled.run(COLLECTION_ENABLED_KEY, enabled ? 'true' : 'false');
    },

    pruneExpired(now) {
      ensureOpen(closed);
      deleteExpired.run(expirationThreshold(now).toISOString());
    },

    clear() {
      ensureOpen(closed);
      clearSpans.run();
    },

    close() {
      if (closed) {
        return;
      }
      closed = true;
      db.close();
    },
  };

  store.pruneExpired(new Date());
  return store;
}

function parseStoredSpan(row: SpanRow): AgentTraceSpan | null {
  try {
    const parsed = JSON.parse(row.span_json);
    if (!isStoredAgentTraceSpan(parsed)) {
      return null;
    }

    if (
      parsed.source !== row.source
      || parsed.sessionId !== row.session_id
      || parsed.traceId !== row.trace_id
      || parsed.spanId !== row.span_id
      || parsed.startedAt !== row.started_at
    ) {
      return null;
    }

    return projectStoredSpan(parsed);
  } catch {
    return null;
  }
}

function projectStoredSpan(span: AgentTraceSpan): AgentTraceSpan {
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

function isStoredAgentTraceSpan(value: unknown): value is AgentTraceSpan {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.source === 'string'
    && VALID_SOURCES.has(value.source as AgentTraceSpan['source'])
    && typeof value.sessionId === 'string'
    && typeof value.traceId === 'string'
    && typeof value.spanId === 'string'
    && (value.parentSpanId === null || typeof value.parentSpanId === 'string')
    && typeof value.name === 'string'
    && typeof value.category === 'string'
    && VALID_CATEGORIES.has(value.category as AgentTraceSpan['category'])
    && isNullableString(value.toolName)
    && isNullableString(value.skillName)
    && isNullableString(value.model)
    && isIsoDate(value.startedAt)
    && isIsoDate(value.endedAt)
    && typeof value.durationMs === 'number'
    && Number.isFinite(value.durationMs)
    && typeof value.status === 'string'
    && VALID_STATUSES.has(value.status as AgentTraceSpan['status'])
    && isNullableString(value.errorType)
    && isNullableString(value.toolCallId)
    && isNullableString(value.argumentsJson)
    && isNullableString(value.resultText)
    && typeof value.contentState === 'string'
    && VALID_CONTENT_STATES.has(value.contentState as AgentTraceSpan['contentState'])
  );
}

function isIncompleteToolSpan(span: AgentTraceSpan): boolean {
  if (!isToolLikeCategory(span.category)) {
    return false;
  }

  return span.argumentsJson === null || span.resultText === null;
}

function isToolLikeCategory(category: AgentTraceCategory): boolean {
  return category === 'tool'
    || category === 'shell'
    || category === 'skill'
    || category === 'mcp'
    || category === 'hook';
}

function compareSpans(left: AgentTraceSpan, right: AgentTraceSpan): number {
  const byStart = left.startedAt.localeCompare(right.startedAt);
  if (byStart !== 0) {
    return byStart;
  }

  const byTrace = left.traceId.localeCompare(right.traceId);
  if (byTrace !== 0) {
    return byTrace;
  }

  return left.spanId.localeCompare(right.spanId);
}

function expirationThreshold(now: Date): Date {
  return new Date(now.getTime() - RETENTION_WINDOW_MS);
}

function isProtectedUsageDatabasePath(dbPath: string): boolean {
  if (dbPath === ':memory:') {
    return false;
  }

  return normalizePathCase(path.resolve(dbPath)) === normalizePathCase(path.resolve(resolveDefaultDbPath()));
}

function normalizePathCase(filePath: string): string {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath;
}

function ensureOpen(closed: boolean): void {
  if (closed) {
    throw new Error('Agent trace store is closed');
  }
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
