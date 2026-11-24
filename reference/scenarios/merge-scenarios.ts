// Runs the TypeScript merge (`reference/src/merge.ts`) over the synthetic CLI stores under
// `rust/db/tests/fixtures/` and over in-memory CLI schemas, then records the merged tables and the
// export report built on them. The output is the fixture `rust/aggregate/tests/fixtures/scenarios.json`,
// which the Rust port replays step by step. Fixture paths are resolved against the repository root here,
// because the rust-anything recorder runs each case from a temporary folder.
// Usage: node reference/dist/scenarios/scenarios/merge-scenarios.js <output path> <repo root>

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getExportReport, openDatabase } from '../src/db';
import { buildMergedDatabase } from '../src/merge';
import type { UsageFilters } from '../src/shared/types';
import type { VscodeUsageData } from '../src/vscode-chat-store';

const DB_FIXTURES = ['rust', 'db', 'tests', 'fixtures'];
const MERGED_TABLES: Record<string, string[]> = {
  sessions: ['id', 'cwd', 'repository', 'summary', 'created_at'],
  assistant_usage_events: [
    'id',
    'session_id',
    'model',
    'total_nano_aiu',
    'input_tokens',
    'output_tokens',
    'created_at',
  ],
};

type CliSource = { kind: 'file'; file: string } | { kind: 'sql'; setup: string[] };
type Case = { name: string; cli: CliSource; vscode: VscodeUsageData };

const NO_FILTERS: UsageFilters = {};
const EMPTY_VSCODE: VscodeUsageData = { events: [], sessions: [] };
const SAMPLE_VSCODE: VscodeUsageData = {
  sessions: [
    { sessionId: 'a1', project: 'C:/repos/alpha', summary: 'Alpha chat', createdAt: '2026-09-05 09:00:00.000' },
    { sessionId: 'b2', project: null, summary: null, createdAt: '2026-09-06 10:30:00.500' },
    // A repeated session id: the first row wins, as with `INSERT OR IGNORE`.
    { sessionId: 'a1', project: 'C:/repos/other', summary: 'Duplicate id', createdAt: '2026-09-07 08:00:00.000' },
  ],
  events: [
    {
      sessionId: 'a1',
      project: 'C:/repos/alpha',
      model: 'gpt-5.4',
      aiuCredits: 1.2345678915,
      inputTokens: 1200,
      outputTokens: 340,
      createdAt: '2026-09-05 09:01:00.000',
    },
    {
      sessionId: 'b2',
      project: null,
      model: 'claude-sonnet-5',
      aiuCredits: 0.5,
      inputTokens: 0,
      outputTokens: 0,
      createdAt: '2026-09-06 10:31:00.000',
    },
    {
      sessionId: 'a1',
      project: 'C:/repos/alpha',
      model: 'claude-sonnet-5',
      aiuCredits: 2.0000000005,
      inputTokens: 80,
      outputTokens: 12,
      createdAt: '2026-09-07 08:05:00.000',
    },
    // Math.round(-1.5) is -1 in JavaScript (halves round toward +Infinity).
    {
      sessionId: 'b2',
      project: null,
      model: 'gpt-5.4',
      aiuCredits: -0.0000000015,
      inputTokens: 3,
      outputTokens: 1,
      createdAt: '2026-09-06 10:32:00.000',
    },
  ],
};

