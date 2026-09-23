import { describe, it, expect, afterEach } from 'vitest';
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
  getHourlyDetail,
  getMonthlyActivity,
  getProjectDetail,
  getExportReport,
  getRawTablePage,
  buildMergedDatabase,
} from './db';
import type { VscodeUsageData } from './vscode-chat-store';

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
      { date: '2026-09-01', aiuCredits: 3, byProject: { 'org/repo-a': 3 } },
      { date: '2026-09-03', aiuCredits: 1, byProject: { 'C:/repo-b': 1 } },
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

  it('filters by projectSearch (case-insensitive substring against repository or cwd)', () => {
    const db = new Database(':memory:');
    seedSchemaAndFixtures(db);

    const repositoryMatch = getUsage(db, { projectSearch: 'REPO-A' });
    expect(repositoryMatch.totals).toEqual({ aiuCredits: 3, tokens: 120, requests: 1 });
    expect(repositoryMatch.byProject).toEqual([{ key: 'org/repo-a', aiuCredits: 3 }]);

    const cwdFallbackMatch = getUsage(db, { projectSearch: 'REPO-B' });
    expect(cwdFallbackMatch.totals).toEqual({ aiuCredits: 1, tokens: 60, requests: 1 });
    expect(cwdFallbackMatch.byProject).toEqual([{ key: 'C:/repo-b', aiuCredits: 1 }]);

    const literalWildcard = getUsage(db, { projectSearch: 'repo-%' });
    expect(literalWildcard.totals).toEqual({ aiuCredits: 0, tokens: 0, requests: 0 });

    const noMatch = getUsage(db, { projectSearch: 'does-not-exist' });
    expect(noMatch.totals).toEqual({ aiuCredits: 0, tokens: 0, requests: 0 });
    expect(noMatch.timeSeries).toEqual([]);

    db.close();
  });
});

// getHourlyDetail converts stored UTC timestamps to the machine's local hour, so
// tests compute the expected hour dynamically instead of hardcoding a timezone.
function localHourLabel(utcNaiveDateTime: string): string {
  const hours = new Date(`${utcNaiveDateTime.replace(' ', 'T')}Z`).getHours();
  return `${String(hours).padStart(2, '0')}:00`;
}

