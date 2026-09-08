# Sidebar navigation with dedicated stats tabs

## Context

Today the dashboard renders every chart on a single page (`App.tsx`): summary
cards, the daily time-series chart, the "by project" breakdown, the "by
model" breakdown, and a sessions table, all stacked vertically. Navigation to
"Raw data" or a project detail view is done via top-level buttons/clicks that
toggle booleans (`showRawData`, `selectedProject`).

This spec introduces a left sidebar with 4 sections, splitting the current
single page into focused views:

1. **Daily consumption** — cumulative credit consumption per day, across all
   projects.
2. **By project** — total consumption per project.
3. **By model** — total consumption per model used.
4. **Raw data** — existing raw table browser, moved into the sidebar.

## Goals

- Replace the single stacked page with a sidebar-driven navigation between 4
  views.
- Keep the shared `FilterBar` (project/model/date) visible above the content
  on the 3 stats tabs (not on Raw data, matching current behavior).
- Give each stats tab its own `SummaryCards` tailored to that tab's data
  (see "SummaryCards per tab" below).
- Preserve existing drill-down behaviors: clicking a day on the time-series
  opens `HourlyDetailPanel`; clicking a project (bar or table row) opens
  `ProjectDetailPage` as an overlay, independent of the sidebar.
- No backend/IPC changes: all data already available via `useUsageData`
  (`data.totals`, `data.timeSeries`, `data.byProject`, `data.byModel`).

## Non-goals

- No new data sources, no time-series-per-model view (rejected in favor of a
  simpler detailed table, see below).
- No per-tab filter customization — filters stay shared/global across tabs.
- No persistence of the selected tab across app restarts.

## Architecture

### Navigation state

`App.tsx` replaces `showRawData`/implicit "home" state with a single
`activeTab` state:

```ts
type DashboardTab = 'daily' | 'projects' | 'models' | 'raw';
const [activeTab, setActiveTab] = useState<DashboardTab>('daily');
```

`selectedProject` (drill-down into `ProjectDetailPage`) remains a separate
piece of state, since it's an overlay independent of the sidebar tab — it can
be triggered from the "By project" tab and, when active, replaces the main
content area (as it does today) while the sidebar stays visible so the user
can navigate back to another tab (which also clears `selectedProject`).

### Component layout

```
App
 ├─ Sidebar (new)                — fixed left column, 4 nav entries
 └─ main content area
     ├─ FilterBar                — shown for daily/projects/models, hidden for raw
     ├─ DailyConsumptionPage (new)   [activeTab === 'daily' && !selectedProject]
     ├─ ProjectsPage (new)           [activeTab === 'projects' && !selectedProject]
     ├─ ModelsPage (new)             [activeTab === 'models']
     ├─ RawDataPage (existing)       [activeTab === 'raw']
     └─ ProjectDetailPage (existing) [selectedProject set, overlays daily/projects]
     └─ HourlyDetailPanel (existing) [selectedDate set, overlays as today]
```

### New: `Sidebar.tsx`

- Props: `activeTab: DashboardTab`, `onTabChange: (tab: DashboardTab) => void`.
- Renders a vertical list of 4 buttons with `lucide-react` icons (reuse the
  same icon set already imported elsewhere, e.g. `CalendarDays`,
  `FolderKanban`, `Cpu`, `Database`) and labels:
  - "Consommation quotidienne" (`daily`)
  - "Par projet" (`projects`)
  - "Par modèle" (`models`)
  - "Raw data" (`raw`)
- Active tab gets a highlighted style (background/border), consistent with
  existing `border-border`/`bg-muted` Tailwind conventions used in `App.tsx`.
- Selecting a tab always clears `selectedProject` and `selectedDate` (so
  switching tabs never leaves a stale overlay open).

### New: `DailyConsumptionPage.tsx`

- Props: `totals: UsageTotals`, `timeSeries: TimeSeriesPoint[]`,
  `onDayClick: (date: string) => void`.
- Renders `SummaryCards totals={totals}` (unchanged, global totals) +
  `TimeSeriesChart data={timeSeries} onDayClick={onDayClick}`.
- This is a straight extraction of the existing daily-chart portion of
  `App.tsx`; no behavior change.

### New: `ProjectsPage.tsx`

- Props: `byProject: BreakdownPoint[]`, `onProjectClick: (project: string) => void`.
- Computes derived summary values from `byProject`:
  - Number of projects: `byProject.length`
  - Total credits: `sum(byProject.map(p => p.aiuCredits))`
  - Top project: entry with max `aiuCredits` (label + value)
- Renders a `SummaryCards`-compatible totals object built from these values
  (see "SummaryCards per tab" below) + `BreakdownChart title="Credits by
  project" data={byProject} onBarClick={onProjectClick} colorByKey` +
  `SessionsTable rows={byProject}` (both existing components, unchanged).
