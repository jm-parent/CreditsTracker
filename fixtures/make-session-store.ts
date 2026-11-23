import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

/**
 * Builds a synthetic `session-store.db` matching the schema read by
 * `src/main/db.ts` (`sessions` and `assistant_usage_events`). Every value
 * here is made up for test purposes; this never reads a real
 * `~/.copilot/session-store.db`.
 *
 * The generator is deterministic: calling `generateSessionStore` with the
 * same fixed dataset always produces byte-identical output, because the
 * schema and data are static literals inserted in the same order inside a
 * single transaction, and the destination file is always recreated from
 * scratch (see `removeIfExists`).
 */

export const FIXTURES_OUT_DIR = path.join(__dirname, 'out');
export const DEFAULT_OUT_PATH = path.join(FIXTURES_OUT_DIR, 'session-store.db');

/**
 * A second copy of the exact same deterministic data. Review Focus item 1
 * ("Missing or locked session-store.db") needs a database file a test can
 * hold an exclusive OS-level lock on without affecting every other test that
 * reads `DEFAULT_OUT_PATH` concurrently.
 */
export const LOCKED_FIXTURE_PATH = path.join(FIXTURES_OUT_DIR, 'session-store-locked.db');

interface SessionRow {
  id: string;
  cwd: string | null;
  repository: string | null;
  summary: string | null;
  created_at: string;
}

interface EventRow {
  session_id: string;
  model: string;
  total_nano_aiu: number;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
}

// Fixed, hand-picked dataset. Keep in sync with the expectations asserted in
// fixtures/check.test.ts and reused by later tasks' reference recordings.
const SESSIONS: readonly SessionRow[] = [
  {
    id: 's1',
    cwd: 'C:/repos/alpha',
    repository: 'org/alpha',
    summary: 'Alpha session one',
    created_at: '2026-09-01 09:00:00',
  },
  {
    id: 's2',
    cwd: 'C:/repos/alpha',
    repository: 'org/alpha',
    summary: 'Alpha session two',
    created_at: '2026-09-02 10:15:00',
  },
  {
    id: 's3',
    cwd: 'C:/repos/beta',
    repository: null,
    summary: 'Beta session, cwd fallback (no repository)',
    created_at: '2026-09-05 14:30:00',
  },
  {
    id: 's4',
    cwd: '/home/dev/projet-cafe',
    repository: 'Projet café 🚀',
    summary: 'Session with a non-ASCII project name',
    created_at: '2026-09-10 08:00:00',
  },
  {
    id: 's5',
    cwd: 'C:/repos/gamma',
    repository: 'org/gamma',
    summary: null,
    created_at: '2026-11-15 12:00:00',
  },
  {
    id: 's6',
    cwd: 'C:/repos/delta',
    repository: 'org/delta',
    summary: 'Zero-token edge case',
    created_at: '2026-11-20 09:00:00',
  },
  {
    id: 's7',
    cwd: 'C:/repos/epsilon',
    repository: 'org/epsilon',
    summary: 'Orphan session with no usage events',
    created_at: '2026-09-15 00:00:00',
  },
];

const EVENTS: readonly EventRow[] = [
  {
    session_id: 's1',
    model: 'claude-sonnet-5',
    total_nano_aiu: 3_000_000_000,
    input_tokens: 120,
    output_tokens: 30,
    created_at: '2026-09-01 09:05:00',
  },
  {
    session_id: 's1',
    model: 'gpt-5.4',
    total_nano_aiu: 1_500_000_000,
    input_tokens: 80,
    output_tokens: 15,
    created_at: '2026-09-01 11:00:00',
  },
  {
    session_id: 's2',
    model: 'claude-sonnet-5',
    total_nano_aiu: 2_200_000_000,
    input_tokens: 95,
    output_tokens: 22,
    created_at: '2026-09-02 10:20:00',
  },
  {
    session_id: 's3',
    model: 'gpt-5.4',
    total_nano_aiu: 900_000_000,
    input_tokens: 40,
    output_tokens: 8,
    created_at: '2026-09-05 14:35:00',
  },
  {
    session_id: 's4',
    model: 'claude-sonnet-5',
    total_nano_aiu: 4_100_000_000,
    input_tokens: 200,
    output_tokens: 50,
    created_at: '2026-09-10 08:05:00',
  },
  {
    session_id: 's4',
    model: 'gemini-4-neon',
    total_nano_aiu: 1_000_000_000,
    input_tokens: 60,
    output_tokens: 12,
    created_at: '2026-09-10 09:00:00',
  },
  // 2026-10 is intentionally left without any events: the "empty month" case.
  {
    session_id: 's5',
    model: 'claude-sonnet-5',
    total_nano_aiu: 2_800_000_000,
    input_tokens: 110,
    output_tokens: 27,
    created_at: '2026-11-15 12:05:00',
  },
  {
    session_id: 's6',
    model: 'gpt-5.4',
    total_nano_aiu: 0,
    input_tokens: 0,
    output_tokens: 0,
    created_at: '2026-11-20 09:05:00',
  },
];

export const EXPECTED_SESSION_COUNT = SESSIONS.length;
export const EXPECTED_EVENT_COUNT = EVENTS.length;

function removeIfExists(filePath: string): void {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const candidate = `${filePath}${suffix}`;
    if (fs.existsSync(candidate)) fs.rmSync(candidate);
  }
}

/**
 * Builds a fresh, deterministic synthetic session-store.db at `outPath`.
 * Calling this repeatedly (even at different paths) produces byte-identical
 * files, since the destination is always recreated from scratch and the
 * fixed dataset is inserted in the same order inside a single transaction.
 */
export function generateSessionStore(outPath: string): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  removeIfExists(outPath);

  const db = new Database(outPath);
  try {
    db.pragma('journal_mode = DELETE');
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

    const insertSession = db.prepare(
      `INSERT INTO sessions (id, cwd, repository, summary, created_at)
       VALUES (@id, @cwd, @repository, @summary, @created_at)`,
    );
    const insertEvent = db.prepare(
      `INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
       VALUES (@session_id, @model, @total_nano_aiu, @input_tokens, @output_tokens, @created_at)`,
    );

    db.transaction(() => {
      for (const session of SESSIONS) insertSession.run(session);
      for (const event of EVENTS) insertEvent.run(event);
    })();
  } finally {
    db.close();
  }
}

/** Regenerates every session-store fixture this package produces. */
export function generateAllFixtures(): void {
  generateSessionStore(DEFAULT_OUT_PATH);
  generateSessionStore(LOCKED_FIXTURE_PATH);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  generateAllFixtures();
  // eslint-disable-next-line no-console
  console.log(`Wrote ${DEFAULT_OUT_PATH}`);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${LOCKED_FIXTURE_PATH}`);
}
