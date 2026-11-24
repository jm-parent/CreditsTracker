// Runs the TypeScript usage queries (`src/main/db.ts`) against the synthetic session stores under
// `rust/db/tests/fixtures/` and records what each call returned. The output is the fixture
// `rust/db/tests/fixtures/scenarios.json`, which the Rust port replays. The rust-anything recorder runs
// each case from a temporary folder, so fixture paths cannot be recorded through it; this script
// resolves them against the repository root.
// Usage: node reference/dist/scenarios/scenarios/db-scenarios.js <output path> <repo root>

import { rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  getExportReport,
  getFilterOptions,
  getHourlyDetail,
  getMonthlyActivity,
  getProjectDetail,
  getRawTablePage,
  getUsage,
  openDatabase,
  resolveDefaultDbPath,
} from '../src/db';
import type {
  HourlyDetailParams,
  MonthlyActivityParams,
  RawTableName,
  UsageFilters,
} from '../src/shared/types';

const FIXTURE_TOKEN = '{fixtures}';
const SESSION_STORE = `${FIXTURE_TOKEN}/session-store.db`;
const EMPTY_STORE = `${FIXTURE_TOKEN}/empty.db`;
const NULL_STORE = `${FIXTURE_TOKEN}/null-store.db`;
const MISSING_STORE = 'missing/session-store.db';

// UTC+1 with no daylight saving. A fixed offset keeps the hour buckets the same on every machine, and
// the offset is not zero, so the recording shows that SQLite's `localtime` was applied. The Rust
// replay pins the same zone (`rust/db/tests/scenarios.rs`).
const FIXED_ZONE = 'CET-1';

type Case =
  | { name: string; call: 'openDatabase'; dbPath: string }
  | { name: string; call: 'getFilterOptions'; dbPath: string }
  | { name: string; call: 'getUsage' | 'getExportReport'; dbPath: string; filters: UsageFilters }
  | { name: string; call: 'getHourlyDetail'; dbPath: string; params: HourlyDetailParams }
  | { name: string; call: 'getMonthlyActivity'; dbPath: string; params: MonthlyActivityParams }
  | { name: string; call: 'getProjectDetail'; dbPath: string; project: string; filters: UsageFilters }
  | {
      name: string;
      call: 'getRawTablePage';
      dbPath: string;
      table: RawTableName;
      page: number;
      pageSize: number;
    }
  | { name: string; call: 'resolveDefaultDbPath' };

type Outcome = { ok: unknown } | { threw: string; message: string };

const NO_FILTERS: UsageFilters = {};
const DATE_RANGE: UsageFilters = { from: '2026-09-01', to: '2026-09-10' };
const EMPTY_RANGE: UsageFilters = { from: '2000-01-01', to: '2000-01-02' };
const CAFE = 'Projet café 🚀';

