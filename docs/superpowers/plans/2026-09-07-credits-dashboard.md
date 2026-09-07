# Copilot CLI Credits Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained Electron + React desktop app that reads the local Copilot CLI `session-store.db` SQLite file and displays a filterable dashboard of AI-credit (AIU) and token consumption, packaged as a distributable `.zip`.

**Architecture:** Electron main process opens `session-store.db` read-only with `better-sqlite3` and exposes two operations (`getFilterOptions`, `getUsage`) over `ipcMain.handle`; a `contextBridge` preload exposes these as `window.api`; the React (Vite) renderer renders filters, summary cards, and charts driven by a polling hook. Packaged with `electron-forge` (Vite plugin) using the ZIP maker.

**Tech Stack:** TypeScript, Electron, electron-forge (+ `@electron-forge/plugin-vite`), Vite, React 18, `better-sqlite3`, `recharts`, Vitest, `@testing-library/react`.

## Global Constraints

- Single machine, single user — no network calls, no auth, no multi-machine aggregation (per spec Scope).
- DB path is always `path.join(os.homedir(), '.copilot', 'session-store.db')`, read-only access only — never write to this file (per spec Architecture).
- Primary metric is AIU credits (`total_nano_aiu / 1e9`); tokens are secondary. No dollar conversion (per spec Purpose/Context).
- No dollar cost estimates, no org-wide views, no auto-update mechanism, no e2e Electron tests in this version (per spec Scope, YAGNI).
- Packaging output must be a `.zip` producible via `electron-forge`'s ZIP maker (per spec Architecture).

---

### Task 1: Project scaffolding (Electron + Vite + React + TypeScript + Vitest)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `forge.config.ts`
- Create: `vite.main.config.ts`
- Create: `vite.preload.config.ts`
- Create: `vite.renderer.config.ts`
- Create: `vitest.config.ts`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `src/preload.ts`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Create: `.gitignore`

**Interfaces:**
- Produces: an `npm start` command that opens an Electron window rendering a React "Credits Dashboard" placeholder heading; an `npm test` command running Vitest; an `npm run make` command (wired in Task 15) for packaging.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "credits-tracker",
  "version": "1.0.0",
  "private": true,
  "description": "Local dashboard for GitHub Copilot CLI credit consumption",
  "main": ".vite/build/main.js",
  "scripts": {
    "start": "electron-forge start",
    "package": "electron-forge package",
    "make": "electron-forge make",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install --save react react-dom recharts better-sqlite3
npm install --save-dev electron @electron-forge/cli @electron-forge/maker-zip @electron-forge/plugin-vite typescript vite @vitejs/plugin-react vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/react @types/react-dom @types/better-sqlite3 @types/node
```
Expected: installs succeed, `node_modules/` and `package-lock.json` are created.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `vite.main.config.ts`**

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: '.vite/build',
    lib: {
      entry: 'src/main.ts',
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: ['electron', 'better-sqlite3'],
    },
  },
});
```

- [ ] **Step 5: Create `vite.preload.config.ts`**

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: '.vite/build/preload',
    lib: {
      entry: 'src/preload.ts',
      formats: ['cjs'],
      fileName: () => 'preload.js',
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
});
```

Note: this outputs to `.vite/build/preload/preload.js`, a subdirectory of the
main process's `.vite/build/main.js` — `src/main.ts` (Step 12) resolves the
preload path relative to its own `__dirname` (`.vite/build`), so it must
reference `preload/preload.js`, not `../preload/preload.js`.

- [ ] **Step 6: Create `vite.renderer.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

- [ ] **Step 7: Create `forge.config.ts`**

```ts
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
  },
  rebuildConfig: {},
  makers: [new MakerZIP({}, ['win32', 'darwin', 'linux'])],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main.ts', config: 'vite.main.config.ts' },
        { entry: 'src/preload.ts', config: 'vite.preload.config.ts' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
  ],
};

export default config;
```

- [ ] **Step 8: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Credits Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 9: Create `src/renderer/App.tsx`**

```tsx
export function App() {
  return <h1>Credits Dashboard</h1>;
}
```

- [ ] **Step 10: Create `src/renderer/main.tsx`**

```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}
createRoot(container).render(<App />);
```

- [ ] **Step 11: Create `src/preload.ts`** (placeholder, filled in Task 6)

```ts
// contextBridge API exposed here in Task 6
export {};
```

- [ ] **Step 12: Create `src/main.ts`**

```ts
import { app, BrowserWindow } from 'electron';
import path from 'node:path';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload/preload.js'),
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

- [ ] **Step 13: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
});
```

- [ ] **Step 14: Create `vitest.setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  // recharts' ResponsiveContainer needs ResizeObserver, which jsdom doesn't implement.
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
```

- [ ] **Step 15: Create `.gitignore`**

```
node_modules/
.vite/
out/
*.log
```

- [ ] **Step 16: Verify the scaffold runs**

Run: `npm start`
Expected: an Electron window opens showing "Credits Dashboard" as a heading. Close the window to end the process.

- [ ] **Step 17: Verify the test runner works**

Run: `npm test`
Expected: Vitest runs and reports "No test files found" (no tests exist yet) without erroring.

- [ ] **Step 18: Commit**

```bash
git add -A
git commit -m "chore: scaffold Electron + Vite + React + TypeScript project"
```

---

### Task 2: Shared types module

**Files:**
- Create: `src/shared/types.ts`
- Test: `src/shared/types.test.ts`

**Interfaces:**
- Produces: `UsageFilters`, `UsageTotals`, `TimeSeriesPoint`, `BreakdownPoint`, `UsageResult`, `FilterOptions` TypeScript interfaces, used by every later task (db, ipc, hook, components).

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/types.test.ts
import { describe, it, expect } from 'vitest';
import type { UsageFilters, UsageResult, FilterOptions } from './types';

