# Project Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user click a bar in the "Credits by project" chart and navigate to a detail page listing that project's individual Copilot CLI conversations (sessions) and their costs.

**Architecture:** Add a new `getProjectDetail` query in the main-process DB layer, exposed via a new `get-project-detail` IPC channel and `window.api.getProjectDetail`. In the renderer, add a `useProjectDetail` hook (mirrors `useUsageData`) and a new `ProjectDetailPage` component with a `ConversationsTable`. `App.tsx` gets a `selectedProject` state toggle (no router) and wires an `onBarClick` prop into `BreakdownChart` for the "Credits by project" chart only.

**Tech Stack:** TypeScript, React, Vitest + @testing-library/react, better-sqlite3, Electron IPC (`ipcMain`/`ipcRenderer`/`contextBridge`), Tailwind CSS + existing shadcn-style primitives (`Card`, `Table`, `Skeleton`).

## Global Constraints

- "Conversation" = one row in the `sessions` table (per spec's Data model section).
- No routing library — a `selectedProject: string | null` state toggle in `App.tsx` is the entire navigation mechanism (per spec's Architecture section).
- Only the "Credits by project" `BreakdownChart` instance becomes clickable; "Credits by model" is unaffected (per spec's Architecture section).
- Reuse `buildWhereClause` in `db.ts` for the project filter — no new WHERE-clause logic (per spec's `db.ts` section).
- Conversations list default sort: most recent first (`ORDER BY s.created_at DESC`) (per spec's `db.ts` section).
- Follow existing loading/error/empty-state conventions (`Skeleton`, `EmptyState`-style messaging, "Couldn't refresh — showing last known data.") for the new page (per spec's Error handling section).

---

### Task 1: Shared types for project detail data

**Files:**
- Modify: `src/shared/types.ts`
- Test: `src/shared/types.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ConversationSummary` and `ProjectDetailResult` types, used by Task 2 (`db.ts`), Task 3 (`ipc-handlers.ts`/`preload.ts`), and Task 5+ (renderer).

```ts
export interface ConversationSummary {
  sessionId: string;
  createdAt: string;
  summary: string | null;
  models: string; // comma-joined distinct model names
  aiuCredits: number;
  tokens: number;
  requests: number;
}

export interface ProjectDetailResult {
  project: string;
  totals: UsageTotals;
  conversations: ConversationSummary[];
}
```

- [ ] **Step 1: Look at the existing type test file for conventions**

Run: view `src/shared/types.test.ts` to see how existing types (e.g. `UsageResult`) are tested (likely a compile-time/shape assertion pattern using `satisfies` or a sample object). Match that pattern for the new types.

- [ ] **Step 2: Write the failing test**

Add to `src/shared/types.test.ts` (follow the file's existing style/imports; if the file asserts shapes via a sample object typed with `satisfies`, do the same here):

```ts
import type { ConversationSummary, ProjectDetailResult } from './types';

describe('ProjectDetailResult', () => {
  it('accepts a well-formed value', () => {
    const sample = {
      sessionId: 's1',
      createdAt: '2026-09-01 10:00:00',
      summary: 'Fixed a bug',
      models: 'claude-sonnet-5,gpt-5.4',
      aiuCredits: 3,
      tokens: 120,
      requests: 2,
    } satisfies ConversationSummary;

    const result = {
      project: 'org/repo-a',
      totals: { aiuCredits: 3, tokens: 120, requests: 2 },
      conversations: [sample],
    } satisfies ProjectDetailResult;

    expect(result.conversations[0].sessionId).toBe('s1');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/shared/types.test.ts`
Expected: FAIL — `ConversationSummary`/`ProjectDetailResult` not exported from `./types`.

- [ ] **Step 4: Add the types**

Append to `src/shared/types.ts`:

```ts
export interface ConversationSummary {
  sessionId: string;
  createdAt: string;
  summary: string | null;
  models: string; // comma-joined distinct model names
  aiuCredits: number;
  tokens: number;
  requests: number;
}

export interface ProjectDetailResult {
  project: string;
  totals: UsageTotals;
  conversations: ConversationSummary[];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/shared/types.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/types.test.ts
git commit -m "feat: add ConversationSummary and ProjectDetailResult types"
```

---

### Task 2: `getProjectDetail` query in `db.ts`

**Files:**
- Modify: `src/main/db.ts`
- Test: `src/main/db.test.ts`

**Interfaces:**
- Consumes: `UsageFilters`, `ProjectDetailResult`, `ConversationSummary` from `../shared/types`; the existing `buildWhereClause(filters: UsageFilters): WhereClause` helper already in `db.ts`.
- Produces: `getProjectDetail(db: Database.Database, filters: UsageFilters & { project: string }): ProjectDetailResult`, used by Task 3 (`ipc-handlers.ts`).

- [ ] **Step 1: Write the failing tests**

Add to `src/main/db.test.ts` (reuse the existing `seedSchemaAndFixtures` helper already defined in that file; it creates `sessions(id, cwd, repository, created_at)` and `assistant_usage_events(id, session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)` and seeds two sessions `s1`/`org/repo-a` and `s2`/`repo-b` each with one usage event). Extend the schema/fixtures inline in a new `describe` block since `summary` isn't in the shared fixture:

```ts
import { getProjectDetail } from './db';

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
    // s1 has two events with two different models -> models should be comma-joined & distinct
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
    expect(result.totals).toEqual({ aiuCredits: 3.5, tokens: 210, requests: 3 });
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
  });

  it('applies additional filters (model) on top of the project filter', () => {
    const db = new Database(':memory:');
    seedWithSummaryAndSecondEvent(db);

    const result = getProjectDetail(db, { project: 'org/repo-a', model: 'gpt-5.4' });

    expect(result.conversations.map((c) => c.sessionId)).toEqual(['s2']);
    expect(result.totals).toEqual({ aiuCredits: 0.5, tokens: 35, requests: 1 });
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/db.test.ts`
Expected: FAIL — `getProjectDetail` is not exported from `./db`.

- [ ] **Step 3: Implement `getProjectDetail`**

Add to `src/main/db.ts` (below the existing `getUsage` function), importing the new shared types at the top:

```ts
import type { FilterOptions, ProjectDetailResult, UsageFilters, UsageResult } from '../shared/types';
```

```ts
export function getProjectDetail(
  db: Database.Database,
  filters: UsageFilters & { project: string },
): ProjectDetailResult {
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

  const conversations = db
    .prepare(
      `SELECT
         s.id AS sessionId,
         s.created_at AS createdAt,
         s.summary AS summary,
         GROUP_CONCAT(DISTINCT e.model) AS models,
         SUM(e.total_nano_aiu) / 1e9 AS aiuCredits,
         SUM(e.input_tokens + e.output_tokens) AS tokens,
         COUNT(*) AS requests
       ${baseFrom}
       GROUP BY s.id
       ORDER BY s.created_at DESC`,
    )
    .all(params) as Array<{
    sessionId: string;
    createdAt: string;
    summary: string | null;
    models: string;
    aiuCredits: number;
    tokens: number;
    requests: number;
  }>;

  return {
    project: filters.project,
    totals: totalsRow,
    conversations,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/db.test.ts`
Expected: PASS (all `getProjectDetail` tests plus pre-existing `db.test.ts` tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/db.ts src/main/db.test.ts
git commit -m "feat: add getProjectDetail query to db.ts"
```

---

### Task 3: IPC channel + preload exposure for project detail

**Files:**
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/preload.ts`
- Test: `src/main/ipc-handlers.test.ts`

**Interfaces:**
- Consumes: `getProjectDetail(db, filters)` from Task 2's `./db` module.
- Produces: `get-project-detail` IPC channel; `window.api.getProjectDetail(params: UsageFilters & { project: string }): Promise<ProjectDetailResult>` used by Task 4's `useProjectDetail` hook.

- [ ] **Step 1: Write the failing test**

Add to `src/main/ipc-handlers.test.ts`, inside the existing `describe('registerIpcHandlers', ...)` block (it already mocks `./db`'s `openDatabase` to build an in-memory db with `sessions`/`assistant_usage_events` tables — reuse that mock, it needs no schema changes since `getProjectDetail`'s query only needs those two tables plus a `summary` column; add `summary TEXT` to the mocked `CREATE TABLE sessions` statement in the `vi.mock('./db', ...)` block so `getProjectDetail` doesn't error on a missing column):

```ts
it('registers a get-project-detail handler', () => {
  registerIpcHandlers('/fake/path.db');

  expect(ipcMain.handle).toHaveBeenCalledWith('get-project-detail', expect.any(Function));
});

it('get-project-detail handler forwards filters and returns a ProjectDetailResult shape', async () => {
  registerIpcHandlers('/fake/path.db');
  const handlers = (ipcMain as unknown as { __handlers: Map<string, (...args: unknown[]) => unknown> }).__handlers;
  const getProjectDetailHandler = handlers.get('get-project-detail')!;

  const result = await getProjectDetailHandler({}, { project: 'org/repo-a' });

  expect(result).toEqual({
    project: 'org/repo-a',
    totals: { aiuCredits: 0, tokens: 0, requests: 0 },
    conversations: [],
  });
});
```

Also update the `vi.mock('./db', ...)` block's `CREATE TABLE sessions` statement to add `summary TEXT,` (before `created_at TEXT`) so it matches the real schema shape used by `getProjectDetail`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ipc-handlers.test.ts`
Expected: FAIL — no `get-project-detail` handler registered.

- [ ] **Step 3: Register the handler**

Modify `src/main/ipc-handlers.ts`:

```ts
import { openDatabase, getFilterOptions, getUsage, getProjectDetail } from './db';
import type { UsageFilters } from '../shared/types';

export function registerIpcHandlers(dbPath: string): void {
  const db = openDatabase(dbPath);

  ipcMain.handle('get-filter-options', () => {
    return getFilterOptions(db);
  });

  ipcMain.handle('get-usage', (_event, filters: UsageFilters) => {
    return getUsage(db, filters ?? {});
  });

  ipcMain.handle('get-project-detail', (_event, params: UsageFilters & { project: string }) => {
    return getProjectDetail(db, params);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ipc-handlers.test.ts`
Expected: PASS

- [ ] **Step 5: Expose via preload (manual verification only, no automated test — `preload.ts` is a thin contextBridge wrapper with no existing test file)**

Modify `src/preload.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { ProjectDetailResult, UsageFilters } from './shared/types';

contextBridge.exposeInMainWorld('api', {
  getFilterOptions: () => ipcRenderer.invoke('get-filter-options'),
  getUsage: (filters: UsageFilters) => ipcRenderer.invoke('get-usage', filters),
  getProjectDetail: (params: UsageFilters & { project: string }): Promise<ProjectDetailResult> =>
    ipcRenderer.invoke('get-project-detail', params),
});
```

- [ ] **Step 6: Update the renderer's `window.api` type declaration**

Modify `src/renderer/window.d.ts`:

```ts
import type { FilterOptions, ProjectDetailResult, UsageFilters, UsageResult } from '../shared/types';

declare global {
  interface Window {
    api: {
      getFilterOptions: () => Promise<FilterOptions>;
      getUsage: (filters: UsageFilters) => Promise<UsageResult>;
      getProjectDetail: (params: UsageFilters & { project: string }) => Promise<ProjectDetailResult>;
    };
  }
}

export {};
```

- [ ] **Step 7: Run full test suite to confirm nothing broke**

Run: `npx vitest run --exclude "**/.worktrees/**"`
Expected: PASS (all existing tests plus new ones).

- [ ] **Step 8: Commit**

```bash
git add src/main/ipc-handlers.ts src/main/ipc-handlers.test.ts src/preload.ts src/renderer/window.d.ts
git commit -m "feat: expose getProjectDetail over IPC and preload API"
```

---

### Task 4: `useProjectDetail` hook

**Files:**
- Create: `src/renderer/hooks/useProjectDetail.ts`
- Test: `src/renderer/hooks/useProjectDetail.test.ts`

**Interfaces:**
- Consumes: `window.api.getProjectDetail` (Task 3); `UsageFilters`, `ProjectDetailResult` from `../../shared/types`.
- Produces: `useProjectDetail(project: string, filters: UsageFilters): { data: ProjectDetailResult | null; loading: boolean; error: Error | null }`, used by Task 6's `ProjectDetailPage`.

This mirrors `src/renderer/hooks/useUsageData.ts` exactly, but calls `getProjectDetail` with `{ ...filters, project }` and re-fetches when `project` or any filter field changes. No polling interval is needed for the detail page (the spec doesn't require live refresh here beyond what filter changes trigger), so omit the `setInterval` — a single fetch per `project`/filter change is sufficient.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/hooks/useProjectDetail.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useProjectDetail } from './useProjectDetail';
import type { ProjectDetailResult } from '../../shared/types';

const detail: ProjectDetailResult = {
  project: 'org/repo-a',
  totals: { aiuCredits: 3, tokens: 120, requests: 2 },
  conversations: [
    {
      sessionId: 's1',
      createdAt: '2026-09-01 10:00:00',
      summary: 'Fixed a bug',
      models: 'claude-sonnet-5',
      aiuCredits: 3,
      tokens: 120,
      requests: 2,
    },
  ],
};

beforeEach(() => {
  window.api = {
    getFilterOptions: vi.fn(),
    getUsage: vi.fn(),
    getProjectDetail: vi.fn().mockResolvedValue(detail),
  };
});

describe('useProjectDetail', () => {
  it('fetches project detail on mount and exposes it as data', async () => {
    const { result } = renderHook(() => useProjectDetail('org/repo-a', {}));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(detail);
    expect(window.api.getProjectDetail).toHaveBeenCalledWith({ project: 'org/repo-a' });
  });

  it('re-fetches when the project or filters change', async () => {
    const { rerender } = renderHook(({ project, filters }) => useProjectDetail(project, filters), {
      initialProps: { project: 'org/repo-a', filters: {} },
    });
    await waitFor(() => expect(window.api.getProjectDetail).toHaveBeenCalledTimes(1));

    rerender({ project: 'org/repo-a', filters: { model: 'claude-sonnet-5' } });

    await waitFor(() => expect(window.api.getProjectDetail).toHaveBeenCalledTimes(2));
    expect(window.api.getProjectDetail).toHaveBeenLastCalledWith({
      project: 'org/repo-a',
      model: 'claude-sonnet-5',
    });
  });

  it('surfaces a rejected fetch as an error', async () => {
    window.api.getProjectDetail = vi.fn().mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useProjectDetail('org/repo-a', {}));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toEqual(new Error('boom'));
    expect(result.current.data).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/hooks/useProjectDetail.test.ts`
Expected: FAIL — module `./useProjectDetail` does not exist.

- [ ] **Step 3: Implement the hook**

Create `src/renderer/hooks/useProjectDetail.ts`:

```ts
import { useEffect, useState } from 'react';
import type { ProjectDetailResult, UsageFilters } from '../../shared/types';

interface UseProjectDetailResult {
  data: ProjectDetailResult | null;
  loading: boolean;
  error: Error | null;
}

export function useProjectDetail(project: string, filters: UsageFilters): UseProjectDetailResult {
  const [data, setData] = useState<ProjectDetailResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchDetail(): Promise<void> {
      setLoading(true);
      try {
        const result = await window.api.getProjectDetail({ ...filters, project });
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

    fetchDetail();

    return () => {
      cancelled = true;
    };
  }, [project, filters.project, filters.model, filters.from, filters.to]);

  return { data, loading, error };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/hooks/useProjectDetail.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useProjectDetail.ts src/renderer/hooks/useProjectDetail.test.ts
git commit -m "feat: add useProjectDetail hook"
```

---

### Task 5: Make `BreakdownChart` clickable via `onBarClick`

**Files:**
- Modify: `src/renderer/components/BreakdownChart.tsx`
- Test: `src/renderer/components/BreakdownChart.test.tsx`

**Interfaces:**
- Consumes: nothing new (still `BreakdownPoint[]` from `../../shared/types`).
- Produces: `BreakdownChart` prop `onBarClick?: (key: string) => void`, used by Task 8 (`App.tsx`).

- [ ] **Step 1: Write the failing tests**

Add to `src/renderer/components/BreakdownChart.test.tsx`:

```ts
import { fireEvent } from '@testing-library/react';

it('calls onBarClick with the clicked bar key when a bar is clicked', () => {
  const onBarClick = vi.fn();
  const { container } = render(
    <BreakdownChart
      title="Credits by project"
      data={[
        { key: 'org/repo-a', aiuCredits: 3 },
        { key: 'org/repo-b', aiuCredits: 1 },
      ]}
      onBarClick={onBarClick}
    />,
  );

  const bar = container.querySelector('.recharts-bar-rectangle') as SVGElement;
  fireEvent.click(bar);

  expect(onBarClick).toHaveBeenCalledWith('org/repo-a');
});

it('does not attach a click handler when onBarClick is omitted', () => {
  render(
    <BreakdownChart
      title="Credits by model"
      data={[{ key: 'claude-sonnet-5', aiuCredits: 3 }]}
    />,
  );

  expect(screen.getByTestId('breakdown-chart')).toBeInTheDocument();
});
```

Note: `vi` must be imported from `vitest` in this test file already (`import { describe, it, expect } from 'vitest';` exists — add `vi` to that import list).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/components/BreakdownChart.test.tsx`
Expected: FAIL — `onBarClick` prop doesn't exist / bar has no click handler.

- [ ] **Step 3: Implement the click handler**

Modify `src/renderer/components/BreakdownChart.tsx`:

```tsx
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import type { BreakdownPoint } from '../../shared/types';

interface BreakdownChartProps {
  title: string;
  data: BreakdownPoint[];
  onBarClick?: (key: string) => void;
}

export function BreakdownChart({ title, data, onBarClick }: BreakdownChartProps) {
  return (
    <Card className="chart-card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data for this selection.</p>
        ) : (
          <div data-testid="breakdown-chart" style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={data}>
                <XAxis dataKey="key" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: '#131922', border: '1px solid #263242', color: '#e5e9f0' }} />
                <Bar
                  dataKey="aiuCredits"
                  fill="#22d3ee"
                  cursor={onBarClick ? 'pointer' : undefined}
                  onClick={onBarClick ? (entry: BreakdownPoint) => onBarClick(entry.key) : undefined}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/components/BreakdownChart.test.tsx`
Expected: PASS. If the `.recharts-bar-rectangle` selector doesn't match recharts' actual rendered DOM (recharts internals can vary by version), inspect the rendered `container.innerHTML` in the failing test output and adjust the selector to whatever path/rect element recharts renders for each bar (it will be an SVG `<path>` or `<rect>` inside a `.recharts-bar` group) — the important behavior is that `onBarClick` fires with the correct `key`, not the exact selector.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/BreakdownChart.tsx src/renderer/components/BreakdownChart.test.tsx
git commit -m "feat: add optional onBarClick handler to BreakdownChart"
```

---

### Task 6: `ConversationsTable` component

**Files:**
- Create: `src/renderer/components/ConversationsTable.tsx`
- Test: `src/renderer/components/ConversationsTable.test.tsx`

**Interfaces:**
- Consumes: `ConversationSummary[]` from `../../shared/types`; `Card`/`CardContent` from `./ui/card`; `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` from `./ui/table`.
- Produces: `ConversationsTable({ conversations: ConversationSummary[] })`, used by Task 7's `ProjectDetailPage`.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/components/ConversationsTable.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConversationsTable } from './ConversationsTable';
import type { ConversationSummary } from '../../shared/types';

const conversations: ConversationSummary[] = [
  {
    sessionId: 's1',
    createdAt: '2026-09-01 10:00:00',
    summary: 'Fixed the login bug',
    models: 'claude-sonnet-5',
    aiuCredits: 3,
    tokens: 180,
    requests: 2,
  },
  {
    sessionId: 's2',
    createdAt: '2026-09-03 10:00:00',
    summary: null,
    models: 'gpt-5.4',
    aiuCredits: 0.5,
    tokens: 35,
    requests: 1,
  },
];

describe('ConversationsTable', () => {
  it('shows an empty message when there are no conversations', () => {
    render(<ConversationsTable conversations={[]} />);

    expect(screen.getByText('No conversations for this selection.')).toBeInTheDocument();
  });

  it('renders one row per conversation with its fields', () => {
    render(<ConversationsTable conversations={conversations} />);

    expect(screen.getByText('Fixed the login bug')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument(); // null summary fallback for s2
    expect(screen.getByText('claude-sonnet-5')).toBeInTheDocument();
    expect(screen.getByText('gpt-5.4')).toBeInTheDocument();
    expect(screen.getByText('3.00')).toBeInTheDocument();
    expect(screen.getByText('0.50')).toBeInTheDocument();
    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/components/ConversationsTable.test.tsx`
Expected: FAIL — module `./ConversationsTable` does not exist.

- [ ] **Step 3: Implement the component**

Create `src/renderer/components/ConversationsTable.tsx`:

```tsx
import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import type { ConversationSummary } from '../../shared/types';

interface ConversationsTableProps {
  conversations: ConversationSummary[];
}

export function ConversationsTable({ conversations }: ConversationsTableProps) {
  if (conversations.length === 0) {
    return <p className="text-sm text-muted-foreground">No conversations for this selection.</p>;
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead>Model(s)</TableHead>
              <TableHead>AIU credits</TableHead>
              <TableHead>Tokens</TableHead>
              <TableHead>Requests</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {conversations.map((conversation) => (
              <TableRow key={conversation.sessionId}>
                <TableCell>{conversation.createdAt}</TableCell>
                <TableCell>{conversation.summary ?? '—'}</TableCell>
                <TableCell>{conversation.models}</TableCell>
                <TableCell>{conversation.aiuCredits.toFixed(2)}</TableCell>
                <TableCell>{conversation.tokens}</TableCell>
                <TableCell>{conversation.requests}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/components/ConversationsTable.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ConversationsTable.tsx src/renderer/components/ConversationsTable.test.tsx
git commit -m "feat: add ConversationsTable component"
```

---

### Task 7: `ProjectDetailPage` component

**Files:**
- Create: `src/renderer/components/ProjectDetailPage.tsx`
- Test: `src/renderer/components/ProjectDetailPage.test.tsx`

**Interfaces:**
- Consumes: `useProjectDetail(project, filters)` from Task 4 (`../hooks/useProjectDetail`); `SummaryCards` from `./SummaryCards`; `ConversationsTable` from Task 6 (`./ConversationsTable`); `Skeleton` from `./ui/skeleton`; `UsageFilters` from `../../shared/types`.
- Produces: `ProjectDetailPage({ project: string; filters: UsageFilters; onBack: () => void })`, used by Task 8's `App.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/components/ProjectDetailPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectDetailPage } from './ProjectDetailPage';
import type { ProjectDetailResult } from '../../shared/types';

const detail: ProjectDetailResult = {
  project: 'org/repo-a',
  totals: { aiuCredits: 3.5, tokens: 210, requests: 3 },
  conversations: [
    {
      sessionId: 's1',
      createdAt: '2026-09-01 10:00:00',
      summary: 'Fixed the login bug',
      models: 'claude-sonnet-5',
      aiuCredits: 3,
      tokens: 180,
      requests: 2,
    },
  ],
};

beforeEach(() => {
  window.api = {
    getFilterOptions: vi.fn(),
    getUsage: vi.fn(),
    getProjectDetail: vi.fn().mockResolvedValue(detail),
  };
});

describe('ProjectDetailPage', () => {
  it('shows the project name, loads detail data, and renders totals + conversations', async () => {
    render(<ProjectDetailPage project="org/repo-a" filters={{}} onBack={vi.fn()} />);

    expect(screen.getByText('org/repo-a')).toBeInTheDocument();
    expect(await screen.findByText('3.50')).toBeInTheDocument();
    expect(screen.getByText('Fixed the login bug')).toBeInTheDocument();
  });

  it('calls onBack when the back button is clicked', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<ProjectDetailPage project="org/repo-a" filters={{}} onBack={onBack} />);
    await screen.findByText('3.50');

    await user.click(screen.getByRole('button', { name: /back/i }));

    expect(onBack).toHaveBeenCalled();
  });

  it('shows a loading skeleton before the first successful fetch', async () => {
    let resolveDetail: (value: ProjectDetailResult) => void = () => {};
    window.api.getProjectDetail = vi.fn().mockImplementation(
      () =>
        new Promise<ProjectDetailResult>((resolve) => {
          resolveDetail = resolve;
        }),
    );

    render(<ProjectDetailPage project="org/repo-a" filters={{}} onBack={vi.fn()} />);

    expect(screen.getAllByRole('status', { name: 'Loading' }).length).toBeGreaterThan(0);

    resolveDetail(detail);
    expect(await screen.findByText('3.50')).toBeInTheDocument();
  });

  it('shows an error message when the fetch fails and no data has loaded', async () => {
    window.api.getProjectDetail = vi.fn().mockRejectedValue(new Error('db not found'));

    render(<ProjectDetailPage project="org/repo-a" filters={{}} onBack={vi.fn()} />);

    expect(await screen.findByText("Couldn't load details for this project.")).toBeInTheDocument();
  });
});
```

Check `src/renderer/components/ui/skeleton.tsx` for the exact `role="status"`/`aria-label="Loading"` pattern already used elsewhere (Task 3 of the original redesign plan added this to `App.tsx`'s loading skeletons) and match it exactly in Step 3 below — view that file before implementing if the aria label differs from `'Loading'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/components/ProjectDetailPage.test.tsx`
Expected: FAIL — module `./ProjectDetailPage` does not exist.

- [ ] **Step 3: Implement the component**

Create `src/renderer/components/ProjectDetailPage.tsx`:

```tsx
import { useProjectDetail } from '../hooks/useProjectDetail';
import { SummaryCards } from './SummaryCards';
import { ConversationsTable } from './ConversationsTable';
import { Skeleton } from './ui/skeleton';
import type { UsageFilters } from '../../shared/types';

interface ProjectDetailPageProps {
  project: string;
  filters: UsageFilters;
  onBack: () => void;
}

export function ProjectDetailPage({ project, filters, onBack }: ProjectDetailPageProps) {
  const { data, loading, error } = useProjectDetail(project, filters);

  return (
    <div className="project-detail-page flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          ← Back
        </button>
        <h2 className="text-xl font-semibold text-foreground">{project}</h2>
      </div>

      {error && !data && (
        <p className="text-sm text-muted-foreground">Couldn't load details for this project.</p>
      )}

      {error && data && (
        <p className="refresh-notice rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          Couldn't refresh — showing last known data.
        </p>
      )}

      {loading && !data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {data && (
        <>
          <SummaryCards totals={data.totals} />
          <ConversationsTable conversations={data.conversations} />
        </>
      )}
    </div>
  );
}
```

Match `Skeleton`'s actual `role`/`aria-label` from `src/renderer/components/ui/skeleton.tsx` — if it doesn't already render `role="status" aria-label="Loading"` itself, that attribution comes from wherever `App.tsx` applies it today; check `App.tsx`'s existing skeleton block (already using bare `<Skeleton className="h-24 w-full" />` without extra ARIA props per the earlier view of `App.tsx` in this plan's research) and `src/renderer/components/ui/skeleton.tsx` directly — if the ARIA attributes live inside `Skeleton` itself, no changes needed; if they don't exist at all yet, this test's assumption (`getAllByRole('status', { name: 'Loading' })`) is inherited from the pre-existing `App.test.tsx` test of the same name, which already passes today, so `Skeleton` must already implement this — reuse it as-is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/components/ProjectDetailPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ProjectDetailPage.tsx src/renderer/components/ProjectDetailPage.test.tsx
git commit -m "feat: add ProjectDetailPage component"
```

---

### Task 8: Wire navigation into `App.tsx`

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

**Interfaces:**
- Consumes: `ProjectDetailPage` from Task 7 (`./components/ProjectDetailPage`); `onBarClick` prop on `BreakdownChart` from Task 5.
- Produces: end-to-end navigation behavior — no further tasks depend on this one.

- [ ] **Step 1: Write the failing tests**

Add to `src/renderer/App.test.tsx` (the file already defines `options` and `usage` fixtures and mocks `window.api.getFilterOptions`/`getUsage` in `beforeEach` — extend that `beforeEach` to also stub `getProjectDetail`, and add a `projectDetail` fixture near the top alongside `usage`):

```ts
import type { ProjectDetailResult } from '../shared/types';

const projectDetail: ProjectDetailResult = {
  project: 'org/repo-a',
  totals: { aiuCredits: 1.5, tokens: 60, requests: 1 },
  conversations: [
    {
      sessionId: 's1',
      createdAt: '2026-09-01 10:00:00',
      summary: 'Fixed the login bug',
      models: 'claude-sonnet-5',
      aiuCredits: 1.5,
      tokens: 60,
      requests: 1,
    },
  ],
};
```

Update the existing `beforeEach` to add `getProjectDetail: vi.fn().mockResolvedValue(projectDetail)` to the `window.api` object it constructs.

Add new tests:

```ts
it('navigates to the project detail page when a project bar is clicked and back again', async () => {
  const user = userEvent.setup();
  const { container } = render(<App />);
  await screen.findByText('3.00');

  const bar = container.querySelector('.recharts-bar-rectangle') as SVGElement;
  await user.click(bar);

  expect(await screen.findByText('1.50')).toBeInTheDocument();
  expect(screen.getByText('Fixed the login bug')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /back/i }));

  expect(await screen.findByText('3.00')).toBeInTheDocument();
});
```

Use the same selector adjustment note as Task 5 Step 4 if `.recharts-bar-rectangle` doesn't match — inspect the actual rendered markup and use the correct bar element selector; the important behavior is that clicking a bar in the "Credits by project" chart (the first `BreakdownChart` rendered, per `App.tsx`'s current order) triggers navigation.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: FAIL — clicking the bar does nothing, no navigation occurs.

- [ ] **Step 3: Wire up the state toggle**

Modify `src/renderer/App.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useUsageData } from './hooks/useUsageData';
import { EmptyState } from './components/EmptyState';
import { FilterBar } from './components/FilterBar';
import { SummaryCards } from './components/SummaryCards';
import { TimeSeriesChart } from './components/TimeSeriesChart';
import { BreakdownChart } from './components/BreakdownChart';
import { SessionsTable } from './components/SessionsTable';
import { ProjectDetailPage } from './components/ProjectDetailPage';
import { Skeleton } from './components/ui/skeleton';
import type { FilterOptions, UsageFilters } from '../shared/types';

const EMPTY_OPTIONS: FilterOptions = { projects: [], models: [], minDate: null, maxDate: null };

export function App() {
  const [options, setOptions] = useState<FilterOptions>(EMPTY_OPTIONS);
  const [optionsError, setOptionsError] = useState<Error | null>(null);
  const [filters, setFilters] = useState<UsageFilters>({});
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const { data, loading, error } = useUsageData(filters);

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
    <div className="app min-h-screen bg-background px-6 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-foreground">Credits Dashboard</h1>
      <FilterBar options={options} filters={filters} onChange={setFilters} />
      {error && data && (
        <p className="refresh-notice mt-4 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          Couldn't refresh — showing last known data.
        </p>
      )}
      {loading && !data && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {data && selectedProject && (
        <div className="mt-6">
          <ProjectDetailPage
            project={selectedProject}
            filters={filters}
            onBack={() => setSelectedProject(null)}
          />
        </div>
      )}
      {data && !selectedProject && (
        <div className="mt-6 flex flex-col gap-6">
          <SummaryCards totals={data.totals} />
          <TimeSeriesChart data={data.timeSeries} />
          <BreakdownChart
            title="Credits by project"
            data={data.byProject}
            onBarClick={setSelectedProject}
          />
          <BreakdownChart title="Credits by model" data={data.byModel} />
          <SessionsTable rows={data.byProject} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run --exclude "**/.worktrees/**"`
Expected: PASS — all tests across the whole project, old and new.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.tsx src/renderer/App.test.tsx
git commit -m "feat: navigate to project detail page on project bar click"
```

---

### Task 9: Final verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite one more time**

Run: `npx vitest run --exclude "**/.worktrees/**"`
Expected: PASS — every test file green, including all new ones from Tasks 1–8.

- [ ] **Step 2: Manually smoke-test the app**

Run: `npm start` (or the project's existing dev/start script — check `package.json` if unsure), click a bar in "Credits by project", confirm the detail page shows the project name, summary cards, and a conversations table, then click "← Back" and confirm the dashboard reappears with filters intact.

- [ ] **Step 3: Confirm no stray files or unrelated changes**

Run: `git status --short`
Expected: clean working tree (everything already committed task-by-task).
