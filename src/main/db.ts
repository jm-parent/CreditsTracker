import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  ConversationSummary,
  FilterOptions,
  HourlyDetailParams,
  HourlyPoint,
  ProjectDetailResult,
  RawTableName,
  RawTablePage,
  TimeSeriesPoint,
  UsageFilters,
  UsageResult,
} from '../shared/types';
import type { VscodeUsageData } from './vscode-chat-store';

const RAW_TABLES: readonly RawTableName[] = ['sessions', 'assistant_usage_events'];

export class DatabaseNotFoundError extends Error {
  constructor(public readonly dbPath: string) {
    super(`Copilot CLI session database not found at ${dbPath}`);
    this.name = 'DatabaseNotFoundError';
  }
}

export function resolveDefaultDbPath(): string {
  return path.join(os.homedir(), '.copilot', 'session-store.db');
}

export function openDatabase(dbPath: string): Database.Database {
  if (!fs.existsSync(dbPath)) {
    throw new DatabaseNotFoundError(dbPath);
  }
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

export function getFilterOptions(db: Database.Database): FilterOptions {
  const projects = db
    .prepare(
      `SELECT DISTINCT COALESCE(s.repository, s.cwd) AS project
       FROM sessions s
       JOIN assistant_usage_events e ON e.session_id = s.id
       WHERE COALESCE(s.repository, s.cwd) IS NOT NULL
       ORDER BY project`,
    )
    .all()
    .map((row) => (row as { project: string }).project);

  const models = db
    .prepare(`SELECT DISTINCT model FROM assistant_usage_events ORDER BY model`)
    .all()
    .map((row) => (row as { model: string }).model);

  const bounds = db
    .prepare(
      `SELECT MIN(date(created_at)) AS minDate, MAX(date(created_at)) AS maxDate
       FROM assistant_usage_events`,
    )
    .get() as { minDate: string | null; maxDate: string | null };

  return {
    projects,
    models,
    minDate: bounds.minDate,
    maxDate: bounds.maxDate,
  };
}

interface WhereClause {
  sql: string;
  params: Record<string, string>;
}

function buildWhereClause(filters: UsageFilters): WhereClause {
  const conditions: string[] = [];
  const params: Record<string, string> = {};

  if (filters.project) {
    conditions.push('COALESCE(s.repository, s.cwd) = @project');
    params.project = filters.project;
  }
  if (filters.model) {
    conditions.push('e.model = @model');
    params.model = filters.model;
  }
  if (filters.from) {
    conditions.push('date(e.created_at) >= @from');
    params.from = filters.from;
  }
  if (filters.to) {
    conditions.push('date(e.created_at) <= @to');
    params.to = filters.to;
  }

  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export function getUsage(db: Database.Database, filters: UsageFilters): UsageResult {
  const { sql: whereSql, params } = buildWhereClause(filters);
  const baseFrom = `FROM assistant_usage_events e JOIN sessions s ON s.id = e.session_id ${whereSql}`;

  const totalsRow = db
    .prepare(
      `SELECT
         COALESCE(SUM(e.total_nano_aiu), 0) / 1e9 AS aiuCredits,
         COALESCE(SUM(e.input_tokens + e.output_tokens), 0) AS tokens,
         COUNT(*) AS requests
       ${baseFrom}`,
    )
    .get(params) as { aiuCredits: number; tokens: number; requests: number };

  const timeSeriesRows = db
    .prepare(
      `SELECT date(e.created_at) AS date, SUM(e.total_nano_aiu) / 1e9 AS aiuCredits
       ${baseFrom}
       GROUP BY date(e.created_at)
       ORDER BY date(e.created_at)`,
    )
    .all(params) as Array<{ date: string; aiuCredits: number }>;

  const timeSeriesByProjectRows = db
    .prepare(
      `SELECT date(e.created_at) AS date, COALESCE(s.repository, s.cwd) AS project, SUM(e.total_nano_aiu) / 1e9 AS aiuCredits
       ${baseFrom}
       GROUP BY date(e.created_at), project
       ORDER BY date(e.created_at)`,
    )
    .all(params) as Array<{ date: string; project: string | null; aiuCredits: number }>;

  const byProjectPerDate = new Map<string, Record<string, number>>();
  for (const row of timeSeriesByProjectRows) {
    if (!row.project) continue;
    const entry = byProjectPerDate.get(row.date) ?? {};
    entry[row.project] = row.aiuCredits;
    byProjectPerDate.set(row.date, entry);
  }

  const timeSeries = timeSeriesRows.map((row) => ({
    ...row,
    byProject: byProjectPerDate.get(row.date) ?? {},
  }));

  const byProject = db
    .prepare(
      `SELECT COALESCE(s.repository, s.cwd) AS key, SUM(e.total_nano_aiu) / 1e9 AS aiuCredits
       ${baseFrom}
       GROUP BY key
       ORDER BY key`,
    )
    .all(params) as Array<{ key: string; aiuCredits: number }>;

  const byModel = db
    .prepare(
      `SELECT e.model AS key, SUM(e.total_nano_aiu) / 1e9 AS aiuCredits
       ${baseFrom}
       GROUP BY e.model
       ORDER BY e.model`,
    )
    .all(params) as Array<{ key: string; aiuCredits: number }>;

  return {
    totals: totalsRow,
    timeSeries,
    byProject,
    byModel,
  };
}

export function getHourlyDetail(
  db: Database.Database,
  params: HourlyDetailParams,
): HourlyPoint[] {
  const { date, ...filters } = params;
  const { sql: whereSql, params: whereParams } = buildWhereClause(filters);
  const dateCondition = whereSql
    ? `${whereSql} AND date(e.created_at) = @date`
    : 'WHERE date(e.created_at) = @date';
  const baseFrom = `FROM assistant_usage_events e JOIN sessions s ON s.id = e.session_id ${dateCondition}`;
  const queryParams = { ...whereParams, date };

  const hourlyByProjectRows = db
    .prepare(
      `SELECT strftime('%H:00', e.created_at) AS hour, COALESCE(s.repository, s.cwd) AS project, SUM(e.total_nano_aiu) / 1e9 AS aiuCredits
       ${baseFrom}
       GROUP BY hour, project
       ORDER BY hour`,
    )
    .all(queryParams) as Array<{ hour: string; project: string | null; aiuCredits: number }>;

  const byHour = new Map<string, { aiuCredits: number; byProject: Record<string, number> }>();
  for (const row of hourlyByProjectRows) {
    const entry = byHour.get(row.hour) ?? { aiuCredits: 0, byProject: {} };
    entry.aiuCredits += row.aiuCredits;
    if (row.project) {
      entry.byProject[row.project] = (entry.byProject[row.project] ?? 0) + row.aiuCredits;
    }
    byHour.set(row.hour, entry);
  }

  return Array.from(byHour.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, entry]) => ({ hour, aiuCredits: entry.aiuCredits, byProject: entry.byProject }));
}

