# Credits Dashboard

A local desktop app that shows your GitHub Copilot CLI credit (AIU) and token
consumption, filterable by project, model, and date range. Reads
`~/.copilot/session-store.db` read-only — no network calls, no GitHub
permissions required.

## Features

- **Dashboard overview** — total AIU credits, tokens, and requests at a
  glance, with a stacked bar chart of credits over time broken down by
  project (hover a bar to see the per-project breakdown for that day).
- **Filtering** — filter all charts and stats by project and/or model.
- **Credits by model** — bar chart comparing AIU credit usage across every
  model used (Claude, GPT, etc.).
- **Hourly detail** — click a day in the "Credits over time" chart to open
  an hourly breakdown showing usage trends throughout that day.
- **Raw data table** — a sortable table of every session with date,
  summary, model(s) used, AIU credits, tokens, and request count, for
  drilling into the underlying data.

### Screenshots

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
