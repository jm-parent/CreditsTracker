import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  ConversationSummary,
  FilterOptions,
  ProjectDetailResult,
  RawTableName,
  RawTablePage,
  TimeSeriesPoint,
  UsageFilters,
  UsageResult,
} from '../shared/types';

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

  const timeSeries = db
    .prepare(
      `SELECT date(e.created_at) AS date, SUM(e.total_nano_aiu) / 1e9 AS aiuCredits
       ${baseFrom}
       GROUP BY date(e.created_at)
       ORDER BY date(e.created_at)`,
    )
    .all(params) as Array<{ date: string; aiuCredits: number }>;

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
