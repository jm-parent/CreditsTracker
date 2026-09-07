import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { openDatabase, resolveDefaultDbPath, DatabaseNotFoundError } from './db';

describe('resolveDefaultDbPath', () => {
  it('points at ~/.copilot/session-store.db', () => {
    const expected = path.join(os.homedir(), '.copilot', 'session-store.db');
    expect(resolveDefaultDbPath()).toBe(expected);
  });
});

describe('openDatabase', () => {
  it('opens an existing sqlite file read-only', () => {
    const tmpPath = path.join(os.tmpdir(), `credits-tracker-test-${Date.now()}.db`);
    new Database(tmpPath).close(); // create an empty valid sqlite file
    const db = openDatabase(tmpPath);
    expect(db.open).toBe(true);
    db.close();
    fs.unlinkSync(tmpPath);
  });

  it('throws DatabaseNotFoundError when the file does not exist', () => {
    const missingPath = path.join(os.tmpdir(), `credits-tracker-missing-${Date.now()}.db`);
    expect(() => openDatabase(missingPath)).toThrow(DatabaseNotFoundError);
  });
});
