import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

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