const STANDARD_CLI_SCHEMA = `
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

const STANDARD_EVENT_ROW = `
  INSERT INTO assistant_usage_events
    (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
  VALUES ('s1', 'gpt-5.4', 1000000000, 100, 50, '2026-09-04 08:05:00');`;

const CASES: Case[] = [
  { name: 'session-store-empty-vscode', cli: { kind: 'file', file: 'session-store.db' }, vscode: EMPTY_VSCODE },
  { name: 'session-store-vscode-sample', cli: { kind: 'file', file: 'session-store.db' }, vscode: SAMPLE_VSCODE },
  {
    name: 'session-store-vscode-events-without-sessions',
    cli: { kind: 'file', file: 'session-store.db' },
    vscode: { events: SAMPLE_VSCODE.events.slice(0, 1), sessions: [] },
  },
  {
    name: 'session-store-vscode-sessions-without-events',
    cli: { kind: 'file', file: 'session-store.db' },
    vscode: { events: [], sessions: SAMPLE_VSCODE.sessions },
  },
  { name: 'null-store-empty-vscode', cli: { kind: 'file', file: 'null-store.db' }, vscode: EMPTY_VSCODE },
  { name: 'null-store-vscode-sample', cli: { kind: 'file', file: 'null-store.db' }, vscode: SAMPLE_VSCODE },
  { name: 'empty-store-empty-vscode', cli: { kind: 'file', file: 'empty.db' }, vscode: EMPTY_VSCODE },
  { name: 'empty-store-vscode-sample', cli: { kind: 'file', file: 'empty.db' }, vscode: SAMPLE_VSCODE },
  {
    name: 'cli-empty-tables-vscode-sample',
    cli: { kind: 'sql', setup: [STANDARD_CLI_SCHEMA] },
    vscode: SAMPLE_VSCODE,
  },
  {
    name: 'cli-missing-optional-columns',
    cli: {
      kind: 'sql',
      setup: [
        `CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, created_at TEXT);
         INSERT INTO sessions VALUES ('m1', 'C:/repos/minimal', '2026-09-08 07:00:00');
         CREATE TABLE assistant_usage_events (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           session_id TEXT NOT NULL,
           model TEXT NOT NULL,
           total_nano_aiu INTEGER,
           input_tokens INTEGER
         );
         INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens)
         VALUES ('m1', 'gpt-5.4', 2500000000, 900);`,
      ],
    },
    vscode: SAMPLE_VSCODE,
  },
  {
    name: 'cli-extra-columns-ignored',
    cli: {
      kind: 'sql',
      setup: [
        `CREATE TABLE sessions (
           id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, host_type TEXT, branch TEXT,
           summary TEXT, created_at TEXT, updated_at TEXT
         );
         INSERT INTO sessions VALUES ('x1', 'C:/repos/extra', 'org/extra', 'github.com', 'main',
           'Extra columns', '2026-09-09 12:00:00', '2026-09-09 13:00:00');
         CREATE TABLE assistant_usage_events (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           session_id TEXT NOT NULL,
           model TEXT NOT NULL,
           total_nano_aiu INTEGER,
           input_tokens INTEGER,
           output_tokens INTEGER,
           created_at TEXT,
           premium_requests INTEGER
         );
         INSERT INTO assistant_usage_events
           (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at, premium_requests)
         VALUES ('x1', 'gpt-5.4', 1000000000, 100, 50, '2026-09-09 12:05:00', 1);`,
      ],
    },
    vscode: EMPTY_VSCODE,
  },
  {
    name: 'cli-storage-classes-preserved',
    cli: {
      kind: 'sql',
      setup: [
        // Untyped columns keep the storage class SQLite wrote, so the merge sees integers, reals and text.
        `CREATE TABLE sessions (id, cwd, repository, summary, created_at);
         INSERT INTO sessions VALUES ('s1', 'C:/repos/typed', 'org/typed', 'Typed', 1789000000);
         CREATE TABLE assistant_usage_events (
           id, session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at
         );
         INSERT INTO assistant_usage_events VALUES
           (1, 's1', 'gpt-5.4', 1500000000.0, '12', 7.5, '2026-09-05 09:00:00'),
           (2, 's1', 'gpt-5.4', '250000000', 4, NULL, NULL);`,
      ],
    },
    vscode: EMPTY_VSCODE,
  },
  {
    name: 'cli-null-model-throws',
    cli: {
      kind: 'sql',
      setup: [
        `CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, summary TEXT, created_at TEXT);
         CREATE TABLE assistant_usage_events (
           id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, model TEXT,
           total_nano_aiu INTEGER, input_tokens INTEGER, output_tokens INTEGER, created_at TEXT
         );
         INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu) VALUES ('s1', NULL, 1);`,
      ],
    },
    vscode: EMPTY_VSCODE,
  },
  {
    name: 'cli-sessions-table-missing-throws',
    cli: { kind: 'sql', setup: [`CREATE TABLE assistant_usage_events (id INTEGER PRIMARY KEY, session_id TEXT, model TEXT);`] },
    vscode: EMPTY_VSCODE,
  },
  {
    name: 'cli-events-table-missing-throws',
    cli: { kind: 'sql', setup: [`CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, summary TEXT, created_at TEXT);`] },
    vscode: EMPTY_VSCODE,
  },
  {
    name: 'cli-duplicate-session-ids-keep-first',
    cli: {
      kind: 'sql',
      setup: [
        `CREATE TABLE sessions (id TEXT, cwd TEXT, repository TEXT, summary TEXT, created_at TEXT);
         INSERT INTO sessions VALUES
           ('d1', 'C:/repos/first', 'org/first', 'first', '2026-09-03 08:00:00'),
           ('d1', 'C:/repos/second', 'org/second', 'second', '2026-09-03 09:00:00');
         CREATE TABLE assistant_usage_events (
           id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, model TEXT NOT NULL,
           total_nano_aiu INTEGER, input_tokens INTEGER, output_tokens INTEGER, created_at TEXT
         );
         INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
         VALUES ('d1', 'gpt-5.4', 3000000000, 10, 2, '2026-09-03 08:30:00');`,
      ],
    },
    vscode: EMPTY_VSCODE,
  },
  {
    name: 'cli-session-id-collides-with-vscode-prefix',
    cli: {
      kind: 'sql',
      setup: [
        `CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, summary TEXT, created_at TEXT);
         INSERT INTO sessions VALUES ('vscode:a1', 'C:/repos/cli', 'org/cli', 'CLI owns this id', '2026-09-04 08:00:00');
         CREATE TABLE assistant_usage_events (
           id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, model TEXT NOT NULL,
           total_nano_aiu INTEGER, input_tokens INTEGER, output_tokens INTEGER, created_at TEXT
         );
         INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
         VALUES ('vscode:a1', 'gpt-5.4', 4000000000, 20, 5, '2026-09-04 08:10:00');`,
      ],
    },
    vscode: SAMPLE_VSCODE,
  },
  {
    name: 'cli-one-row-vscode-empty',
    cli: { kind: 'sql', setup: [STANDARD_CLI_SCHEMA, STANDARD_EVENT_ROW] },
    vscode: EMPTY_VSCODE,
  },
];

type Outcome = { ok: unknown } | { threw: string; message: string };

function attempt(run: () => unknown): Outcome {
  try {
    return { ok: run() };
  } catch (error) {
    const failure = error as Error;
    return { threw: failure.name, message: failure.message };
  }
}

// Each cell is `[value, typeof(value)]`, so the replay checks storage classes as well as values.
function dumpTable(db: Database.Database, table: string, columns: string[]): unknown[] {
  const select = columns.map((column) => `${column}, typeof(${column})`).join(', ');
  const rows = db.prepare(`SELECT ${select} FROM ${table} ORDER BY rowid`).raw(true).all() as unknown[][];
  return rows.map((row) => columns.map((_, i) => [row[2 * i], row[2 * i + 1]]));
}

function dumpSchema(db: Database.Database, table: string): unknown[] {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; type: string; notnull: number; pk: number }>
  ).map((col) => ({ name: col.name, type: col.type, notnull: col.notnull, pk: col.pk }));
}

function openCli(source: CliSource, repoRoot: string): Database.Database {
  if (source.kind === 'file') {
    return openDatabase(path.join(repoRoot, ...DB_FIXTURES, source.file));
  }
  const db = new Database(':memory:');
  db.exec(source.setup.join('\n'));
  return db;
}

function runCase(scenario: Case, repoRoot: string): unknown {
  const outcome = attempt(() => {
    const cli = openCli(scenario.cli, repoRoot);
    try {
      const merged = buildMergedDatabase(cli, scenario.vscode);
      try {
        const tables = Object.entries(MERGED_TABLES);
        return {
          schema: Object.fromEntries(tables.map(([table]) => [table, dumpSchema(merged, table)])),
          tables: Object.fromEntries(tables.map(([table, columns]) => [table, dumpTable(merged, table, columns)])),
          preview: getExportReport(merged, NO_FILTERS).preview,
        };
      } finally {
        merged.close();
      }
    } finally {
      cli.close();
    }
  });
  return { ...scenario, outcome };
}

const [outputPath, repoRoot] = process.argv.slice(2);
if (!outputPath || !repoRoot) {
  console.error('usage: node merge-scenarios.js <output path> <repo root>');
  process.exit(2);
}

writeFileSync(
  outputPath,
  `[\n${CASES.map((scenario) => `  ${JSON.stringify(runCase(scenario, repoRoot))}`).join(',\n')}\n]\n`,
);