- Clicking a bar or a table row triggers `onProjectClick`, which sets
  `selectedProject` in `App.tsx` exactly as today.

### New: `ModelsPage.tsx`

- Props: `byModel: BreakdownPoint[]`.
- Computes derived summary values from `byModel` (same pattern as
  `ProjectsPage`: count of models, total credits, top model).
- Renders adapted `SummaryCards` + `BreakdownChart title="Credits by model"
  data={byModel}` (no click handler — no per-model drill-down page exists)
  + new `ModelTable.tsx`.

### New: `ModelTable.tsx`

- Props: `rows: BreakdownPoint[]`.
- Same visual/sort pattern as `SessionsTable` (sortable by credits, colored
  dot per key) but with:
  - Column header "Model" instead of "Project".
  - An additional "% of total" column: `(row.aiuCredits / totalCredits) * 100`,
    formatted to 1 decimal, where `totalCredits = sum(rows.map(r =>
    r.aiuCredits))`.
- Implemented as its own small component (not a generalized/parameterized
  `SessionsTable`) to keep both components simple and independently
  readable, per the decision made during design review.

### SummaryCards per tab

`SummaryCards` currently takes `totals: UsageTotals` (`aiuCredits`, `tokens`,
`requests`). `ProjectsPage`/`ModelsPage` don't have per-project/per-model
token/request counts available from `BreakdownPoint` (which only has `key` +
`aiuCredits`), so we introduce a small presentational variant instead of
forcing incompatible data into `UsageTotals`:

- New optional component `BreakdownSummaryCards.tsx`: takes `{ countLabel:
  string; count: number; totalCredits: number; topLabel: string; topKey:
  string; topCredits: number }` and renders 3 cards: "Projects" (or
  "Models") count, "Total credits", and "Top project/model" (name + its
  credits). Visual style mirrors `SummaryCards` (same `Card` grid).
- `DailyConsumptionPage` keeps using the existing `SummaryCards totals=...}`
  unchanged (global totals still make sense there).

### `App.tsx` changes

- Replace `showRawData` boolean and implicit "home" rendering with
  `activeTab`.
- Render `<Sidebar activeTab={activeTab} onTabChange={...} />` alongside the
  content area whenever data has loaded (sidebar is not shown on the
  error/empty state).
- Keep existing loading/error/empty handling as-is; only the "loaded" branch
  is restructured to route through `activeTab`.
- `selectedProject` overlay logic unchanged in spirit: when set, render
  `ProjectDetailPage` instead of the tab content, but keep the sidebar
  visible (unlike today, where the header/filter bar is hidden while in
  project detail — this is a minor behavior change: previously `!selectedProject`
  hid the header entirely; now the sidebar persists so the user has a
  consistent way back).

## Data flow

No changes to `useUsageData`, `useHourlyDetail`, or any IPC/main-process
code. All new components are purely presentational, deriving their data from
props computed with plain array reduces in the parent page components (or
inline in `App.tsx` if trivial).

## Error handling

Unchanged: the existing top-level error/empty states in `App.tsx` are
unaffected by this restructuring, since they return early before the
sidebar/tab content would render.

## Testing

- `Sidebar.test.tsx`: renders 4 entries, highlights active tab, calls
  `onTabChange` with the right value on click, and verifies clicking a tab
  clears any open overlay state (tested via `App.test.tsx` integration
  instead, since clearing state is an `App`-level concern).
- `DailyConsumptionPage.test.tsx`: renders `SummaryCards` + `TimeSeriesChart`
  with given props; day click bubbles up.
- `ProjectsPage.test.tsx`: renders derived summary values correctly for a
  sample `byProject` array (including edge case: empty array → no crash,
  reasonable empty state); bar/row click bubbles up as project key.
- `ModelsPage.test.tsx`: same pattern for `byModel`.
- `ModelTable.test.tsx`: verifies percentage column values and sorting.
- `BreakdownSummaryCards.test.tsx`: verifies the 3 cards render expected
  values including the "top" entry.
- `App.test.tsx`: update/extend existing navigation tests to cover switching
  between the 4 sidebar tabs and confirm `FilterBar` visibility (hidden only
  on `raw`).

## Open considerations (resolved during design review)

- FilterBar stays shared across all 3 stats tabs (not per-tab) — confirmed.
- Sidebar includes Raw data as its 4th entry — confirmed.
- Model tab gets a detailed table (count/total/% breakdown), not a
  time-series — confirmed, simpler scope preferred.
- SummaryCards content differs per tab; implemented via a new
  `BreakdownSummaryCards` component rather than overloading `SummaryCards`
  with optional/nullable fields.
