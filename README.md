# Credits Dashboard

A local desktop app that shows your GitHub Copilot CLI credit (AIU) and token
consumption, filterable by project, model, and date range. Reads
`~/.copilot/session-store.db` read-only — no network calls, no GitHub
permissions required.

## Features

A sidebar lets you switch between four tabs, each scoped to the current
project/model/date filters:

- **Daily consumption** — total AIU credits, tokens, and requests at a
  glance, with a stacked bar chart of credits over time broken down by
  project (hover a bar to see the per-project breakdown for that day).
  Click a day to open an hourly breakdown showing usage trends throughout
  that day.
- **By project** — per-project totals with a breakdown chart and table;
  click a project's bar to drill into a detail page for that project.
- **By model** — per-model totals with a breakdown chart and a table
  showing AIU credits and each model's "% of total" share of usage.
- **Raw data** — a sortable table of every session with date, summary,
  model(s) used, AIU credits, tokens, and request count, for drilling into
  the underlying data.
- **Filtering** — filter all tabs' charts and stats by project and/or model.
- **Live updates** — the dashboard refreshes itself automatically every few
  seconds, so credits from a Copilot CLI (or Copilot Chat) session you just
  finished show up on screen shortly after, without restarting the app.

### Screenshots

<!-- TODO: screenshots below still show the pre-sidebar single-page layout; refresh after next UI pass -->

**Dashboard overview**

![Dashboard overview](docs/screenshots/dashboard-overview.png)

**Credits by model**

![Credits by model](docs/screenshots/credits-by-model.png)

**Hourly detail**

![Hourly detail](docs/screenshots/hourly-detail.png)

**Raw data table**

![Raw data table](docs/screenshots/raw-data-table.png)

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

## Releases

Versioning and GitHub Releases are fully automated with
[semantic-release](https://semantic-release.gitbook.io/), driven by
[Conventional Commits](https://www.conventionalcommits.org/) on `master`:

- `fix: ...` → patch release (1.0.0 → 1.0.1)
- `feat: ...` → minor release (1.0.0 → 1.1.0)
- `feat!: ...` or a commit body containing `BREAKING CHANGE:` → major release (1.0.0 → 2.0.0)
- Other prefixes (`chore:`, `docs:`, `refactor:`, `test:`, ...) don't trigger a release

Every push to `master` runs the **Release** workflow
(`.github/workflows/release.yml`), which, when a release is warranted:

1. Bumps the version in `package.json` and updates `CHANGELOG.md`.
2. Builds the Windows zip (`npm run make`).
3. Tags the commit and pushes it back to `master`.
4. Publishes a GitHub Release with the zip attached.

The workflow can also be triggered manually from the **Actions** tab
(`Run workflow`) to retry a release without needing a new commit. A separate
**CI** workflow (`.github/workflows/ci.yml`) runs the test suite on every
push and pull request.

To preview what the next release would look like without publishing
anything:

    npm run release:dry-run

## Data source

The app reads `~/.copilot/session-store.db`, the local SQLite database that
Copilot CLI already maintains. If that file doesn't exist on a machine, the
app shows an empty-state message instead of failing.

It also scans VS Code's `User/workspaceStorage` folder (read-only) for
Copilot Chat conversation logs (`chatSessions/*.jsonl`) recorded by the
GitHub Copilot Chat extension, and merges their token/credit usage into the
same dashboard, so CLI and VS Code usage show up side by side — filterable by
project and model just like CLI sessions. If that folder is missing or
unreadable, it's silently skipped and only CLI data is shown.

Both sources are re-read from disk at most once every 5 seconds, and the
dashboard polls for new data on the same cadence, so usage from an
in-progress or just-finished session appears on screen within a few seconds.
