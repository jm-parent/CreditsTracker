# Copilot CLI Credits Dashboard — Design

## Purpose

A standalone desktop app (Electron + React) that lets a user track their own GitHub
Copilot CLI credit consumption on their local machine: how many AI credits (AIU) and
tokens they've used, broken down over time, by project, and by model. Distributed as a
self-contained `.zip` that runs on any Windows PC with no prerequisites (no Node.js,
no GitHub admin/billing permissions required).

## Context / Why not the official GitHub API

GitHub exposes billing/premium-request APIs (`/users/{username}/copilot/billing/premium-requests`,
org/enterprise variants), but per-user usage data is restricted to org/enterprise
owners and billing managers. The target user is a standard org member without admin
rights, so the official API is not usable for this project.

Instead, Copilot CLI already records detailed usage locally in
`~/.copilot/session-store.db` (SQLite). Relevant tables:

- `sessions(id, cwd, repository, host_type, branch, summary, created_at, updated_at)`
- `turns(id, session_id, turn_index, user_message, assistant_response, timestamp)`
- `assistant_usage_events(id, session_id, turn_index, model, input_tokens,
  output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
  total_nano_aiu, request_multiplier, duration_ms, created_at, ...)`

`total_nano_aiu` is the internal AI-credit unit (nano-scale); dividing by 1e9 gives
"AIU credits" — the primary metric for this dashboard. Token counts are shown as a
secondary metric. There is no confirmed official conversion from AIU to USD, so no
dollar conversion is attempted; this can be revisited later if GitHub documents it.

## Scope

- Single machine, single user: reads the local `session-store.db` on the PC where the
  app runs. No network calls, no authentication, no multi-machine aggregation.
- Filters: by project (`sessions.repository`/`cwd`), by model
  (`assistant_usage_events.model`), by date range.
- Out of scope (YAGNI, can be revisited): dollar cost estimates, multi-machine/cloud
  aggregation, org-wide views, auto-update mechanism, e2e Electron tests.

## Architecture

Electron app with a React (Vite) renderer:

- **Main process** (Node): opens `session-store.db` read-only via `better-sqlite3`
  (respects WAL mode so it can read safely while Copilot CLI is actively writing).
  Exposes two operations via `ipcMain.handle`:
  - `getFilterOptions()` → distinct projects/models/date bounds for populating filter
    controls.
  - `getUsage(filters)` → aggregated results for the given filters (see Data flow).
- **Preload script**: exposes the above via `contextBridge` as `window.api`, no direct
  Node/fs access leaks into the renderer.
- **Renderer (React)**: dashboard UI, calls `window.api` only — no HTTP server, no
  CORS concerns.
- **Packaging**: `electron-forge` with the ZIP maker, producing a self-contained
  `.zip` (bundles Node + Chromium) that a recipient can extract and run directly.
  `better-sqlite3`'s native module is rebuilt for Electron's ABI as part of the
  packaging step (`electron-rebuild`, handled by electron-forge's built-in workflow).
- **DB path resolution**: `path.join(os.homedir(), '.copilot', 'session-store.db')`.
  If missing, the app shows a friendly empty-state explaining Copilot CLI hasn't been
  used yet on this machine, instead of crashing.

## Components

Renderer (React):

- `FilterBar` — project / model dropdowns + date range picker. Options populated from
  `getFilterOptions()` on mount.
- `SummaryCards` — total AIU credits, total tokens, total requests for the current
  filter selection.
- `TimeSeriesChart` — AIU credits per day over the selected range (line/bar,
  `recharts`).
- `BreakdownChart` (×2) — AIU credits by project, AIU credits by model (bar or pie).
- `SessionsTable` (optional/stretch) — sortable drill-down list of individual
  sessions/turns matching the current filters, for detailed inspection.
- `useUsageData(filters)` hook — calls `window.api.getUsage(filters)`, manages
  loading/error/empty states, and polls every ~15s so the view stays live while the
  user keeps using Copilot CLI in another window.

Main process:

- `db.js` — connection setup + SQL aggregation queries (join `sessions` and
  `assistant_usage_events` on `session_id`, `GROUP BY` day/project/model as needed).
- `ipc-handlers.js` — registers the two `ipcMain.handle` endpoints, validates/sanitizes
  filter input before building SQL.
- `preload.js` — minimal `contextBridge` surface.

## Data flow

1. App start → renderer calls `getFilterOptions()` to populate `FilterBar`.
2. User adjusts filters → renderer calls `getUsage({project, model, from, to})`.
3. Main process runs aggregation query, returns:
   ```json
   {
     "totals": { "aiuCredits": 0, "tokens": 0, "requests": 0 },
     "timeSeries": [{ "date": "2026-09-01", "aiuCredits": 0 }],
     "byProject": [{ "project": "repo-name", "aiuCredits": 0 }],
     "byModel": [{ "model": "claude-sonnet-5", "aiuCredits": 0 }]
   }
   ```
4. Renderer renders `SummaryCards` + charts from this payload.
5. Polling (~15s) re-runs step 2 automatically with the current filters to reflect
   new usage as it's recorded.

## Error handling

- DB file not found at startup → empty-state screen with plain-language instructions
  (no crash).
- Query fails (e.g., transient lock) → silent retry with backoff; keep showing the
  last successful data plus a small non-blocking "couldn't refresh" indicator.
- Query succeeds but returns no rows for the current filters → distinct "no data for
  this selection" empty state (not treated as an error).

## Testing

- **Aggregation logic**: unit tests (Vitest) against an in-memory SQLite database
  seeded with known fixture rows, asserting correct sums/grouping/filtering for
  `getUsage`.
- **React components**: Vitest + React Testing Library for `FilterBar`,
  `SummaryCards`, and chart components, using mocked `window.api` responses.
- E2E Electron tests are out of scope for the initial version (YAGNI); can be added
  later with Playwright if needed.