const CASES: Case[] = [
  { name: 'open-session-store-is-read-only', call: 'openDatabase', dbPath: SESSION_STORE },
  { name: 'open-missing-store-throws', call: 'openDatabase', dbPath: MISSING_STORE },
  { name: 'open-empty-store', call: 'openDatabase', dbPath: EMPTY_STORE },
  { name: 'filter-options-session-store', call: 'getFilterOptions', dbPath: SESSION_STORE },
  { name: 'filter-options-empty-store', call: 'getFilterOptions', dbPath: EMPTY_STORE },
  { name: 'usage-all', call: 'getUsage', dbPath: SESSION_STORE, filters: NO_FILTERS },
  { name: 'usage-date-range', call: 'getUsage', dbPath: SESSION_STORE, filters: DATE_RANGE },
  {
    name: 'usage-non-ascii-project-and-model',
    call: 'getUsage',
    dbPath: SESSION_STORE,
    filters: { project: CAFE, model: 'claude-sonnet-5' },
  },
  {
    name: 'usage-project-search-trimmed-case-insensitive',
    call: 'getUsage',
    dbPath: SESSION_STORE,
    filters: { projectSearch: '  ALPHA ' },
  },
  {
    name: 'usage-empty-filter-strings-are-no-filter',
    call: 'getUsage',
    dbPath: SESSION_STORE,
    filters: { project: '', projectSearch: '   ', model: '', from: '', to: '' },
  },
  { name: 'usage-empty-range', call: 'getUsage', dbPath: SESSION_STORE, filters: EMPTY_RANGE },
  { name: 'usage-empty-store', call: 'getUsage', dbPath: EMPTY_STORE, filters: NO_FILTERS },
  {
    name: 'hourly-busy-day-non-ascii-project',
    call: 'getHourlyDetail',
    dbPath: SESSION_STORE,
    params: { date: '2026-09-10' },
  },
  {
    name: 'hourly-busy-day-filtered-by-model',
    call: 'getHourlyDetail',
    dbPath: SESSION_STORE,
    params: { date: '2026-09-01', model: 'gpt-5.4' },
  },
  {
    name: 'hourly-day-without-usage',
    call: 'getHourlyDetail',
    dbPath: SESSION_STORE,
    params: { date: '2000-01-01' },
  },
  {
    name: 'monthly-september',
    call: 'getMonthlyActivity',
    dbPath: SESSION_STORE,
    params: { year: 2026, month: 9 },
  },
  {
    name: 'monthly-empty-month',
    call: 'getMonthlyActivity',
    dbPath: SESSION_STORE,
    params: { year: 2026, month: 10 },
  },
  {
    name: 'monthly-november-filtered-by-project-search',
    call: 'getMonthlyActivity',
    dbPath: SESSION_STORE,
    params: { year: 2026, month: 11, projectSearch: 'GAMMA' },
  },
  {
    name: 'project-detail-non-ascii',
    call: 'getProjectDetail',
    dbPath: SESSION_STORE,
    project: CAFE,
    filters: NO_FILTERS,
  },
  {
    name: 'project-detail-zero-token-project',
    call: 'getProjectDetail',
    dbPath: SESSION_STORE,
    project: 'org/delta',
    filters: NO_FILTERS,
  },
  {
    name: 'project-detail-orphan-project-without-events',
    call: 'getProjectDetail',
    dbPath: SESSION_STORE,
    project: 'org/epsilon',
    filters: NO_FILTERS,
  },
  {
    name: 'project-detail-unknown-project',
    call: 'getProjectDetail',
    dbPath: SESSION_STORE,
    project: 'no-such-project',
    filters: NO_FILTERS,
  },
  {
    name: 'project-detail-empty-store',
    call: 'getProjectDetail',
    dbPath: EMPTY_STORE,
    project: 'org/alpha',
    filters: NO_FILTERS,
  },
  { name: 'export-all', call: 'getExportReport', dbPath: SESSION_STORE, filters: NO_FILTERS },
  { name: 'export-date-range', call: 'getExportReport', dbPath: SESSION_STORE, filters: DATE_RANGE },
  {
    name: 'export-inverted-range-throws',
    call: 'getExportReport',
    dbPath: SESSION_STORE,
    filters: { from: '2026-12-01', to: '2026-01-01' },
  },
  {
    name: 'export-empty-range-has-no-rows',
    call: 'getExportReport',
    dbPath: SESSION_STORE,
    filters: EMPTY_RANGE,
  },
  {
    name: 'export-zero-token-day-has-zero-shares',
    call: 'getExportReport',
    dbPath: SESSION_STORE,
    filters: { from: '2026-11-20', to: '2026-11-20' },
  },
  { name: 'export-empty-store', call: 'getExportReport', dbPath: EMPTY_STORE, filters: NO_FILTERS },
  {
    name: 'raw-sessions-first-page',
    call: 'getRawTablePage',
    dbPath: SESSION_STORE,
    table: 'sessions',
    page: 0,
    pageSize: 3,
  },
  {
    name: 'raw-events-second-page',
    call: 'getRawTablePage',
    dbPath: SESSION_STORE,
    table: 'assistant_usage_events',
    page: 1,
    pageSize: 3,
  },
  {
    name: 'raw-events-page-past-the-end',
    call: 'getRawTablePage',
    dbPath: SESSION_STORE,
    table: 'assistant_usage_events',
    page: 99,
    pageSize: 3,
  },
  {
    name: 'raw-page-and-size-are-clamped',
    call: 'getRawTablePage',
    dbPath: SESSION_STORE,
    table: 'sessions',
    page: -1.7,
    pageSize: 0,
  },
  {
    name: 'raw-page-size-is-capped-at-500',
    call: 'getRawTablePage',
    dbPath: SESSION_STORE,
    table: 'assistant_usage_events',
    page: 0,
    pageSize: 1000,
  },
  {
    name: 'raw-empty-store-lists-columns',
    call: 'getRawTablePage',
    dbPath: EMPTY_STORE,
    table: 'sessions',
    page: 0,
    pageSize: 10,
  },
  {
    name: 'filter-options-null-store',
    call: 'getFilterOptions',
    dbPath: NULL_STORE,
  },
  {
    name: 'usage-null-store-keeps-null-project-and-date',
    call: 'getUsage',
    dbPath: NULL_STORE,
    filters: NO_FILTERS,
  },
  {
    name: 'usage-null-store-date-range-drops-null-dates',
    call: 'getUsage',
    dbPath: NULL_STORE,
    filters: DATE_RANGE,
  },
  {
    name: 'hourly-null-store-day-with-null-project',
    call: 'getHourlyDetail',
    dbPath: NULL_STORE,
    params: { date: '2026-09-02' },
  },
  {
    name: 'project-detail-null-store-null-tokens-and-created-at',
    call: 'getProjectDetail',
    dbPath: NULL_STORE,
    project: 'C:/repos/nul',
    filters: NO_FILTERS,
  },
  {
    name: 'export-null-store-null-project-date-and-created-at',
    call: 'getExportReport',
    dbPath: NULL_STORE,
    filters: NO_FILTERS,
  },
  { name: 'default-db-path-under-home', call: 'resolveDefaultDbPath' },
];

