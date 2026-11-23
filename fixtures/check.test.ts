import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { EXPECTED_EVENT_COUNT, EXPECTED_SESSION_COUNT, generateSessionStore } from './make-session-store';

const OUT_DIR = path.join(__dirname, 'out');

function countRows(dbPath: string, table: 'sessions' | 'assistant_usage_events'): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  } finally {
    db.close();
  }
}

function readProjects(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (
      db.prepare(`SELECT DISTINCT COALESCE(repository, cwd) AS project FROM sessions`).all() as Array<{
        project: string;
      }>
    ).map((row) => row.project);
  } finally {
    db.close();
  }
}

describe('fixtures/make-session-store', () => {
  it('is deterministic: generating twice yields byte-identical databases with the fixed row counts', () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const pathA = path.join(OUT_DIR, 'check-determinism-a.db');
    const pathB = path.join(OUT_DIR, 'check-determinism-b.db');

    generateSessionStore(pathA);
    generateSessionStore(pathB);

    expect(fs.readFileSync(pathA).equals(fs.readFileSync(pathB))).toBe(true);
    expect(countRows(pathA, 'sessions')).toBe(EXPECTED_SESSION_COUNT);
    expect(countRows(pathA, 'assistant_usage_events')).toBe(EXPECTED_EVENT_COUNT);

    fs.rmSync(pathA);
    fs.rmSync(pathB);
  });

  it('includes a non-ASCII project name (e.g. "Projet café 🚀")', () => {
    const outPath = path.join(OUT_DIR, 'check-non-ascii.db');
    generateSessionStore(outPath);

    const projects = readProjects(outPath);
    expect(projects).toContain('Projet café 🚀');

    fs.rmSync(outPath);
  });
});