export function getProjectDetail(
  db: Database.Database,
  filters: UsageFilters & { project: string },
): ProjectDetailResult {
  const { sql: whereSql, params } = buildWhereClause(filters);
  const baseFrom = `FROM assistant_usage_events e JOIN sessions s ON s.id = e.session_id ${whereSql}`;

  const totalsRow = db
    .prepare(
      `SELECT
         COALESCE(SUM(e.total_nano_aiu), 0) / 1e9 AS aiuCredits,
         COALESCE(SUM(e.input_tokens + e.output_tokens), 0) AS tokens,
         COUNT(*) AS requests
       ${baseFrom}`,
    )
    .get(params) as { aiuCredits: number; tokens: number; requests: number };

  const timeSeries = db
    .prepare(
      `SELECT date(e.created_at) AS date, SUM(e.total_nano_aiu) / 1e9 AS aiuCredits
       ${baseFrom}
       GROUP BY date(e.created_at)
       ORDER BY date(e.created_at)`,
    )
    .all(params) as TimeSeriesPoint[];

  const conversations = db
    .prepare(
      `SELECT
         s.id AS sessionId,
         s.created_at AS createdAt,
         s.summary AS summary,
         GROUP_CONCAT(DISTINCT e.model) AS models,
         SUM(e.total_nano_aiu) / 1e9 AS aiuCredits,
         SUM(e.input_tokens + e.output_tokens) AS tokens,
         COUNT(*) AS requests
       ${baseFrom}
       GROUP BY s.id
       ORDER BY s.created_at DESC`,
    )
    .all(params) as ConversationSummary[];

  return {
    project: filters.project,
    totals: totalsRow,
    timeSeries,
    conversations,
  };
}

