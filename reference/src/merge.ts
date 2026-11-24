import Database from 'better-sqlite3';
import type { VscodeUsageData } from './vscode-chat-store';

const MERGED_SESSION_COLUMNS = ['id', 'cwd', 'repository', 'summary', 'created_at'] as const;
const MERGED_EVENT_COLUMNS = [
  'session_id',
  'model',
  'total_nano_aiu',
  'input_tokens',
  'output_tokens',
  'created_at',
] as const;

/** Returns the subset of `wanted` columns that actually exist on `table` in `db`. */
function intersectColumns(db: Database.Database, table: string, wanted: readonly string[]): string[] {
  const existing = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((col) => col.name),
  );
  return wanted.filter((col) => existing.has(col));
}

/**
 * Builds an in-memory SQLite database that combines Copilot CLI usage (read
 * from `cliDb`) with Copilot Chat usage recorded by the VS Code extension
 * (already normalized into `vscodeData`). Only the columns consumed by the
 * queries in this module are carried over from `cliDb`, so the merged schema
 * stays stable regardless of which extra columns the real CLI database has.
 * All existing query functions (`getUsage`, `getFilterOptions`, etc.) operate
 * on the returned database exactly as they would on the raw CLI database.
 */
export function buildMergedDatabase(cliDb: Database.Database, vscodeData: VscodeUsageData): Database.Database {
  const merged = new Database(':memory:');
  merged.exec(`
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
  const insertSession = merged.prepare(
    `INSERT OR IGNORE INTO sessions (id, cwd, repository, summary, created_at)
     VALUES (@id, @cwd, @repository, @summary, @created_at)`,
  );
  const insertEvent = merged.prepare(
    `INSERT INTO assistant_usage_events (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
     VALUES (@session_id, @model, @total_nano_aiu, @input_tokens, @output_tokens, @created_at)`,
  );

  const sessionColumns = intersectColumns(cliDb, 'sessions', MERGED_SESSION_COLUMNS);
  const cliSessions = cliDb
    .prepare(`SELECT ${sessionColumns.join(', ')} FROM sessions`)
    .all() as Array<Record<string, unknown>>;
  for (const row of cliSessions) {
    insertSession.run({
      id: row.id ?? null,
      cwd: row.cwd ?? null,
      repository: row.repository ?? null,
      summary: row.summary ?? null,
      created_at: row.created_at ?? null,
    });
  }

  const eventColumns = intersectColumns(cliDb, 'assistant_usage_events', MERGED_EVENT_COLUMNS);
  const cliEvents = cliDb
    .prepare(`SELECT ${eventColumns.join(', ')} FROM assistant_usage_events`)
    .all() as Array<Record<string, unknown>>;
  for (const row of cliEvents) {
    insertEvent.run({
      session_id: row.session_id ?? null,
      model: row.model ?? null,
      total_nano_aiu: row.total_nano_aiu ?? null,
      input_tokens: row.input_tokens ?? null,
      output_tokens: row.output_tokens ?? null,
      created_at: row.created_at ?? null,
    });
  }

  for (const session of vscodeData.sessions) {
    insertSession.run({
      id: `vscode:${session.sessionId}`,
      cwd: session.project,
      repository: session.project,
      summary: session.summary,
      created_at: session.createdAt,
    });
  }
  for (const event of vscodeData.events) {
    insertEvent.run({
      session_id: `vscode:${event.sessionId}`,
      model: event.model,
      total_nano_aiu: Math.round(event.aiuCredits * 1e9),
      input_tokens: event.inputTokens,
      output_tokens: event.outputTokens,
      created_at: event.createdAt,
    });
  }

  return merged;
}
