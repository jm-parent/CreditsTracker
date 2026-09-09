# Plan: Weekly Activity Heatmap (in-app)

Design: `docs/superpowers/specs/2026-09-09-weekly-activity-heatmap-design.md`

Branch: `heatmap-daily-activity` (forked from `origin/master`).

Each task is TDD (test first), reviewed, and committed independently.

## Task 1: Shared type + `getWeeklyActivity` in db.ts

- Add `WeeklyActivityPoint` to `src/shared/types.ts`:
  ```ts
  export interface WeeklyActivityPoint {
    /** Day of week, 0 = Sunday .. 6 = Saturday (matches SQLite strftime('%w')). */
    weekday: number;
    /** Hour of day, 0-23. */
    hour: number;
    aiuCredits: number;
  }
  ```
- Add `getWeeklyActivity(db: Database.Database, filters: UsageFilters): WeeklyActivityPoint[]`
  to `src/main/db.ts`, following the exact style of `getUsage`/`getHourlyDetail`:
  reuse `buildWhereClause(filters)`, `FROM assistant_usage_events e JOIN sessions s ON s.id = e.session_id`,
  group by `CAST(strftime('%w', e.created_at, 'localtime') AS INTEGER)` and
  `CAST(strftime('%H', e.created_at, 'localtime') AS INTEGER)`, sum
  `e.total_nano_aiu / 1e9 AS aiuCredits`. Return only non-empty buckets (sparse),
  ordered by weekday then hour.
- Tests in `src/main/db.test.ts` (colocated, same in-memory better-sqlite3 fixture
  pattern already used there):
  - seeds events at known timestamps across different weekdays/hours and asserts
    correct weekday/hour bucketing and summed credits;
  - respects `project` filter;
  - respects `model` filter;
  - respects `from`/`to` filters;
  - returns `[]` for an empty database.

**Verify:** `npm test -- db.test.ts` (or the project's actual test runner invocation for a single file) passes.

## Task 2: IPC handler + preload + window.d.ts

- `src/main/ipc-handlers.ts`: import `getWeeklyActivity`, register
  `ipcMain.handle('get-weekly-activity', (_event, filters: UsageFilters) => getWeeklyActivity(currentDb(), filters ?? {}))`
  right after the `get-hourly-detail` handler.
- `src/preload.ts`: import `WeeklyActivityPoint`, add
  `getWeeklyActivity: (filters: UsageFilters): Promise<WeeklyActivityPoint[]> => ipcRenderer.invoke('get-weekly-activity', filters)`.
- `src/renderer/window.d.ts`: import `WeeklyActivityPoint`, add
  `getWeeklyActivity: (filters: UsageFilters) => Promise<WeeklyActivityPoint[]>;` to `Window.api`.
- No dedicated test file exists for `ipc-handlers.ts`/`preload.ts` currently (verify
  during implementation); if a test file for `ipc-handlers.ts` already exists, add a
  case there asserting the new handler delegates to `getWeeklyActivity`. Otherwise
  this task is verified through Task 3's hook tests (which exercise `window.api.getWeeklyActivity`)
  and a TypeScript compile check.

**Verify:** `npm run typecheck` (or `tsc --noEmit`, whichever the project uses) passes;
existing test suite still green.

## Task 3: `useWeeklyActivity` hook

- Create `src/renderer/hooks/useWeeklyActivity.ts`, modeled directly on
  `useUsageData.ts`: same `POLL_INTERVAL_MS = 5_000`, same `filtersRef` pattern,
  same `{ data, loading, error }` shape, calling `window.api.getWeeklyActivity(filtersRef.current)`.
  `data` type is `WeeklyActivityPoint[] | null`.
- Create `src/renderer/hooks/useWeeklyActivity.test.ts` mirroring
  `useUsageData.test.ts`'s conventions (check that file's exact structure first):
  fetches on mount, refetches when filters change, exposes loading state, propagates
  errors from a rejected `window.api.getWeeklyActivity`.

**Verify:** `npm test -- useWeeklyActivity.test.ts` passes.

## Task 4: `ActivityHeatmapPage` component