export function getRawTablePage(
  db: Database.Database,
  table: RawTableName,
  page: number,
  pageSize: number,
): RawTablePage {
  if (!RAW_TABLES.includes(table)) {
    throw new Error(`Unknown table: ${table}`);
  }
  const safePage = Math.max(0, Math.floor(page));
  const safePageSize = Math.min(500, Math.max(1, Math.floor(pageSize)));
  const offset = safePage * safePageSize;

  const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };

  const rows = db
    .prepare(`SELECT * FROM ${table} ORDER BY rowid DESC LIMIT @limit OFFSET @offset`)
    .all({ limit: safePageSize, offset }) as Array<Record<string, unknown>>;

  const columns = rows.length > 0 ? Object.keys(rows[0]) : getTableColumns(db, table);

  return {
    columns,
    rows,
    total: totalRow.count,
    page: safePage,
    pageSize: safePageSize,
  };
}

function getTableColumns(db: Database.Database, table: RawTableName): string[] {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return info.map((col) => col.name);
}

const MERGED_SESSION_COLUMNS = ['id', 'cwd', 'repository', 'summary', 'created_at'] as const;
const MERGED_EVENT_COLUMNS = [
  'session_id',
  'model',
  'total_nano_aiu',
  'input_tokens',
  'output_tokens',
  'created_at',
] as const;

/** Returns the subset of `wanted` columns that actually exist on `table` in `db`. */
function intersectColumns(db: Database.Database, table: string, wanted: readonly string[]): string[] {
  const existing = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((col) => col.name),
  );
  return wanted.filter((col) => existing.has(col));
}

/**
 * Builds an in-memory SQLite database that combines Copilot CLI usage (read
 * from `cliDb`) with Copilot Chat usage recorded by the VS Code extension
 * (already normalized into `vscodeData`). Only the columns consumed by the
 * queries in this module are carried over from `cliDb`, so the merged schema
 * stays stable regardless of which extra columns the real CLI database has.
 * All existing query functions (`getUsage`, `getFilterOptions`, etc.) operate
 * on the returned database exactly as they would on the raw CLI database.
 */
export function buildMergedDatabase(cliDb: Database.Database, vscodeData: VscodeUsageData): Database.Database {
  const merged = new Database(':memory:');
  merged.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT,
      repository TEXT,
      summary TEXT,
      created_at TEXT
    );
    CREATE TABLE assistant_usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      model TEXT NOT NULL,
      total_nano_aiu INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      created_at TEXT
    );
  `);

  const insertSession = merged.prepare(
    `INSERT OR IGNORE INTO sessions (id, cwd, repository, summary, created_at)
     VALUES (@id, @cwd, @repository, @summary, @created_at)`,
  );
  const insertEvent = merged.prepare(
    `INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
     VALUES (@session_id, @model, @total_nano_aiu, @input_tokens, @output_tokens, @created_at)`,
  );

  const sessionColumns = intersectColumns(cliDb, 'sessions', MERGED_SESSION_COLUMNS);
  const cliSessions = cliDb
    .prepare(`SELECT ${sessionColumns.join(', ')} FROM sessions`)
    .all() as Array<Record<string, unknown>>;
  for (const row of cliSessions) {
    insertSession.run({
      id: row.id ?? null,
      cwd: row.cwd ?? null,
      repository: row.repository ?? null,
      summary: row.summary ?? null,
      created_at: row.created_at ?? null,
    });
  }

  const eventColumns = intersectColumns(cliDb, 'assistant_usage_events', MERGED_EVENT_COLUMNS);
  const cliEvents = cliDb
    .prepare(`SELECT ${eventColumns.join(', ')} FROM assistant_usage_events`)
    .all() as Array<Record<string, unknown>>;
  for (const row of cliEvents) {
    insertEvent.run({
      session_id: row.session_id ?? null,
      model: row.model ?? null,
      total_nano_aiu: row.total_nano_aiu ?? null,
      input_tokens: row.input_tokens ?? null,
      output_tokens: row.output_tokens ?? null,
      created_at: row.created_at ?? null,
    });
  }

  for (const session of vscodeData.sessions) {
    insertSession.run({
      id: `vscode:${session.sessionId}`,
      cwd: session.project,
      repository: session.project,
      summary: session.summary,
      created_at: session.createdAt,
    });
  }
  for (const event of vscodeData.events) {
    insertEvent.run({
      session_id: `vscode:${event.sessionId}`,
      model: event.model,
      total_nano_aiu: Math.round(event.aiuCredits * 1e9),
      input_tokens: event.inputTokens,
      output_tokens: event.outputTokens,
      created_at: event.createdAt,
    });
  }

  return merged;
}
