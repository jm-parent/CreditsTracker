# Weekly Activity Heatmap Design

## Goal

Add a new dashboard page that visualizes Copilot CLI credit consumption as a
7 (weekday) x 24 (hour) heatmap, so users can see when their usage is
concentrated during the week. This replaces the earlier standalone
prototype: the feature is now built directly into the existing Electron/
React CreditsTracker application, on top of `master`.

## Selected Approach

Follow the application's existing layered pattern exactly:
`src/main/db.ts` (SQL query) -> `src/main/ipc-handlers.ts` (IPC channel) ->
`src/preload.ts` / `src/renderer/window.d.ts` (typed bridge) ->
`src/renderer/hooks/useWeeklyActivity.ts` (data hook) ->
`src/renderer/components/ActivityHeatmapPage.tsx` (page component), wired
into `Sidebar.tsx` and `App.tsx` like the other tabs (`daily`, `projects`,
`models`, `raw`).

This approach is preferred over a standalone/static implementation because
the feature must read the same SQLite session/usage database as the rest of
the app and honor the same project/model/date filters already available in
the UI.

## Data Flow

`getWeeklyActivity(db, filters: UsageFilters): WeeklyActivityPoint[]` runs a
single grouped query over `assistant_usage_events` joined with `sessions`,
reusing `buildWhereClause` for the `project`/`model`/`from`/`to` filters
already supported elsewhere. It groups by
`strftime('%w', e.created_at, 'localtime')` (weekday, `0` = Sunday) and
`strftime('%H', e.created_at, 'localtime')` (hour, `00`-`23`), summing
`e.total_nano_aiu / 1e9` into `aiuCredits`. The result is a sparse array of
`{ weekday: number, hour: number, aiuCredits: number }` entries (only
buckets with at least one event), matching the existing sparse style used
by `byProject`/`byModel`/`timeSeriesByProjectRows`.

The renderer hook `useWeeklyActivity(filters)` calls
`window.api.getWeeklyActivity(filters)` on an interval, mirroring
`useUsageData`'s 5-second poll so the heatmap picks up new usage without a
restart. `ActivityHeatmapPage` expands the sparse array into a dense 7x24
matrix (all buckets default to `0` credits), computes each cell's intensity
level (`0`-`4`, scaled against the matrix's maximum), and derives the
busiest and quietest non-zero buckets for the summary cards.

## IPC and Types

Add to `src/shared/types.ts`:

```ts
export interface WeeklyActivityPoint {
  /** Day of week, 0 = Sunday .. 6 = Saturday (matches SQLite strftime('%w')). */
  weekday: number;
  /** Hour of day, 0-23. */
  hour: number;
  aiuCredits: number;
}
```

Add `get-weekly-activity` to `ipc-handlers.ts` (delegates to
`getWeeklyActivity(currentDb(), filters ?? {})`), `preload.ts`
(`getWeeklyActivity: (filters) => ipcRenderer.invoke('get-weekly-activity', filters)`),
and `window.d.ts` (`getWeeklyActivity: (filters: UsageFilters) => Promise<WeeklyActivityPoint[]>`).

## UI Integration

- `Sidebar.tsx`: add `'weekly'` to `DashboardTab`, and a new entry
  `{ id: 'weekly', label: 'Weekly activity', icon: Activity }` (lucide-react's
  `Activity` icon) positioned immediately after the `daily` entry.
- `App.tsx`: call `useWeeklyActivity(filters)` alongside the existing
  `useUsageData(filters)` call so the same `FilterBar` (project/model/date)
  already rendered above every tab applies to this page too. Render
  `ActivityHeatmapPage` when `data && !selectedProject && activeTab === 'weekly'`,
  passing the hook's `data`, `loading`, and `error`.
- `ActivityHeatmapPage.tsx`: renders a `Card`-wrapped 7x24 grid (weekday row
  labels, hour column markers every 4 hours, one button per cell), a
  five-step intensity legend, and two `SummaryCards`-style stat tiles
  (busiest / quietest window). Colors use the app's existing theme tokens
  (`--color-primary`, `--color-accent`, `--color-muted`) via Tailwind
  arbitrary-value opacity utilities, not a new hardcoded palette.

## Behavior and Error Handling

- **Loading:** while the hook's first fetch is in flight, render existing
  `Skeleton` placeholders (matching the pattern already used for the
  `daily` tab's initial load in `App.tsx`).
- **Empty:** when every bucket is `0` (no usage recorded, or filters exclude
  all data), the grid still renders at the lowest intensity, and a status
  message reads "No credit consumption recorded for the current filters."
  Busiest/quietest cards show "No activity" instead of a time.
- **Error:** if `window.api.getWeeklyActivity` rejects, `useWeeklyActivity`
  surfaces the error the same way `useUsageData` does; `App.tsx`'s existing
  top-level error handling (falls back to last known data, or the app-wide
  `EmptyState` if there is no data at all) covers this without new
  page-specific error UI.

## Accessibility

Every heatmap cell is a `<button>` with an `aria-label` of the form
`"Monday, 14:00: 12.30 credits"`, so screen reader users get the same
information sighted users read from position and color. The legend has an
`aria-label` describing the intensity scale. Cells remain keyboard
focusable with the app's existing focus-visible styling.

## Testing

- `src/main/db.test.ts`: add cases for `getWeeklyActivity` covering
  aggregation into the correct weekday/hour bucket, respecting each filter
  (`project`, `model`, `from`, `to`), and an empty database.
- `src/renderer/hooks/useWeeklyActivity.test.ts`: mirrors
  `useUsageData.test.ts`'s conventions — fetch on mount, refetch on filter
  change, error propagation.
- `src/renderer/components/ActivityHeatmapPage.test.tsx`: renders the 7x24
  grid from a fixture, asserts cell count, a specific cell's accessible
  label, the busiest/quietest summary text, and the empty-state message
  when all buckets are zero.
