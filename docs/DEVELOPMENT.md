# Developer guide

Technical reference for working on Credits Dashboard. For a feature overview
and screenshots, see the [main README](../README.md).

## Stack

- **Electron** app, built with **Electron Forge** + **Vite** (`vite.main.config.ts`,
  `vite.preload.config.ts`, `vite.renderer.config.ts`).
- **Renderer**: React 19 + TypeScript, styled with Tailwind CSS v4, charts via
  Recharts.
- **Main process**: reads a local SQLite database (`better-sqlite3`) and
  exposes data to the renderer over IPC. No network calls, no GitHub API
  usage.
- **Tests**: Vitest + Testing Library, run against both main- and
  renderer-process code.

## Project layout

```
src/
  main/            Electron main process
    db.ts             SQLite queries + in-memory "merged database" builder
    ipc-handlers.ts    Registers all renderer-facing IPC channels
    vscode-chat-store.ts  Reads VS Code Copilot Chat JSONL logs
  preload.ts        contextBridge API exposed to the renderer as `window.api`
  renderer/         React app
    App.tsx            Top-level layout: sidebar + active tab routing
    components/         Sidebar, per-tab pages, charts, tables
    hooks/               useUsageData, useHourlyDetail, etc.
    lib/                 Formatting/color helpers
  shared/types.ts   Types shared between main and renderer (IPC payloads)
```

## Getting started

```
npm install
npm start
```

`npm start` opens the app in a dev window with hot reload (Vite HMR for the
renderer, restart-on-change for the main process).

