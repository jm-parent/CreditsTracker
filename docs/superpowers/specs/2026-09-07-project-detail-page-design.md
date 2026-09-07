# Project Detail Page — Design

## Context

The dashboard currently shows aggregated credit usage across all projects: summary
cards, a time series chart, and two breakdown charts ("Credits by project" and
"Credits by model"). There is no way to drill into a single project to see the
individual Copilot CLI conversations (sessions) that make up its usage.

This spec covers adding a project detail page, reached by clicking a bar in the
"Credits by project" chart, showing the list of conversations for that project
and their individual costs.

**Decision context:** the user requested this feature but was unavailable to
answer clarifying questions during brainstorming. The design below was produced
autonomously based on the explicit request ("cliquer sur un projet ... arriver
sur une autre page de détails ... liste des conversations, des coûts de
chacune"), the existing data model, and established conventions in this
codebase. The user should review this spec before implementation proceeds.

## Data model

The underlying Copilot CLI session store already has the data needed, no schema
changes required:

- `sessions(id, cwd, repository, host_type, branch, summary, created_at, updated_at)`
  — one row per conversation.
- `assistant_usage_events(id, session_id, turn_index, model, input_tokens,
  output_tokens, total_nano_aiu, created_at, ...)` — one row per assistant
  response within a conversation, used for cost.

"Conversation" = one row in `sessions`. A project (identified by
`COALESCE(repository, cwd)`, same as existing filtering) can have many sessions.

## Architecture

**No routing library.** The app has exactly two views (dashboard, project
detail); adding a router is unwarranted complexity (YAGNI). `App.tsx` holds
`selectedProject: string | null` in state:

- `null` → render the existing dashboard.
- a project key → render `ProjectDetailPage`, passing the project key and the
  currently active global filters (dates, model).

A "← Back" button on `ProjectDetailPage` calls a callback that resets
`selectedProject` to `null`, returning to the dashboard with filters preserved.

**Navigation is a dashboard-only decision.** Only the "Credits by project" chart
becomes clickable, not "Credits by model" — clicking a model doesn't map to a
single project detail view.

## Components & data flow

### `BreakdownChart` (existing, modified)

Add an optional prop:

```ts
onBarClick?: (key: string) => void;
```

When provided, each `<Bar>` gets an `onClick` handler (recharts passes the data
point on click) that calls `onBarClick(entry.key)`. When not provided, behavior
is unchanged (used as-is for "Credits by model"). Bars get `cursor: pointer`
only when `onBarClick` is set.

### `App.tsx` (modified)

- Add `selectedProject` state.
- Pass `onBarClick={setSelectedProject}` only to the "Credits by project"
  chart instance.
- When `selectedProject` is set, render `<ProjectDetailPage project={selectedProject} filters={filters} onBack={() => setSelectedProject(null)} />` instead of the dashboard body. `FilterBar` and the page header remain visible above it so the user can still see/adjust global filters (dates, model) while drilled in; changing filters re-queries the detail data for the same project.

### `ProjectDetailPage` (new)

Props: `{ project: string; filters: UsageFilters; onBack: () => void }`.

- Calls a new `useProjectDetail(project, filters)` hook (mirrors the existing
  `useUsageData` hook's loading/error/data pattern) which invokes
  `window.api.getProjectDetail({ ...filters, project })`.
- Renders:
  - Header: project name (key) + "← Back" button.
  - `SummaryCards` (reused as-is) fed the detail totals.
  - A conversations table (new `ConversationsTable` component, styled like the
    existing `Table` primitives) with one row per session, columns: Date
    (`created_at`, formatted), Summary (`summary`, falls back to "—" if null),
    Model(s) (distinct models used across the session's events, comma-joined),
    AIU Credits, Tokens, Requests. Default sort: most recent first.
  - Loading skeleton and error/empty states follow the same conventions as the
    main dashboard (`Skeleton`, `EmptyState`-style messaging).

### IPC: `getProjectDetail`

New channel, mirrors `getUsage`:

```ts
// preload.ts
getProjectDetail: (params: UsageFilters & { project: string }) => Promise<ProjectDetailResult>

// ipc-handlers.ts
ipcMain.handle('get-project-detail', (_e, params) => getProjectDetail(db, params));
```

### `db.ts`: `getProjectDetail`

New function, signature: `getProjectDetail(db, filters: UsageFilters & { project: string }): ProjectDetailResult`.

Reuses `buildWhereClause` (the `project` filter already forces
`COALESCE(s.repository, s.cwd) = @project`, so passing `filters.project`
through the existing filter builder is sufficient — no new WHERE logic).

```sql
-- totals: same shape/query as getUsage's totalsRow, scoped by project filter

-- conversations list:
SELECT
  s.id AS sessionId,
  s.created_at AS createdAt,
  s.summary AS summary,
  GROUP_CONCAT(DISTINCT e.model) AS models,
  SUM(e.total_nano_aiu) / 1e9 AS aiuCredits,
  SUM(e.input_tokens + e.output_tokens) AS tokens,
  COUNT(*) AS requests
FROM sessions s
JOIN assistant_usage_events e ON e.session_id = s.id
{whereSql}
GROUP BY s.id
ORDER BY s.created_at DESC
```

### Shared types (`src/shared/types.ts`)

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

`UsageFilters` gains no new fields (project is already a field); the IPC params
type is `UsageFilters & { project: string }` with `project` required for this
call.

## Error handling

Same pattern as the main dashboard: if `getProjectDetail` rejects and no prior
data exists, show an `EmptyState`-style message ("Couldn't load details for
this project."). If it rejects but stale data exists, show the existing
"Couldn't refresh" notice and keep showing stale data.

## Testing

- `db.test.ts`: new tests for `getProjectDetail` — totals correctness, session
  grouping, distinct model concatenation, empty-project case, filter
  interaction (date/model filters narrow the conversation list).
- `ipc-handlers.test.ts`: new test asserting `get-project-detail` channel wires
  through to `getProjectDetail`.
- `BreakdownChart.test.tsx`: new test that clicking a bar calls `onBarClick`
  with the bar's key, and that no click handler is attached when the prop is
  omitted (existing "Credits by model" behavior unchanged).
- `ProjectDetailPage.test.tsx` (new): loading, loaded (table renders rows),
  error/empty states, back button calls `onBack`.
- `App.test.tsx`: clicking a project bar shows the detail page for that
  project; clicking "Back" returns to the dashboard with filters intact.

## Out of scope

- No routing library / URL-based navigation (state toggle is sufficient for
  two views).
- No drill-down from "Credits by model".
- No per-turn detail (i.e., not opening a single conversation to read its
  messages) — only session-level aggregates.
- No independent filter UI on the detail page beyond what already exists
  globally (dates/model filters are shared with the dashboard).