describe('getHourlyDetail', () => {
  it('returns an hourly breakdown by project for the given date', () => {
    const db = new Database(':memory:');
    seedSchemaAndFixtures(db);
    // seedSchemaAndFixtures has org/repo-a at 2026-09-01 10:00:05 and C:/repo-b at 2026-09-03 11:00:00
    db.prepare(
      `INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('s1', 'claude-sonnet-5', 2_000_000_000, 100, 20, '2026-09-01 14:30:00');

    const result = getHourlyDetail(db, { date: '2026-09-01' });

    expect(result).toEqual([
      { hour: localHourLabel('2026-09-01 10:00:05'), aiuCredits: 3, byProject: { 'org/repo-a': 3 } },
      { hour: localHourLabel('2026-09-01 14:30:00'), aiuCredits: 2, byProject: { 'org/repo-a': 2 } },
    ]);

    db.close();
  });

  it('returns an empty array for a date with no matching events', () => {
    const db = new Database(':memory:');
    seedSchemaAndFixtures(db);

    const result = getHourlyDetail(db, { date: '2099-01-01' });

    expect(result).toEqual([]);

    db.close();
  });

  it('applies additional filters (project, model) on top of the date', () => {
    const db = new Database(':memory:');
    seedSchemaAndFixtures(db);
    db.prepare(
      `INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('s1', 'gpt-5.4', 500_000_000, 10, 5, '2026-09-01 11:00:00');

    const result = getHourlyDetail(db, { date: '2026-09-01', model: 'gpt-5.4' });

    expect(result).toEqual([
      { hour: localHourLabel('2026-09-01 11:00:00'), aiuCredits: 0.5, byProject: { 'org/repo-a': 0.5 } },
    ]);

    db.close();
  });

  it('applies projectSearch on top of the date for hourly detail', () => {
    const db = new Database(':memory:');
    seedSchemaAndFixtures(db);

    const result = getHourlyDetail(db, { date: '2026-09-01', projectSearch: 'repo-a' });

    expect(result).toEqual([
      { hour: localHourLabel('2026-09-01 10:00:05'), aiuCredits: 3, byProject: { 'org/repo-a': 3 } },
    ]);

    db.close();
  });
});

describe('getMonthlyActivity', () => {
  it('returns per-day credit totals for the given month, unfiltered', () => {
    const db = new Database(':memory:');
    seedSchemaAndFixtures(db);
    // seedSchemaAndFixtures has org/repo-a at 2026-09-01 (3 credits)
    // and C:/repo-b at 2026-09-03 (1 credit)

    const result = getMonthlyActivity(db, { year: 2026, month: 9 });

    expect(result).toEqual([
      { date: '2026-09-01', aiuCredits: 3 },
      { date: '2026-09-03', aiuCredits: 1 },
    ]);

    db.close();
  });

  it('sums multiple events on the same day', () => {
    const db = new Database(':memory:');
    seedSchemaAndFixtures(db);
    db.prepare(
      `INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('s1', 'claude-sonnet-5', 2_000_000_000, 100, 20, '2026-09-01 18:00:00');

    const result = getMonthlyActivity(db, { year: 2026, month: 9 });

    expect(result).toContainEqual({ date: '2026-09-01', aiuCredits: 5 });

    db.close();
  });

  it('excludes days outside the requested month', () => {
    const db = new Database(':memory:');
    seedSchemaAndFixtures(db);

    const result = getMonthlyActivity(db, { year: 2026, month: 10 });

    expect(result).toEqual([]);

    db.close();
  });

  it('filters by project and model on top of the month', () => {
    const db = new Database(':memory:');
    seedSchemaAndFixtures(db);

    const byProject = getMonthlyActivity(db, { year: 2026, month: 9, project: 'org/repo-a' });
    expect(byProject).toEqual([{ date: '2026-09-01', aiuCredits: 3 }]);

    const byModel = getMonthlyActivity(db, { year: 2026, month: 9, model: 'gpt-5.4' });
    expect(byModel).toEqual([{ date: '2026-09-03', aiuCredits: 1 }]);

    const byProjectSearch = getMonthlyActivity(db, { year: 2026, month: 9, projectSearch: 'repo-b' });
    expect(byProjectSearch).toEqual([{ date: '2026-09-03', aiuCredits: 1 }]);

    db.close();
  });

  it('returns an empty array when a filter matches nothing in the month', () => {
    const db = new Database(':memory:');
    seedSchemaAndFixtures(db);

    const result = getMonthlyActivity(db, { year: 2026, month: 9, project: 'nonexistent' });

    expect(result).toEqual([]);

    db.close();
  });
});

describe('getProjectDetail', () => {
  let provenanceDb: Database.Database | undefined;

  afterEach(() => {
    provenanceDb?.close();
    provenanceDb = undefined;
  });

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

  it('reports the source of each conversation row from the session id prefix', () => {
    provenanceDb = new Database(':memory:');
    provenanceDb.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, summary TEXT, created_at TEXT
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
      INSERT INTO sessions VALUES
        ('cli-session-1', 'C:/repo', 'org/repo-a', 'CLI', '2026-09-01 10:00:00'),
        ('vscode:vscode-session-1', 'C:/repo', 'org/repo-a', 'VS Code', '2026-09-02 10:00:00');
      INSERT INTO assistant_usage_events
        (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
        VALUES ('cli-session-1', 'gpt-5.4', 1000000000, 5, 5, '2026-09-01 10:00:00'),
               ('vscode:vscode-session-1', 'gpt-5.4', 1000000000, 5, 5, '2026-09-02 10:00:00');
    `);

    const result = getProjectDetail(provenanceDb, { project: 'org/repo-a' });

    expect(result.conversations.map(({ sessionId, source }) => ({ sessionId, source }))).toEqual([
      { sessionId: 'vscode:vscode-session-1', source: 'vscode' },
      { sessionId: 'cli-session-1', source: 'copilot-cli' },
    ]);
  });

  it('returns totals and conversations scoped to the given project, most recent first', () => {
    const db = new Database(':memory:');
    seedWithSummaryAndSecondEvent(db);

    const result = getProjectDetail(db, { project: 'org/repo-a' });

    expect(result.project).toBe('org/repo-a');
    expect(result.totals).toEqual({ aiuCredits: 3.5, tokens: 215, requests: 3 });
    expect(result.conversations).toEqual([
      {
        source: 'copilot-cli',
        sessionId: 's2',
        createdAt: '2026-09-03 10:00:00',
        summary: 'Added tests',
        models: 'gpt-5.4',
        aiuCredits: 0.5,
        tokens: 35,
        requests: 1,
      },
      {
        source: 'copilot-cli',
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

  it('returns a daily time series of credits scoped to the given project', () => {
    const db = new Database(':memory:');
    seedWithSummaryAndSecondEvent(db);

    const result = getProjectDetail(db, { project: 'org/repo-a' });

    expect(result.timeSeries).toEqual([
      { date: '2026-09-01', aiuCredits: 3 },
      { date: '2026-09-03', aiuCredits: 0.5 },
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

  it('allows combining exact project with projectSearch (still returns matching project data)', () => {
    const db = new Database(':memory:');
    seedWithSummaryAndSecondEvent(db);

    const result = getProjectDetail(db, {
      project: 'org/repo-a',
      projectSearch: 'repo-a',
    });
    expect(result.totals).toEqual({ aiuCredits: 3.5, tokens: 215, requests: 3 });

    db.close();
  });
});

describe('getExportReport', () => {
  function seedExportReportFixtures(db: Database.Database): void {
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
    db.prepare(`INSERT INTO sessions VALUES (?, ?, ?, ?, ?)`)
      .run('s1', 'C:/repo-a', 'org/repo-a', 'Mixed model work', '2026-09-01 10:00:00');
    db.prepare(`INSERT INTO sessions VALUES (?, ?, ?, ?, ?)`)
      .run('s2', null, null, null, '2026-09-03 10:00:00');
    db.prepare(`INSERT INTO sessions VALUES (?, ?, ?, ?, ?)`)
      .run('s3', 'org/repo-a', null, 'Filtered fallback work', '2026-09-01 08:30:00');

    const insertEvent = db.prepare(`
      INSERT INTO assistant_usage_events
        (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertEvent.run('s1', 'claude-sonnet-5', 3_000_000_000, 100, 20, '2026-09-01 10:00:05');
    insertEvent.run('s1', 'gpt-5.4', 1_000_000_000, 50, 10, '2026-09-01 10:05:00');
    insertEvent.run('s2', 'gpt-5.4', 2_000_000_000, 40, 5, '2026-09-03 11:00:00');
    insertEvent.run('s3', 'gpt-5.4', 4_000_000_000, 70, 30, '2026-09-03 09:00:00');
  }

  it('groups daily/project/model rows and sessions using the selected filters', () => {
    const db = new Database(':memory:');
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
    db.prepare(`INSERT INTO sessions VALUES (?, ?, ?, ?, ?)`)
      .run('s1', 'C:/repo-a', 'org/repo-a', 'Mixed model work', '2026-09-01 10:00:00');
    db.prepare(`INSERT INTO sessions VALUES (?, ?, ?, ?, ?)`)
      .run('s2', null, null, null, '2026-09-03 10:00:00');
    const insertEvent = db.prepare(`
      INSERT INTO assistant_usage_events
        (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertEvent.run('s1', 'claude-sonnet-5', 3_000_000_000, 100, 20, '2026-09-01 10:00:05');
    insertEvent.run('s1', 'gpt-5.4', 1_000_000_000, 50, 10, '2026-09-01 10:05:00');
    insertEvent.run('s2', 'gpt-5.4', 2_000_000_000, 40, 5, '2026-09-03 11:00:00');

    const report = getExportReport(db, { from: '2026-09-01', to: '2026-09-03' });

    expect(report.preview.totals).toEqual({ aiuCredits: 6, tokens: 225, requests: 3 });
    expect(report.preview.sessionCount).toBe(2);
    expect(report.preview.activeDays).toBe(2);
    expect(report.preview.byModel).toEqual([
      { model: 'claude-sonnet-5', aiuCredits: 3, sharePercent: 50 },
      { model: 'gpt-5.4', aiuCredits: 3, sharePercent: 50 },
    ]);
    expect(report.sessionRows).toContainEqual(expect.objectContaining({
      sessionId: 's2',
      project: 'Unassigned',
      summary: '',
      models: 'gpt-5.4',
      aiuCredits: 2,
      inputTokens: 40,
      outputTokens: 5,
      tokens: 45,
      requests: 1,
    }));
    expect(report.summaryRows).toContainEqual(expect.objectContaining({
      date: '2026-09-01',
      project: 'org/repo-a',
      model: 'claude-sonnet-5',
      aiuCredits: 3,
      dayTotalAiuCredits: 4,
      modelSharePercent: 50,
      projectTotalAiuCredits: 4,
      projectSharePercent: expect.closeTo(66.66666666666667, 10),
    }));

    db.close();
  });

  it('applies project, model, and date filters to preview, summary, and session rows', () => {
    const db = new Database(':memory:');
    seedExportReportFixtures(db);

    const report = getExportReport(db, {
      project: 'org/repo-a',
      model: 'gpt-5.4',
      from: '2026-09-02',
      to: '2026-09-03',
    });

    expect(report.preview).toEqual({
      totals: { aiuCredits: 4, tokens: 100, requests: 1 },
      sessionCount: 1,
      activeDays: 1,
      byModel: [{ model: 'gpt-5.4', aiuCredits: 4, sharePercent: 100 }],
      daily: [{ date: '2026-09-03', aiuCredits: 4, tokens: 100, requests: 1 }],
    });
    expect(report.summaryRows).toEqual([
      {
        date: '2026-09-03',
        project: 'org/repo-a',
        model: 'gpt-5.4',
        aiuCredits: 4,
        inputTokens: 70,
        outputTokens: 30,
        tokens: 100,
        requests: 1,
        dayTotalAiuCredits: 4,
        modelTotalAiuCredits: 4,
        modelSharePercent: 100,
        projectTotalAiuCredits: 4,
        projectSharePercent: 100,
      },
    ]);
    expect(report.sessionRows).toEqual([
      {
        sessionId: 's3',
        createdAt: '2026-09-01 08:30:00',
        date: '2026-09-03',
        project: 'org/repo-a',
        summary: 'Filtered fallback work',
        models: 'gpt-5.4',
        aiuCredits: 4,
        inputTokens: 70,
        outputTokens: 30,
        tokens: 100,
        requests: 1,
      },
    ]);

    db.close();
  });

  it('returns zero totals and empty collections when no events match the filters', () => {
    const db = new Database(':memory:');
    seedExportReportFixtures(db);

    const report = getExportReport(db, {
      project: 'org/repo-a',
      model: 'claude-opus-5',
      from: '2026-09-04',
      to: '2026-09-05',
    });

    expect(report.preview).toEqual({
      totals: { aiuCredits: 0, tokens: 0, requests: 0 },
      sessionCount: 0,
      activeDays: 0,
      byModel: [],
      daily: [],
    });
    expect(report.summaryRows).toEqual([]);
    expect(report.sessionRows).toEqual([]);

    db.close();
  });

  it('throws when the export date range is inverted', () => {
    const db = new Database(':memory:');
    seedExportReportFixtures(db);

    expect(() =>
      getExportReport(db, { from: '2026-09-04', to: '2026-09-03' }),
    ).toThrow('Invalid export date range');

    db.close();
  });
});

describe('getRawTablePage', () => {
  it('returns columns, rows, and pagination info for the sessions table', () => {
    const db = new Database(':memory:');
    seedSchemaAndFixtures(db);

    const result = getRawTablePage(db, 'sessions', 0, 10);

    expect(result.total).toBe(2);
    expect(result.page).toBe(0);
    expect(result.pageSize).toBe(10);
    expect(result.columns).toEqual(['id', 'cwd', 'repository', 'created_at']);
    expect(result.rows).toHaveLength(2);
    db.close();
  });

  it('returns columns, rows, and pagination info for the assistant_usage_events table', () => {
    const db = new Database(':memory:');
    seedSchemaAndFixtures(db);

    const result = getRawTablePage(db, 'assistant_usage_events', 0, 10);

    expect(result.total).toBe(2);
    expect(result.rows).toHaveLength(2);
    expect(result.columns).toContain('total_nano_aiu');
    db.close();
  });

  it('paginates results based on page and pageSize', () => {
    const db = new Database(':memory:');
    seedSchemaAndFixtures(db);

    const firstPage = getRawTablePage(db, 'sessions', 0, 1);
    const secondPage = getRawTablePage(db, 'sessions', 1, 1);

    expect(firstPage.rows).toHaveLength(1);
    expect(secondPage.rows).toHaveLength(1);
    expect(firstPage.rows[0].id).not.toBe(secondPage.rows[0].id);
    db.close();
  });

  it('returns empty rows with correct columns for a table with no data', () => {
    const db = new Database(':memory:');
    seedSchemaAndFixtures(db);

    const result = getRawTablePage(db, 'sessions', 5, 10);

    expect(result.rows).toEqual([]);
    expect(result.total).toBe(2);
  });

  it('throws for an unknown table name', () => {
    const db = new Database(':memory:');
    seedSchemaAndFixtures(db);

    expect(() => getRawTablePage(db, 'drop table sessions; --' as never, 0, 10)).toThrow();
  });
});

describe('buildMergedDatabase', () => {
  it('copies CLI sessions and events into the merged database unchanged', () => {
    const cliDb = new Database(':memory:');
    seedSchemaAndFixtures(cliDb);
    const emptyVscodeData: VscodeUsageData = { events: [], sessions: [] };

    const merged = buildMergedDatabase(cliDb, emptyVscodeData);

    const result = getUsage(merged, {});
    expect(result.totals).toEqual({ aiuCredits: 4, tokens: 180, requests: 2 });
    merged.close();
    cliDb.close();
  });

  it('layers VS Code usage events alongside CLI usage under a namespaced session id', () => {
    const cliDb = new Database(':memory:');
    seedSchemaAndFixtures(cliDb);
    const vscodeData: VscodeUsageData = {
      sessions: [
        {
          sessionId: 'vs-session-1',
          project: 'C:/Devs/MyProject',
          summary: 'Explained a bug',
          createdAt: '2026-09-05 09:00:00',
        },
      ],
      events: [
        {
          sessionId: 'vs-session-1',
          project: 'C:/Devs/MyProject',
          model: 'gpt-6-astra',
          aiuCredits: 2.5,
          inputTokens: 1000,
          outputTokens: 200,
          createdAt: '2026-09-05 09:00:05',
        },
      ],
    };

    const merged = buildMergedDatabase(cliDb, vscodeData);

    const result = getUsage(merged, {});
    expect(result.totals).toEqual({ aiuCredits: 6.5, tokens: 1380, requests: 3 });
    expect(result.byProject).toContainEqual({ key: 'C:/Devs/MyProject', aiuCredits: 2.5 });
    expect(result.byModel).toContainEqual({ key: 'gpt-6-astra', aiuCredits: 2.5 });

    const filterOptions = getFilterOptions(merged);
    expect(filterOptions.projects).toContain('C:/Devs/MyProject');
    expect(filterOptions.models).toContain('gpt-6-astra');

    const projectDetail = getProjectDetail(merged, { project: 'C:/Devs/MyProject' });
    expect(projectDetail.conversations).toEqual([
      {
        source: 'vscode',
        sessionId: 'vscode:vs-session-1',
        createdAt: '2026-09-05 09:00:00',
        summary: 'Explained a bug',
        models: 'gpt-6-astra',
        aiuCredits: 2.5,
        tokens: 1200,
        requests: 1,
      },
    ]);

    merged.close();
    cliDb.close();
  });

  it('still works when the CLI database has no data at all', () => {
    const emptyCliDb = new Database(':memory:');
    emptyCliDb.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, summary TEXT, created_at TEXT);
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
    const vscodeData: VscodeUsageData = {
      sessions: [
        { sessionId: 'vs-1', project: 'proj', summary: null, createdAt: '2026-09-05 09:00:00' },
      ],
      events: [
        {
          sessionId: 'vs-1',
          project: 'proj',
          model: 'gpt-5.4',
          aiuCredits: 1,
          inputTokens: 10,
          outputTokens: 5,
          createdAt: '2026-09-05 09:00:00',
        },
      ],
    };

    const merged = buildMergedDatabase(emptyCliDb, vscodeData);

    const result = getUsage(merged, {});
    expect(result.totals).toEqual({ aiuCredits: 1, tokens: 15, requests: 1 });

    merged.close();
    emptyCliDb.close();
  });
});
