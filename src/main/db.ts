import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { FilterOptions } from '../shared/types';

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