> **Windows native module note:** `better-sqlite3` ships prebuilt binaries
> under `node_modules/better-sqlite3/prebuilds/`. If `npm install` tries to
> rebuild it from source and fails because `node-gyp` can't find Python/Visual
> Studio, use `npm ci --ignore-scripts` instead — this is safe here and is
> exactly what CI does (see [CI/CD](#cicd-workflows) below).

## Tests

```
npm test
```

Vitest runs every `*.test.ts`/`*.test.tsx` file under `src/`, covering both
main-process logic (SQLite queries, IPC handlers, VS Code log parsing) and
renderer components/hooks.

## Building the Windows installer bundle

```
npm run make
```

Produces the Squirrel Windows release artifacts under
`out/make/squirrel.windows/x64/`, including `Setup.exe`, the `.nupkg`, and
`RELEASES`.

## Architecture notes

### Data sources and the "merged database"

The app's single source of truth for the renderer is an **in-memory SQLite
database** built by `buildMergedDatabase()` in `src/main/db.ts`. It combines:

1. **Copilot CLI usage** — read directly from `~/.copilot/session-store.db`
   (the real on-disk database Copilot CLI maintains), opened read-only.
2. **Copilot Chat usage** (optional) — parsed from VS Code's
   `User/workspaceStorage/*/chatSessions/*.jsonl` append-only logs by
   `vscode-chat-store.ts`, which replays the incremental JSON patches VS Code
   writes to recover per-request token/credit costs.

Both are normalized into the same `sessions` / `assistant_usage_events`
schema and copied into a single in-memory `:memory:` SQLite database, so all
query functions (`getUsage`, `getFilterOptions`, `getProjectDetail`, ...) only
ever need to know about one schema.

### Live refresh

`registerIpcHandlers()` (`src/main/ipc-handlers.ts`) rebuilds the merged
database **at most once every 5 seconds** (`DB_REFRESH_INTERVAL_MS`), lazily,
right before serving the next IPC request — not on a fixed background timer.
This means:

- Usage recorded moments ago (a Copilot CLI action, a finished Chat request)
  shows up in the renderer within roughly one refresh interval, without
  restarting the app.
- Rebuild cost is bounded: rapid bursts of IPC calls within the same 5s
  window all reuse the same cached in-memory database.

On the renderer side, `useUsageData` (`src/renderer/hooks/useUsageData.ts`)
polls `get-usage` every 5 seconds (`POLL_INTERVAL_MS`) to match. If you change
one interval, change the other so the two stay aligned — polling faster than
the backend refresh interval just repeats stale reads; polling slower adds
unnecessary latency on top of the backend's refresh.

### IPC surface

All renderer ↔ main communication goes through `contextBridge` in
`src/preload.ts`, exposed as `window.api`. Channels registered in
`ipc-handlers.ts`:

| Channel               | Purpose                                            |
| --------------------- | --------------------------------------------------- |
| `get-filter-options`  | Distinct projects/models + min/max date, for `FilterBar` |
| `get-usage`           | Totals + time series + by-project/by-model breakdowns |
| `get-project-detail`  | Per-project totals, time series, and conversation list |
| `get-raw-table-page`  | Paginated raw `sessions`/`assistant_usage_events` rows |
| `get-hourly-detail`   | Hour-by-hour breakdown for a single date             |

### Sidebar navigation

`App.tsx` holds `activeTab: DashboardTab` (`'daily' | 'projects' | 'models' |
'raw'`) and routes to one of `DailyConsumptionPage`, `ProjectsPage`,
`ModelsPage`, or `RawDataPage`. Switching tabs clears any open overlay
(`selectedProject` project-detail drill-down, `selectedDate` hourly panel).
`FilterBar` is shared across the three stats tabs and hidden on `raw`.

## CI/CD workflows

- **`.github/workflows/ci.yml`** — runs `npm test` on every push/PR.
- **`.github/workflows/release.yml`** — on every push to `master` (or manual
  dispatch from the Actions tab), runs semantic-release, which bumps the
  version, generates `CHANGELOG.md`, builds the Windows Squirrel installer
  bundle (`npm run make`), tags the commit, and publishes a GitHub Release
  with `Setup.exe`, the `.nupkg`, and `RELEASES` attached.
- Both workflows run on `windows-latest` with **Node 24**, which must match
  the Node version used locally (`better-sqlite3` ships version-specific
  prebuilt binaries).
- Dependency install uses `npm ci --ignore-scripts` for the reason noted
  above — don't remove that flag without re-validating both workflows still
  work end to end.
- `git+ssh://` URLs (from transitive git dependencies like
  `electron/node-gyp`) are rewritten to `https://` before `npm ci`, since
  GitHub-hosted runners have no SSH key configured.

### Releases and commit conventions

Versioning and GitHub Releases are fully automated with
[semantic-release](https://semantic-release.gitbook.io/), driven by
[Conventional Commits](https://www.conventionalcommits.org/) on `master`:

- `fix: ...` → patch release (1.0.0 → 1.0.1)
- `feat: ...` → minor release (1.0.0 → 1.1.0)
- `feat!: ...` or a commit body containing `BREAKING CHANGE:` → major release
  (1.0.0 → 2.0.0)
- Other prefixes (`chore:`, `docs:`, `refactor:`, `test:`, `ci:`, `style:`)
  don't trigger a release

Every conventional-commit-formatted push to `master` therefore ships a new
release automatically — there's no manual release step. Config lives in
`.releaserc.json`.

To preview what the next release would look like without publishing
anything:

```
npm run release:dry-run
```

### App updates

`src/main/updater.ts` owns the whole update flow, and it is **user-driven**:
the app never downloads or installs anything on its own.

- **Checking** — on startup and then every 4 hours, the main process issues a
  single `GET` to `https://update.electronjs.org/jm-parent/CreditsTracker/<platform>-<arch>/<version>`.
  A `204` means the running version is the latest; a JSON body means a newer
  release exists. This endpoint only *reports* availability, which is why
  `autoUpdater.checkForUpdates()` is deliberately not used for this step — it
  would immediately download and stage whatever it finds.
- **Notifying** — every state transition is pushed to the renderer over the
  `update-state-changed` channel. `useAppUpdate` mirrors it, the sidebar shows
  a badge next to the version number, and `UpdateDialog` renders the details.
- **Downloading** — only when the user clicks "Download and install" does the
  renderer call `download-update`, which points Electron's built-in
  `autoUpdater` at the same feed and lets Squirrel fetch and stage the
  installer. Squirrel reports no byte-level progress, so the dialog shows an
  indeterminate progress bar rather than a percentage.
- **Applying** — once Squirrel emits `update-downloaded`, the dialog offers
  "Restart now", which calls `autoUpdater.quitAndInstall()`.

Updates require a packaged Windows (or macOS) build with a Squirrel
installer, so `npm start` reports the `unsupported` status and the sidebar
badge never appears in development.

## Data source details

The app reads `~/.copilot/session-store.db` read-only. If that file doesn't
exist on a machine, the app shows an empty-state message instead of failing.
See [Live refresh](#live-refresh) above for how updates to that file (and to
VS Code's chat logs) propagate to the UI.