// Synthetic store with NULLs in every nullable column the usage queries read: a session with no
// project, one with no created_at, one whose events have no tokens, and one whose event has no
// created_at. Written from here so the fixture comes from this file.
const NULL_STORE_SCHEMA = `
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
  );`;

const NULL_STORE_SESSIONS: Array<[string, string | null, string | null, string | null, string | null]> = [
  ['n1', null, null, null, '2026-09-02 10:00:00'],
  ['n2', 'C:/repos/nul', null, 'Null tokens and created_at', null],
  ['n3', 'C:/repos/omega', 'org/omega', 'Mixed nulls', '2026-09-03 12:00:00'],
  ['n4', 'C:/repos/nul', null, null, '2026-09-04 08:00:00'],
];

const NULL_STORE_EVENTS: Array<
  [string, string, number | null, number | null, number | null, string | null]
> = [
  ['n1', 'gpt-5.4', 1_000_000_000, 10, 5, '2026-09-02 10:05:00'],
  ['n2', 'claude-sonnet-5', 2_000_000_000, null, null, '2026-09-04 09:00:00'],
  ['n2', 'gpt-5.4', null, 4, null, '2026-09-04 09:30:00'],
  ['n3', 'gpt-5.4', null, 7, 3, null],
  ['n3', 'gpt-5.4', 500_000_000, null, null, '2026-09-03 12:30:00'],
  ['n4', 'claude-sonnet-5', 3_000_000_000, 20, 1, null],
];

function writeNullStore(filePath: string): void {
  rmSync(filePath, { force: true });
  const db = new Database(filePath);
  try {
    db.exec(NULL_STORE_SCHEMA);
    const insertSession = db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)');
    for (const row of NULL_STORE_SESSIONS) insertSession.run(...row);
    const insertEvent = db.prepare(
      `INSERT INTO assistant_usage_events
         (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const row of NULL_STORE_EVENTS) insertEvent.run(...row);
  } finally {
    db.close();
  }
}

// Fails fast if the zone pin did not reach SQLite, since every hourly bucket depends on it.
function assertZonePinned(): void {
  const db = new Database(':memory:');
  try {
    const { hour } = db
      .prepare(`SELECT strftime('%H', '2026-09-10 08:05:00', 'localtime') AS hour`)
      .get() as { hour: string };
    if (hour !== '09') {
      throw new Error(`SQLite localtime gave ${hour} for 08:05Z, expected 09 under ${FIXED_ZONE}`);
    }
  } finally {
    db.close();
  }
}

function attempt(run: () => unknown): Outcome {
  try {
    return { ok: run() };
  } catch (error) {
    const failure = error as Error;
    return { threw: failure.name, message: failure.message };
  }
}

// Opens the store the way the app does, runs the query, and closes the handle.
function query(dbPath: string, run: (db: ReturnType<typeof openDatabase>) => unknown): Outcome {
  return attempt(() => {
    const db = openDatabase(dbPath);
    try {
      return run(db);
    } finally {
      db.close();
    }
  });
}

function runCase(scenario: Case, fixturesDir: string): unknown {
  if (scenario.call === 'resolveDefaultDbPath') {
    // Only the part below the home folder is recorded, so the fixture does not depend on the user name.
    const outcome = attempt(() => path.relative(os.homedir(), resolveDefaultDbPath()));
    return { ...scenario, outcome };
  }
  const dbPath = scenario.dbPath.replace(FIXTURE_TOKEN, fixturesDir);
  const outcome = query(dbPath, (db) => {
    switch (scenario.call) {
      case 'openDatabase':
        return { readonly: db.readonly };
      case 'getFilterOptions':
        return getFilterOptions(db);
      case 'getUsage':
        return getUsage(db, scenario.filters);
      case 'getExportReport':
        return getExportReport(db, scenario.filters);
      case 'getHourlyDetail':
        return getHourlyDetail(db, scenario.params);
      case 'getMonthlyActivity':
        return getMonthlyActivity(db, scenario.params);
      case 'getProjectDetail':
        return getProjectDetail(db, { ...scenario.filters, project: scenario.project });
      case 'getRawTablePage':
        return getRawTablePage(db, scenario.table, scenario.page, scenario.pageSize);
    }
  });
  return { ...scenario, outcome };
}

const [outputPath, repoRoot] = process.argv.slice(2);
if (!outputPath || !repoRoot) {
  console.error('usage: node db-scenarios.js <output path> <repo root>');
  process.exit(2);
}

const fixturesDir = path.join(repoRoot, 'rust', 'db', 'tests', 'fixtures');
process.env.TZ = FIXED_ZONE;
assertZonePinned();
writeNullStore(path.join(fixturesDir, 'null-store.db'));
writeFileSync(
  outputPath,
  `${JSON.stringify(
    CASES.map((scenario) => runCase(scenario, fixturesDir)),
    null,
    2,
  )}\n`,
);
