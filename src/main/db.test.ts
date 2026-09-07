import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import {
  openDatabase,
  resolveDefaultDbPath,
  DatabaseNotFoundError,
  getFilterOptions,
  getUsage,
  getProjectDetail,
} from './db';

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

  it('deduplicates projects and models, excludes sessions with no usage events', () => {
    const db = new Database(':memory:');
    // Create schema (do not use seedSchemaAndFixtures to avoid affecting Task 5)
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

    // Insert two sessions with the same project (both map to 'shared-repo')
    db.prepare(`INSERT INTO sessions (id, cwd, repository, created_at) VALUES (?, ?, ?, ?)`)
      .run('s1', 'C:/dev', 'shared-repo', '2026-09-01 10:00:00');
    db.prepare(`INSERT INTO sessions (id, cwd, repository, created_at) VALUES (?, ?, ?, ?)`)
      .run('s2', 'C:/dev', 'shared-repo', '2026-09-02 10:00:00');

    // Insert a third session with no usage events (should be excluded)
    db.prepare(`INSERT INTO sessions (id, cwd, repository, created_at) VALUES (?, ?, ?, ?)`)
      .run('s3', 'C:/other', 'isolated-repo', '2026-09-03 10:00:00');

    // Insert usage events for s1 and s2 using the same model (claude-opus)
    db.prepare(
      `INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('s1', 'claude-opus', 1_000_000_000, 50, 10, '2026-09-01 10:00:05');
    db.prepare(
      `INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('s2', 'claude-opus', 2_000_000_000, 100, 20, '2026-09-02 10:00:05');

    const options = getFilterOptions(db);

    // Should have exactly one 'shared-repo' (deduplicated), not two
    expect(options.projects).toEqual(['shared-repo']);
    // Should have exactly one 'claude-opus' (deduplicated), not two
    expect(options.models).toEqual(['claude-opus']);
    // Should not include 'isolated-repo' (s3 has no usage events)
    expect(options.projects).not.toContain('isolated-repo');

    db.close();
  });
});

describe('getUsage', () => {
  it('returns totals, a daily time series, and breakdowns by project and model, unfiltered', () => {
    const db = new Database(':memory:');
    seedSchemaAndFixtures(db);

    const result = getUsage(db, {});

    expect(result.totals).toEqual({ aiuCredits: 4, tokens: 180, requests: 2 });
    expect(result.timeSeries).toEqual([
      { date: '2026-09-01', aiuCredits: 3 },
      { date: '2026-09-03', aiuCredits: 1 },
    ]);
    expect(result.byProject.sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: 'C:/repo-b', aiuCredits: 1 },
      { key: 'org/repo-a', aiuCredits: 3 },
    ]);
    expect(result.byModel.sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: 'claude-sonnet-5', aiuCredits: 3 },
      { key: 'gpt-5.4', aiuCredits: 1 },
    ]);

    db.close();
  });

  it('filters by project, model, and inclusive date range', () => {
    const db = new Database(':memory:');
    seedSchemaAndFixtures(db);

    const byProject = getUsage(db, { project: 'org/repo-a' });
    expect(byProject.totals).toEqual({ aiuCredits: 3, tokens: 120, requests: 1 });

    const byModel = getUsage(db, { model: 'gpt-5.4' });
    expect(byModel.totals).toEqual({ aiuCredits: 1, tokens: 60, requests: 1 });

    const byDate = getUsage(db, { from: '2026-09-02', to: '2026-09-03' });
    expect(byDate.totals).toEqual({ aiuCredits: 1, tokens: 60, requests: 1 });

    const noMatch = getUsage(db, { project: 'nonexistent' });
    expect(noMatch.totals).toEqual({ aiuCredits: 0, tokens: 0, requests: 0 });
    expect(noMatch.timeSeries).toEqual([]);

    db.close();
  });
});

describe('getProjectDetail', () => {
  function seedWithSummaryAndSecondEvent(db: Database.Database): void {
    db.exec(`
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
    db.prepare(
      `INSERT INTO sessions (id, cwd, repository, summary, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('s1', 'C:/repo-a', 'org/repo-a', 'Fixed the login bug', '2026-09-01 10:00:00');
    db.prepare(
      `INSERT INTO sessions (id, cwd, repository, summary, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('s2', 'C:/repo-a', 'org/repo-a', 'Added tests', '2026-09-03 10:00:00');
    db.prepare(
      `INSERT INTO sessions (id, cwd, repository, summary, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('s3', 'C:/repo-b', null, 'Unrelated project work', '2026-09-02 10:00:00');
    db.prepare(
      `INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('s1', 'claude-sonnet-5', 2_000_000_000, 100, 20, '2026-09-01 10:00:05');
    db.prepare(
      `INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('s1', 'claude-sonnet-5', 1_000_000_000, 50, 10, '2026-09-01 10:05:00');
    db.prepare(
      `INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('s2', 'gpt-5.4', 500_000_000, 30, 5, '2026-09-03 10:00:05');
    db.prepare(
      `INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('s3', 'gpt-5.4', 9_000_000_000, 900, 90, '2026-09-02 10:00:05');
  }

  it('returns totals and conversations scoped to the given project, most recent first', () => {
    const db = new Database(':memory:');
    seedWithSummaryAndSecondEvent(db);

    const result = getProjectDetail(db, { project: 'org/repo-a' });

    expect(result.project).toBe('org/repo-a');
    expect(result.totals).toEqual({ aiuCredits: 3.5, tokens: 215, requests: 3 });
    expect(result.conversations).toEqual([
      {
        sessionId: 's2',
        createdAt: '2026-09-03 10:00:00',
        summary: 'Added tests',
        models: 'gpt-5.4',
        aiuCredits: 0.5,
        tokens: 35,
        requests: 1,
      },
      {
        sessionId: 's1',
        createdAt: '2026-09-01 10:00:00',
        summary: 'Fixed the login bug',
        models: 'claude-sonnet-5',
        aiuCredits: 3,
        tokens: 180,
        requests: 2,
      },
    ]);
    db.close();
  });

  it('excludes conversations from other projects', () => {
    const db = new Database(':memory:');
    seedWithSummaryAndSecondEvent(db);

    const result = getProjectDetail(db, { project: 'org/repo-a' });

    expect(result.conversations.some((c) => c.sessionId === 's3')).toBe(false);
    db.close();
  });

  it('applies additional filters (model) on top of the project filter', () => {
    const db = new Database(':memory:');
    seedWithSummaryAndSecondEvent(db);

    const result = getProjectDetail(db, { project: 'org/repo-a', model: 'gpt-5.4' });

    expect(result.conversations.map((c) => c.sessionId)).toEqual(['s2']);
    expect(result.totals).toEqual({ aiuCredits: 0.5, tokens: 35, requests: 1 });
    db.close();
  });

  it('returns an empty conversations list and zeroed totals for a project with no matching data', () => {
    const db = new Database(':memory:');
    seedWithSummaryAndSecondEvent(db);

    const result = getProjectDetail(db, { project: 'org/does-not-exist' });

    expect(result.conversations).toEqual([]);
    expect(result.totals).toEqual({ aiuCredits: 0, tokens: 0, requests: 0 });
    db.close();
  });
});