- Create `src/renderer/components/ActivityHeatmapPage.tsx`:
  - Props: `{ data: WeeklyActivityPoint[]; loading: boolean; error: Error | null }`
    (match whatever prop shape `DailyConsumptionPage`/`ModelsPage` use for consistency
    — check if they take raw arrays or the full hook result object before finalizing).
  - Expands the sparse `data` into a dense 7x24 matrix (`Array(7).fill(null).map(() => Array(24).fill(0))`),
    filling in `aiuCredits` per `weekday`/`hour`.
  - Computes `maxCredits` across the matrix; each cell's intensity level = `0-4`
    bucket scaled against `maxCredits` (level `0` when `maxCredits === 0` or the
    cell is `0`).
  - Renders a `Card`-wrapped grid: weekday row labels (`Sun`..`Sat`, using
    `weekday` index 0-6), an hour axis labeled every 4 hours, one `<button>` per
    cell with `aria-label` like `"Monday, 14:00: 12.30 credits"` (use
    `Intl.NumberFormat` or existing app number formatting helper if one exists —
    check `SummaryCards.tsx`/`TimeSeriesChart.tsx` for a shared formatter first)
    and a `title` tooltip.
  - Renders a 5-step intensity legend with an `aria-label` describing the scale.
  - Computes busiest and quietest non-zero buckets and renders them as two
    `SummaryCards`-style stat tiles (reuse `SummaryCards.tsx`'s card styling/markup
    conventions, or a small local component if `SummaryCards` isn't easily reusable
    for two arbitrary stats — check its props before deciding).
  - When every bucket is `0`: still render the grid at lowest intensity, plus a
    status message "No credit consumption recorded for the current filters." and
    "No activity" in place of busiest/quietest values.
- Create `src/renderer/components/ActivityHeatmapPage.test.tsx`:
  - renders 7*24 = 168 cell buttons from a fixture;
  - asserts a specific known cell's `aria-label` text;
  - asserts busiest/quietest summary text for a fixture with distinct values;
  - asserts the empty-state message when all buckets are zero.

**Verify:** `npm test -- ActivityHeatmapPage.test.tsx` passes.

## Task 5: Sidebar + App.tsx integration

- `src/renderer/components/Sidebar.tsx`: import `Activity` from `lucide-react`;
  add `'weekly'` to `DashboardTab`; insert
  `{ id: 'weekly', label: 'Weekly activity', icon: Activity }` into `ENTRIES`
  immediately after the `'daily'` entry.
- `src/renderer/App.tsx`: import `useWeeklyActivity` and `ActivityHeatmapPage`;
  call `const weeklyActivity = useWeeklyActivity(filters);` alongside the existing
  `useUsageData`/`useHourlyDetail` calls (unconditional, top-level, matching existing
  pattern); render
  ```tsx
  {data && !selectedProject && activeTab === 'weekly' && (
    <div className="mt-6">
      <ActivityHeatmapPage
        data={weeklyActivity.data ?? []}
        loading={weeklyActivity.loading}
        error={weeklyActivity.error}
      />
    </div>
  )}
  ```
  in the same conditional block group as the `daily`/`projects`/`models` branches.
- If a `Sidebar.test.tsx` exists, add/extend a case asserting the new `weekly`
  entry renders and is selectable. Check for existing `App.test.tsx` coverage of
  tab switching and extend similarly if present.

**Verify:** full `npm test` run passes; manually confirm (via `npm run dev` or
equivalent) the new "Weekly activity" sidebar entry renders the heatmap and
respects filter changes.

## Task 6: Final integration check

- Run the complete test suite once more after all prior tasks are committed.
- Run typecheck/build if the project has one (`npm run build` or `tsc --noEmit`).
- Confirm no leftover references to the abandoned standalone dashboard files
  (`index.html`, `server.js`, `src/activity-data.js`, `src/dashboard.js`, etc.) were
  accidentally introduced on this branch — this branch only ever contained the
  in-app changes above.
- This task is a verification-only checkpoint; no new code changes expected unless
  the checks above surface a regression, in which case fix and re-verify before
  finishing.
