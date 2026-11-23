import os from 'node:os';
import path from 'node:path';

// Reference-only subset of `src/main/db.ts`: the agent trace store needs only the default path,
// which it refuses to open for writable traces.
export function resolveDefaultDbPath(): string {
  return path.join(os.homedir(), '.copilot', 'session-store.db');
}
