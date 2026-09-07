import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { openDatabase, resolveDefaultDbPath, DatabaseNotFoundError, getFilterOptions } from './db';

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

function seedSchemaAndFixtures(db: Database.Database): void {
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT,
      repository TEXT,
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
  db.prepare(`INSERT INTO sessions (id, cwd, repository, created_at) VALUES (?, ?, ?, ?)`)
    .run('s1', 'C:/repo-a', 'org/repo-a', '2026-09-01 10:00:00');
  db.prepare(`INSERT INTO sessions (id, cwd, repository, created_at) VALUES (?, ?, ?, ?)`)
    .run('s2', 'C:/repo-b', null, '2026-09-03 10:00:00');
  db.prepare(
    `INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('s1', 'claude-sonnet-5', 3_000_000_000, 100, 20, '2026-09-01 10:00:05');
  db.prepare(
    `INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('s2', 'gpt-5.4', 1_000_000_000, 50, 10, '2026-09-03 11:00:00');
}

describe('getFilterOptions', () => {
  it('returns distinct projects (repository, falling back to cwd), models, and date bounds', () => {
    const db = new Database(':memory:');
    seedSchemaAndFixtures(db);

    const options = getFilterOptions(db);

    expect(options.projects.sort()).toEqual(['C:/repo-b', 'org/repo-a']);
    expect(options.models.sort()).toEqual(['claude-sonnet-5', 'gpt-5.4']);
    expect(options.minDate).toBe('2026-09-01');
    expect(options.maxDate).toBe('2026-09-03');

    db.close();
  });
});