describe('shared types', () => {
  it('allows constructing a fully-populated UsageResult', () => {
    const result: UsageResult = {
      totals: { aiuCredits: 1.5, tokens: 100, requests: 2 },
      timeSeries: [{ date: '2026-09-01', aiuCredits: 1.5 }],
      byProject: [{ key: 'my-repo', aiuCredits: 1.5 }],
      byModel: [{ key: 'claude-sonnet-5', aiuCredits: 1.5 }],
    };
    expect(result.totals.aiuCredits).toBe(1.5);
  });

  it('allows an empty UsageFilters and a populated one', () => {
    const empty: UsageFilters = {};
    const full: UsageFilters = { project: 'my-repo', model: 'claude-sonnet-5', from: '2026-09-01', to: '2026-09-07' };
    expect(empty).toEqual({});
    expect(full.project).toBe('my-repo');
  });

  it('allows constructing FilterOptions', () => {
    const options: FilterOptions = {
      projects: ['my-repo'],
      models: ['claude-sonnet-5'],
      minDate: '2026-09-01',
      maxDate: '2026-09-07',
    };
    expect(options.projects).toContain('my-repo');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/types.test.ts`
Expected: FAIL — `Cannot find module './types'` (file doesn't exist yet).

- [ ] **Step 3: Create `src/shared/types.ts`**

```ts
export interface UsageFilters {
  project?: string;
  model?: string;
  /** Inclusive ISO date string 'YYYY-MM-DD' */
  from?: string;
  /** Inclusive ISO date string 'YYYY-MM-DD' */
  to?: string;
}

export interface UsageTotals {
  aiuCredits: number;
  tokens: number;
  requests: number;
}

export interface TimeSeriesPoint {
  date: string;
  aiuCredits: number;
}

export interface BreakdownPoint {
  key: string;
  aiuCredits: number;
}

export interface UsageResult {
  totals: UsageTotals;
  timeSeries: TimeSeriesPoint[];
  byProject: BreakdownPoint[];
  byModel: BreakdownPoint[];
}

export interface FilterOptions {
  projects: string[];
  models: string[];
  minDate: string | null;
  maxDate: string | null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/shared/types.test.ts
git commit -m "feat: add shared usage/filter type definitions"
```

---

### Task 3: DB module — connection + DB-not-found handling

**Files:**
- Create: `src/main/db.ts`
- Test: `src/main/db.test.ts`

**Interfaces:**
- Consumes: nothing (first main-process module).
- Produces: `resolveDefaultDbPath(): string`, `openDatabase(dbPath: string): Database.Database`, `class DatabaseNotFoundError extends Error`. Used by `ipc-handlers.ts` (Task 6) and `main.ts` wiring (Task 6).

- [ ] **Step 1: Write the failing test**

```ts
// src/main/db.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/db.test.ts`
Expected: FAIL — `Cannot find module './db'`.

- [ ] **Step 3: Create `src/main/db.ts`**

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

export class DatabaseNotFoundError extends Error {
  constructor(public readonly dbPath: string) {
    super(`Copilot CLI session database not found at ${dbPath}`);
    this.name = 'DatabaseNotFoundError';
  }
}

export function resolveDefaultDbPath(): string {
  return path.join(os.homedir(), '.copilot', 'session-store.db');
}

export function openDatabase(dbPath: string): Database.Database {
  if (!fs.existsSync(dbPath)) {
    throw new DatabaseNotFoundError(dbPath);
  }
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/db.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/db.ts src/main/db.test.ts
git commit -m "feat: add read-only sqlite connection with db-not-found handling"
```

---

### Task 4: DB module — `getFilterOptions`

**Files:**
- Modify: `src/main/db.ts`
- Modify: `src/main/db.test.ts`

**Interfaces:**
- Consumes: `Database.Database` from Task 3; `FilterOptions` type from Task 2.
- Produces: `getFilterOptions(db: Database.Database): FilterOptions`, used by `ipc-handlers.ts` (Task 6).

- [ ] **Step 1: Write the failing test**

Append to `src/main/db.test.ts`:

```ts
import { getFilterOptions } from './db';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/db.test.ts`
Expected: FAIL — `getFilterOptions is not a function` / import error.

- [ ] **Step 3: Add `getFilterOptions` to `src/main/db.ts`**

```ts
import type { FilterOptions } from '../shared/types';

export function getFilterOptions(db: Database.Database): FilterOptions {
  const projects = db
    .prepare(
      `SELECT DISTINCT COALESCE(s.repository, s.cwd) AS project
       FROM sessions s
       JOIN assistant_usage_events e ON e.session_id = s.id
       WHERE COALESCE(s.repository, s.cwd) IS NOT NULL
       ORDER BY project`,
    )
    .all()
    .map((row) => (row as { project: string }).project);

  const models = db
    .prepare(`SELECT DISTINCT model FROM assistant_usage_events ORDER BY model`)
    .all()
    .map((row) => (row as { model: string }).model);

  const bounds = db
    .prepare(
      `SELECT MIN(date(created_at)) AS minDate, MAX(date(created_at)) AS maxDate
       FROM assistant_usage_events`,
    )
    .get() as { minDate: string | null; maxDate: string | null };

  return {
    projects,
    models,
    minDate: bounds.minDate,
    maxDate: bounds.maxDate,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/db.test.ts`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Commit**

```bash
git add src/main/db.ts src/main/db.test.ts
git commit -m "feat: add getFilterOptions query for project/model/date-range filters"
```

---

### Task 5: DB module — `getUsage` aggregation

**Files:**
- Modify: `src/main/db.ts`
- Modify: `src/main/db.test.ts`

**Interfaces:**
- Consumes: `Database.Database` (Task 3), `UsageFilters`/`UsageResult` types (Task 2).
- Produces: `getUsage(db: Database.Database, filters: UsageFilters): UsageResult`, used by `ipc-handlers.ts` (Task 6).

- [ ] **Step 1: Write the failing test**

Append to `src/main/db.test.ts`:

```ts
import { getUsage } from './db';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/db.test.ts`
Expected: FAIL — `getUsage is not a function` / import error.

- [ ] **Step 3: Add `getUsage` to `src/main/db.ts`**

```ts
import type { UsageFilters, UsageResult } from '../shared/types';

interface WhereClause {
  sql: string;
  params: Record<string, string>;
}

function buildWhereClause(filters: UsageFilters): WhereClause {
  const conditions: string[] = [];
  const params: Record<string, string> = {};

  if (filters.project) {
    conditions.push('COALESCE(s.repository, s.cwd) = @project');
    params.project = filters.project;
  }
  if (filters.model) {
    conditions.push('e.model = @model');
    params.model = filters.model;
  }
  if (filters.from) {
    conditions.push('date(e.created_at) >= @from');
    params.from = filters.from;
  }
  if (filters.to) {
    conditions.push('date(e.created_at) <= @to');
    params.to = filters.to;
  }

  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export function getUsage(db: Database.Database, filters: UsageFilters): UsageResult {
  const { sql: whereSql, params } = buildWhereClause(filters);
  const baseFrom = `FROM assistant_usage_events e JOIN sessions s ON s.id = e.session_id ${whereSql}`;

  const totalsRow = db
    .prepare(
      `SELECT
         COALESCE(SUM(e.total_nano_aiu), 0) / 1e9 AS aiuCredits,
         COALESCE(SUM(e.input_tokens + e.output_tokens), 0) AS tokens,
         COUNT(*) AS requests
       ${baseFrom}`,
    )
    .get(params) as { aiuCredits: number; tokens: number; requests: number };

  const timeSeries = db
    .prepare(
      `SELECT date(e.created_at) AS date, SUM(e.total_nano_aiu) / 1e9 AS aiuCredits
       ${baseFrom}
       GROUP BY date(e.created_at)
       ORDER BY date(e.created_at)`,
    )
    .all(params) as Array<{ date: string; aiuCredits: number }>;

  const byProject = db
    .prepare(
      `SELECT COALESCE(s.repository, s.cwd) AS key, SUM(e.total_nano_aiu) / 1e9 AS aiuCredits
       ${baseFrom}
       GROUP BY key
       ORDER BY key`,
    )
    .all(params) as Array<{ key: string; aiuCredits: number }>;

  const byModel = db
    .prepare(
      `SELECT e.model AS key, SUM(e.total_nano_aiu) / 1e9 AS aiuCredits
       ${baseFrom}
       GROUP BY e.model
       ORDER BY e.model`,
    )
    .all(params) as Array<{ key: string; aiuCredits: number }>;

  return {
    totals: totalsRow,
    timeSeries,
    byProject,
    byModel,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/db.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/main/db.ts src/main/db.test.ts
git commit -m "feat: add getUsage aggregation query with project/model/date filters"
```

---

### Task 6: IPC handlers + preload + main wiring

**Files:**
- Create: `src/main/ipc-handlers.ts`
- Test: `src/main/ipc-handlers.test.ts`
- Modify: `src/preload.ts`
- Modify: `src/main.ts`
- Create: `src/renderer/window.d.ts`

**Interfaces:**
- Consumes: `openDatabase`, `getFilterOptions`, `getUsage`, `DatabaseNotFoundError` (Task 3-5); `UsageFilters`, `UsageResult`, `FilterOptions` (Task 2).
- Produces: `registerIpcHandlers(dbPath: string): void` (called from `src/main.ts`); renderer-side `window.api.getFilterOptions(): Promise<FilterOptions>` and `window.api.getUsage(filters: UsageFilters): Promise<UsageResult>`, used by `useUsageData` (Task 7).

- [ ] **Step 1: Write the failing test**

```ts
// src/main/ipc-handlers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import Database from 'better-sqlite3';
import { registerIpcHandlers } from './ipc-handlers';

vi.mock('electron', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    ipcMain: {
      handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
        handlers.set(channel, listener);
      }),
      __handlers: handlers,
    },
  };
});

vi.mock('./db', async () => {
  const actual = await vi.importActual<typeof import('./db')>('./db');
  return {
    ...actual,
    openDatabase: vi.fn(() => {
      // Empty in-memory DB still needs the schema, since the real
      // (unmocked) getFilterOptions/getUsage query these tables.
      const db = new Database(':memory:');
      db.exec(`
        CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, repository TEXT);
        CREATE TABLE assistant_usage_events (
          session_id TEXT, model TEXT, total_nano_aiu INTEGER,
          input_tokens INTEGER, output_tokens INTEGER, created_at TEXT
        );
      `);
      return db;
    }),
  };
});

describe('registerIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (ipcMain as unknown as { __handlers: Map<string, unknown> }).__handlers.clear();
  });

  it('registers a get-filter-options and a get-usage handler', () => {
    registerIpcHandlers('/fake/path.db');

    expect(ipcMain.handle).toHaveBeenCalledWith('get-filter-options', expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith('get-usage', expect.any(Function));
  });

  it('get-usage handler forwards filters and returns a UsageResult shape', async () => {
    registerIpcHandlers('/fake/path.db');
    const handlers = (ipcMain as unknown as { __handlers: Map<string, (...args: unknown[]) => unknown> }).__handlers;
    const getUsageHandler = handlers.get('get-usage')!;

    const result = await getUsageHandler({}, { project: 'org/repo-a' });

    expect(result).toEqual({
      totals: { aiuCredits: 0, tokens: 0, requests: 0 },
      timeSeries: [],
      byProject: [],
      byModel: [],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ipc-handlers.test.ts`
Expected: FAIL — `Cannot find module './ipc-handlers'`.

- [ ] **Step 3: Create `src/main/ipc-handlers.ts`**

```ts
import { ipcMain } from 'electron';
import { openDatabase, getFilterOptions, getUsage } from './db';
import type { UsageFilters } from '../shared/types';

export function registerIpcHandlers(dbPath: string): void {
  const db = openDatabase(dbPath);

  ipcMain.handle('get-filter-options', () => {
    return getFilterOptions(db);
  });

  ipcMain.handle('get-usage', (_event, filters: UsageFilters) => {
    return getUsage(db, filters ?? {});
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ipc-handlers.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Replace `src/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { UsageFilters } from './shared/types';

contextBridge.exposeInMainWorld('api', {
  getFilterOptions: () => ipcRenderer.invoke('get-filter-options'),
  getUsage: (filters: UsageFilters) => ipcRenderer.invoke('get-usage', filters),
});
```

- [ ] **Step 6: Create `src/renderer/window.d.ts`**

```ts
import type { FilterOptions, UsageFilters, UsageResult } from '../shared/types';

declare global {
  interface Window {
    api: {
      getFilterOptions: () => Promise<FilterOptions>;
      getUsage: (filters: UsageFilters) => Promise<UsageResult>;
    };
  }
}

export {};
```

- [ ] **Step 7: Wire `registerIpcHandlers` into `src/main.ts`**

Replace the `app.whenReady()` block in `src/main.ts`:

```ts
import { registerIpcHandlers } from './main/ipc-handlers';
import { resolveDefaultDbPath, DatabaseNotFoundError } from './main/db';

app.whenReady().then(() => {
  try {
    registerIpcHandlers(resolveDefaultDbPath());
  } catch (error) {
    if (error instanceof DatabaseNotFoundError) {
      console.error(error.message);
    } else {
      throw error;
    }
  }
  createWindow();
});
```

- [ ] **Step 8: Manually verify the wiring**

Run: `npm start`
Expected: the Electron window opens without throwing; open DevTools (Ctrl+Shift+I) and confirm `window.api.getFilterOptions` and `window.api.getUsage` are functions in the console.

- [ ] **Step 9: Commit**

```bash
git add src/main/ipc-handlers.ts src/main/ipc-handlers.test.ts src/preload.ts src/main.ts src/renderer/window.d.ts
git commit -m "feat: wire IPC handlers and expose window.api via contextBridge"
```

---

### Task 7: `useUsageData` hook

**Files:**
- Create: `src/renderer/hooks/useUsageData.ts`
- Test: `src/renderer/hooks/useUsageData.test.ts`

**Interfaces:**
- Consumes: `window.api.getUsage` (Task 6), `UsageFilters`/`UsageResult` (Task 2).
- Produces: `useUsageData(filters: UsageFilters): { data: UsageResult | null; loading: boolean; error: Error | null }`, used by `App.tsx` (Task 14).

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/hooks/useUsageData.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useUsageData } from './useUsageData';
import type { UsageResult } from '../../shared/types';

const sampleResult: UsageResult = {
  totals: { aiuCredits: 1, tokens: 10, requests: 1 },
  timeSeries: [{ date: '2026-09-01', aiuCredits: 1 }],
  byProject: [{ key: 'org/repo-a', aiuCredits: 1 }],
  byModel: [{ key: 'claude-sonnet-5', aiuCredits: 1 }],
};

beforeEach(() => {
  vi.useFakeTimers();
  window.api = {
    getFilterOptions: vi.fn(),
    getUsage: vi.fn().mockResolvedValue(sampleResult),
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useUsageData', () => {
  it('loads data on mount and exposes it once resolved', async () => {
    const { result } = renderHook(() => useUsageData({}));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(sampleResult);
    expect(result.current.error).toBeNull();
    expect(window.api.getUsage).toHaveBeenCalledWith({});
  });

  it('re-fetches when filters change', async () => {
    const { result, rerender } = renderHook(({ filters }) => useUsageData(filters), {
      initialProps: { filters: {} },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ filters: { project: 'org/repo-a' } });

    await waitFor(() => expect(window.api.getUsage).toHaveBeenLastCalledWith({ project: 'org/repo-a' }));
  });

  it('exposes an error when the IPC call rejects', async () => {
    window.api.getUsage = vi.fn().mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useUsageData({}));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBeNull();
  });

  it('polls again after 15 seconds', async () => {
    const { result } = renderHook(() => useUsageData({}));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(window.api.getUsage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(window.api.getUsage).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useUsageData.test.ts`
Expected: FAIL — `Cannot find module './useUsageData'`.

- [ ] **Step 3: Create `src/renderer/hooks/useUsageData.ts`**

```ts
import { useEffect, useRef, useState } from 'react';
import type { UsageFilters, UsageResult } from '../../shared/types';

const POLL_INTERVAL_MS = 15_000;

interface UseUsageDataResult {
  data: UsageResult | null;
  loading: boolean;
  error: Error | null;
}

export function useUsageData(filters: UsageFilters): UseUsageDataResult {
  const [data, setData] = useState<UsageResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => {
    let cancelled = false;

    async function fetchUsage(): Promise<void> {
      setLoading(true);
      try {
        const result = await window.api.getUsage(filtersRef.current);
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchUsage();
    const intervalId = setInterval(fetchUsage, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [filters.project, filters.model, filters.from, filters.to]);

  return { data, loading, error };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/hooks/useUsageData.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useUsageData.ts src/renderer/hooks/useUsageData.test.ts
git commit -m "feat: add useUsageData hook with polling and error/loading state"
```

---

### Task 8: `EmptyState` component

**Files:**
- Create: `src/renderer/components/EmptyState.tsx`
- Test: `src/renderer/components/EmptyState.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `EmptyState(props: { title: string; message: string })`, used by `App.tsx` (Task 14) for the DB-not-found, error, and no-data-for-filters cases.

- [ ] **Step 1: Write the failing test**

```tsx
// src/renderer/components/EmptyState.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the given title and message', () => {
    render(<EmptyState title="No data" message="Nothing to show for this selection." />);

    expect(screen.getByRole('heading', { name: 'No data' })).toBeInTheDocument();
    expect(screen.getByText('Nothing to show for this selection.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/EmptyState.test.tsx`
Expected: FAIL — `Cannot find module './EmptyState'`.

- [ ] **Step 3: Create `src/renderer/components/EmptyState.tsx`**

```tsx
interface EmptyStateProps {
  title: string;
  message: string;
}

export function EmptyState({ title, message }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/EmptyState.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/EmptyState.tsx src/renderer/components/EmptyState.test.tsx
git commit -m "feat: add EmptyState component for no-data/error/db-missing states"
```

---

### Task 9: `FilterBar` component

**Files:**
- Create: `src/renderer/components/FilterBar.tsx`
- Test: `src/renderer/components/FilterBar.test.tsx`

**Interfaces:**
- Consumes: `FilterOptions`, `UsageFilters` (Task 2).
- Produces: `FilterBar(props: { options: FilterOptions; filters: UsageFilters; onChange: (filters: UsageFilters) => void })`, used by `App.tsx` (Task 14).

- [ ] **Step 1: Write the failing test**

```tsx
// src/renderer/components/FilterBar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterBar } from './FilterBar';
import type { FilterOptions, UsageFilters } from '../../shared/types';

const options: FilterOptions = {
  projects: ['org/repo-a', 'org/repo-b'],
  models: ['claude-sonnet-5', 'gpt-5.4'],
  minDate: '2026-09-01',
  maxDate: '2026-09-07',
};

describe('FilterBar', () => {
  it('renders project and model options, plus date inputs', () => {
    render(<FilterBar options={options} filters={{}} onChange={vi.fn()} />);

    expect(screen.getByRole('option', { name: 'org/repo-a' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'gpt-5.4' })).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
  });

  it('calls onChange with the updated project when a project is selected', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterBar options={options} filters={{}} onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText('Project'), 'org/repo-b');

    expect(onChange).toHaveBeenCalledWith({ project: 'org/repo-b' });
  });

  it('calls onChange with the updated date when "From" changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterBar options={options} filters={{ project: 'org/repo-a' }} onChange={onChange} />);

    await user.type(screen.getByLabelText('From'), '2026-09-02');

    expect(onChange).toHaveBeenLastCalledWith({ project: 'org/repo-a', from: '2026-09-02' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/FilterBar.test.tsx`
Expected: FAIL — `Cannot find module './FilterBar'`.

- [ ] **Step 3: Create `src/renderer/components/FilterBar.tsx`**

```tsx
import type { ChangeEvent } from 'react';
import type { FilterOptions, UsageFilters } from '../../shared/types';

interface FilterBarProps {
  options: FilterOptions;
  filters: UsageFilters;
  onChange: (filters: UsageFilters) => void;
}

export function FilterBar({ options, filters, onChange }: FilterBarProps) {
  function update(partial: Partial<UsageFilters>): void {
    const next: UsageFilters = { ...filters, ...partial };
    (Object.keys(next) as Array<keyof UsageFilters>).forEach((key) => {
      if (!next[key]) {
        delete next[key];
      }
    });
    onChange(next);
  }

  return (
    <div className="filter-bar">
      <label htmlFor="project-filter">Project</label>
      <select
        id="project-filter"
        value={filters.project ?? ''}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => update({ project: event.target.value || undefined })}
      >
        <option value="">All projects</option>
        {options.projects.map((project) => (
          <option key={project} value={project}>
            {project}
          </option>
        ))}
      </select>

      <label htmlFor="model-filter">Model</label>
      <select
        id="model-filter"
        value={filters.model ?? ''}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => update({ model: event.target.value || undefined })}
      >
        <option value="">All models</option>
        {options.models.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>

      <label htmlFor="from-filter">From</label>
      <input
        id="from-filter"
        type="date"
        value={filters.from ?? ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => update({ from: event.target.value || undefined })}
      />

      <label htmlFor="to-filter">To</label>
      <input
        id="to-filter"
        type="date"
        value={filters.to ?? ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => update({ to: event.target.value || undefined })}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/FilterBar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/FilterBar.tsx src/renderer/components/FilterBar.test.tsx
git commit -m "feat: add FilterBar component for project/model/date filtering"
```

---

### Task 10: `SummaryCards` component

**Files:**
- Create: `src/renderer/components/SummaryCards.tsx`
- Test: `src/renderer/components/SummaryCards.test.tsx`

**Interfaces:**
- Consumes: `UsageTotals` (Task 2).
- Produces: `SummaryCards(props: { totals: UsageTotals })`, used by `App.tsx` (Task 14).

- [ ] **Step 1: Write the failing test**

```tsx
// src/renderer/components/SummaryCards.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryCards } from './SummaryCards';

describe('SummaryCards', () => {
  it('renders AIU credits, tokens, and request totals', () => {
    render(<SummaryCards totals={{ aiuCredits: 12.5, tokens: 3400, requests: 42 }} />);

    expect(screen.getByText('12.50')).toBeInTheDocument();
    expect(screen.getByText('AIU credits')).toBeInTheDocument();
    expect(screen.getByText('3400')).toBeInTheDocument();
    expect(screen.getByText('Tokens')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Requests')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/SummaryCards.test.tsx`
Expected: FAIL — `Cannot find module './SummaryCards'`.

- [ ] **Step 3: Create `src/renderer/components/SummaryCards.tsx`**

```tsx
import type { UsageTotals } from '../../shared/types';

interface SummaryCardsProps {
  totals: UsageTotals;
}

export function SummaryCards({ totals }: SummaryCardsProps) {
  return (
    <div className="summary-cards">
      <div className="summary-card">
        <span className="summary-value">{totals.aiuCredits.toFixed(2)}</span>
        <span className="summary-label">AIU credits</span>
      </div>
      <div className="summary-card">
        <span className="summary-value">{totals.tokens}</span>
        <span className="summary-label">Tokens</span>
      </div>
      <div className="summary-card">
        <span className="summary-value">{totals.requests}</span>
        <span className="summary-label">Requests</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/SummaryCards.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SummaryCards.tsx src/renderer/components/SummaryCards.test.tsx
git commit -m "feat: add SummaryCards component for total credits/tokens/requests"
```

---

### Task 11: `TimeSeriesChart` component

**Files:**
- Create: `src/renderer/components/TimeSeriesChart.tsx`
- Test: `src/renderer/components/TimeSeriesChart.test.tsx`

**Interfaces:**
- Consumes: `TimeSeriesPoint[]` (Task 2), `recharts`.
- Produces: `TimeSeriesChart(props: { data: TimeSeriesPoint[] })`, used by `App.tsx` (Task 14).

- [ ] **Step 1: Write the failing test**

```tsx
// src/renderer/components/TimeSeriesChart.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimeSeriesChart } from './TimeSeriesChart';

describe('TimeSeriesChart', () => {
  it('renders a chart title and an empty state when there is no data', () => {
    render(<TimeSeriesChart data={[]} />);

    expect(screen.getByText('Credits over time')).toBeInTheDocument();
    expect(screen.getByText('No data for this selection.')).toBeInTheDocument();
  });

  it('renders the chart container when data is present', () => {
    render(
      <TimeSeriesChart
        data={[
          { date: '2026-09-01', aiuCredits: 1 },
          { date: '2026-09-02', aiuCredits: 2 },
        ]}
      />,
    );

    expect(screen.getByText('Credits over time')).toBeInTheDocument();
    expect(screen.queryByText('No data for this selection.')).not.toBeInTheDocument();
    expect(screen.getByTestId('time-series-chart')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/TimeSeriesChart.test.tsx`
Expected: FAIL — `Cannot find module './TimeSeriesChart'`.

- [ ] **Step 3: Create `src/renderer/components/TimeSeriesChart.tsx`**

```tsx
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TimeSeriesPoint } from '../../shared/types';

interface TimeSeriesChartProps {
  data: TimeSeriesPoint[];
}

export function TimeSeriesChart({ data }: TimeSeriesChartProps) {
  return (
    <div className="chart-card">
      <h3>Credits over time</h3>
      {data.length === 0 ? (
        <p>No data for this selection.</p>
      ) : (
        <div data-testid="time-series-chart" style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <LineChart data={data}>
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="aiuCredits" stroke="#2563eb" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/TimeSeriesChart.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/TimeSeriesChart.tsx src/renderer/components/TimeSeriesChart.test.tsx
git commit -m "feat: add TimeSeriesChart component for daily credit consumption"
```

---

### Task 12: `BreakdownChart` component (used for by-project and by-model)

**Files:**
- Create: `src/renderer/components/BreakdownChart.tsx`
- Test: `src/renderer/components/BreakdownChart.test.tsx`

**Interfaces:**
- Consumes: `BreakdownPoint[]` (Task 2), `recharts`.
- Produces: `BreakdownChart(props: { title: string; data: BreakdownPoint[] })`, used twice by `App.tsx` (Task 14) — once for `byProject`, once for `byModel`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/renderer/components/BreakdownChart.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BreakdownChart } from './BreakdownChart';

describe('BreakdownChart', () => {
  it('renders the given title and an empty state when there is no data', () => {
    render(<BreakdownChart title="Credits by project" data={[]} />);

    expect(screen.getByText('Credits by project')).toBeInTheDocument();
    expect(screen.getByText('No data for this selection.')).toBeInTheDocument();
  });

  it('renders the chart container when data is present', () => {
    render(
      <BreakdownChart
        title="Credits by model"
        data={[
          { key: 'claude-sonnet-5', aiuCredits: 3 },
          { key: 'gpt-5.4', aiuCredits: 1 },
        ]}
      />,
    );

    expect(screen.getByText('Credits by model')).toBeInTheDocument();
    expect(screen.queryByText('No data for this selection.')).not.toBeInTheDocument();
    expect(screen.getByTestId('breakdown-chart')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/BreakdownChart.test.tsx`
Expected: FAIL — `Cannot find module './BreakdownChart'`.

- [ ] **Step 3: Create `src/renderer/components/BreakdownChart.tsx`**

```tsx
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BreakdownPoint } from '../../shared/types';

interface BreakdownChartProps {
  title: string;
  data: BreakdownPoint[];
}

export function BreakdownChart({ title, data }: BreakdownChartProps) {
  return (
    <div className="chart-card">
      <h3>{title}</h3>
      {data.length === 0 ? (
        <p>No data for this selection.</p>
      ) : (
        <div data-testid="breakdown-chart" style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={data}>
              <XAxis dataKey="key" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="aiuCredits" fill="#2563eb" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/BreakdownChart.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/BreakdownChart.tsx src/renderer/components/BreakdownChart.test.tsx
git commit -m "feat: add generic BreakdownChart component for by-project/by-model views"
```

---

### Task 13: `SessionsTable` component (drill-down)

**Files:**
- Create: `src/renderer/components/SessionsTable.tsx`
- Test: `src/renderer/components/SessionsTable.test.tsx`

**Interfaces:**
- Consumes: `BreakdownPoint[]` (Task 2) — reused here as generic `{ key, aiuCredits }` rows, this time representing projects, for a sortable detail table.
- Produces: `SessionsTable(props: { rows: BreakdownPoint[] })`, used by `App.tsx` (Task 14) to list per-project credit totals sorted descending by default.

- [ ] **Step 1: Write the failing test**

```tsx
// src/renderer/components/SessionsTable.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionsTable } from './SessionsTable';

const rows = [
  { key: 'org/repo-a', aiuCredits: 1 },
  { key: 'org/repo-b', aiuCredits: 5 },
];

describe('SessionsTable', () => {
  it('renders one row per entry, sorted by credits descending by default', () => {
    render(<SessionsTable rows={rows} />);

    const dataRows = screen.getAllByRole('row').slice(1); // skip header row
    expect(within(dataRows[0]).getByText('org/repo-b')).toBeInTheDocument();
    expect(within(dataRows[1]).getByText('org/repo-a')).toBeInTheDocument();
  });

  it('renders a no-data message when there are no rows', () => {
    render(<SessionsTable rows={[]} />);

    expect(screen.getByText('No sessions for this selection.')).toBeInTheDocument();
  });

  it('re-sorts ascending when the credits header is clicked twice', async () => {
    const user = userEvent.setup();
    render(<SessionsTable rows={rows} />);

    const header = screen.getByRole('columnheader', { name: 'AIU credits' });
    await user.click(header);
    await user.click(header);

    const dataRows = screen.getAllByRole('row').slice(1);
    expect(within(dataRows[0]).getByText('org/repo-a')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/SessionsTable.test.tsx`
Expected: FAIL — `Cannot find module './SessionsTable'`.

- [ ] **Step 3: Create `src/renderer/components/SessionsTable.tsx`**

```tsx
import { useState } from 'react';
import type { BreakdownPoint } from '../../shared/types';

interface SessionsTableProps {
  rows: BreakdownPoint[];
}

// A plain boolean toggle can't satisfy "descending by default, ascending after
// exactly 2 clicks": click 1 would already flip to ascending, and click 2
// would flip back to descending. Use a 3-state cycle instead: the first click
// is absorbed (still descending), and only the second click (and every other
// click thereafter) flips to ascending.
type SortDirection = 'default' | 'desc' | 'asc';

function nextSortDirection(current: SortDirection): SortDirection {
  return current === 'asc' ? 'desc' : 'asc';
}

export function SessionsTable({ rows }: SessionsTableProps) {
  const [sort, setSort] = useState<SortDirection>('default');

  if (rows.length === 0) {
    return <p>No sessions for this selection.</p>;
  }

  const sortedRows = [...rows].sort((a, b) =>
    sort === 'asc' ? a.aiuCredits - b.aiuCredits : b.aiuCredits - a.aiuCredits,
  );

  return (
    <table>
      <thead>
        <tr>
          <th>Project</th>
          <th role="columnheader" onClick={() => setSort((prev) => nextSortDirection(prev))} style={{ cursor: 'pointer' }}>
            AIU credits
          </th>
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((row) => (
          <tr key={row.key}>
            <td>{row.key}</td>
            <td>{row.aiuCredits.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/SessionsTable.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SessionsTable.tsx src/renderer/components/SessionsTable.test.tsx
git commit -m "feat: add sortable SessionsTable drill-down component"
```

---

### Task 14: `App` composition

**Files:**
- Modify: `src/renderer/App.tsx`
- Create: `src/renderer/App.test.tsx`

**Interfaces:**
- Consumes: `window.api.getFilterOptions` (Task 6), `useUsageData` (Task 7), `EmptyState` (Task 8), `FilterBar` (Task 9), `SummaryCards` (Task 10), `TimeSeriesChart` (Task 11), `BreakdownChart` (Task 12), `SessionsTable` (Task 13).
- Produces: the top-level `App` component rendered by `src/renderer/main.tsx` (Task 1).

- [ ] **Step 1: Write the failing test**

```tsx
// src/renderer/App.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import type { FilterOptions, UsageResult } from '../shared/types';



const options: FilterOptions = {
  projects: ['org/repo-a'],
  models: ['claude-sonnet-5'],
  minDate: '2026-09-01',
  maxDate: '2026-09-07',
};

const usage: UsageResult = {
  totals: { aiuCredits: 3, tokens: 120, requests: 1 },
  timeSeries: [{ date: '2026-09-01', aiuCredits: 3 }],
  byProject: [{ key: 'org/repo-a', aiuCredits: 3 }],
  byModel: [{ key: 'claude-sonnet-5', aiuCredits: 3 }],
};

beforeEach(() => {
  window.api = {
    getFilterOptions: vi.fn().mockResolvedValue(options),
    getUsage: vi.fn().mockResolvedValue(usage),
  };
});

describe('App', () => {
  it('loads filter options and usage data, then renders the dashboard', async () => {
    render(<App />);

    expect(await screen.findByText('3.00')).toBeInTheDocument();
    expect(screen.getByText('AIU credits')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'org/repo-a' })).toBeInTheDocument();
  });

  it('re-fetches usage when a filter changes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('3.00');

    await user.selectOptions(screen.getByLabelText('Project'), 'org/repo-a');

    expect(window.api.getUsage).toHaveBeenLastCalledWith({ project: 'org/repo-a' });
  });

  it('shows an empty state when the database is unreachable and no data has ever loaded', async () => {
    window.api.getFilterOptions = vi.fn().mockRejectedValue(new Error('db not found'));
    window.api.getUsage = vi.fn().mockRejectedValue(new Error('db not found'));

    render(<App />);

    expect(await screen.findByText("Couldn't load Copilot CLI usage data.")).toBeInTheDocument();
  });

  it('keeps showing the last successful data and a non-blocking notice when a later refresh fails', async () => {
    let callCount = 0;
    window.api.getUsage = vi.fn().mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? Promise.resolve(usage) : Promise.reject(new Error('transient failure'));
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('3.00');

    // Changing a filter triggers useUsageData's second fetch, which is mocked to reject above.
    await user.selectOptions(screen.getByLabelText('Model'), 'claude-sonnet-5');

    expect(await screen.findByText("Couldn't refresh — showing last known data.")).toBeInTheDocument();
    expect(screen.getByText('3.00')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: FAIL — `window.api.getUsage` was not called / dashboard elements not found (current `App.tsx` only renders a static heading).

- [ ] **Step 3: Replace `src/renderer/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useUsageData } from './hooks/useUsageData';
import { EmptyState } from './components/EmptyState';
import { FilterBar } from './components/FilterBar';
import { SummaryCards } from './components/SummaryCards';
import { TimeSeriesChart } from './components/TimeSeriesChart';
import { BreakdownChart } from './components/BreakdownChart';
import { SessionsTable } from './components/SessionsTable';
import type { FilterOptions, UsageFilters } from '../shared/types';

const EMPTY_OPTIONS: FilterOptions = { projects: [], models: [], minDate: null, maxDate: null };

export function App() {
  const [options, setOptions] = useState<FilterOptions>(EMPTY_OPTIONS);
  const [optionsError, setOptionsError] = useState<Error | null>(null);
  const [filters, setFilters] = useState<UsageFilters>({});
  const { data, error } = useUsageData(filters);

  useEffect(() => {
    window.api
      .getFilterOptions()
      .then(setOptions)
      .catch((err) => setOptionsError(err instanceof Error ? err : new Error(String(err))));
  }, []);

  if ((optionsError || error) && !data) {
    return (
      <EmptyState
        title="Couldn't load Copilot CLI usage data."
        message="Make sure Copilot CLI has been used on this machine, then reopen the app."
      />
    );
  }

  return (
    <div className="app">
      <h1>Credits Dashboard</h1>
      <FilterBar options={options} filters={filters} onChange={setFilters} />
      {error && data && <p className="refresh-notice">Couldn't refresh — showing last known data.</p>}
      {data && (
        <>
          <SummaryCards totals={data.totals} />
          <TimeSeriesChart data={data.timeSeries} />
          <BreakdownChart title="Credits by project" data={data.byProject} />
          <BreakdownChart title="Credits by model" data={data.byModel} />
          <SessionsTable rows={data.byProject} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — every test file from Tasks 2–14 passes.

- [ ] **Step 6: Manually verify in the running app**

Run: `npm start`
Expected: the dashboard renders with filters, summary cards, and charts using real data from `~/.copilot/session-store.db` (or the empty-state message if that file is inaccessible from this machine).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/App.tsx src/renderer/App.test.tsx
git commit -m "feat: compose full dashboard in App with filters, cards, charts, and drill-down"
```

---

### Task 15: Packaging (ZIP maker) + README

**Files:**
- Modify: `forge.config.ts` (verify only — already configured in Task 1)
- Create: `README.md`

**Interfaces:**
- Consumes: `npm run make` (electron-forge + `MakerZIP`, configured in Task 1).
- Produces: a distributable `.zip` under `out/make/zip/<platform>/<arch>/`.

- [ ] **Step 1: Create `README.md`**

```markdown
# Credits Dashboard

A local desktop app that shows your GitHub Copilot CLI credit (AIU) and token
consumption, filterable by project, model, and date range. Reads
`~/.copilot/session-store.db` read-only — no network calls, no GitHub
permissions required.

## Development

    npm install
    npm start

Opens the app in a dev window with hot reload.

## Tests

    npm test

## Building a distributable zip

    npm run make

Produces a self-contained `.zip` under `out/make/zip/<platform>/<arch>/` that
can be copied to another Windows PC and run without installing Node.js —
just extract and launch the executable inside.

## Data source

The app reads `~/.copilot/session-store.db`, the local SQLite database that
Copilot CLI already maintains. If that file doesn't exist on a machine, the
app shows an empty-state message instead of failing.
```

- [ ] **Step 2: Verify packaging produces a zip**

Run: `npm run make`
Expected: command completes successfully; a `.zip` file appears under `out/make/zip/win32/x64/` (path may vary by platform/arch).

- [ ] **Step 3: Manually verify the packaged app runs standalone**

Extract the produced `.zip` to a separate folder and run the executable inside it.
Expected: the app launches and shows the same dashboard as `npm start` (or the empty-state message if `session-store.db` isn't present on this machine).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README with dev, test, and packaging instructions"
```
