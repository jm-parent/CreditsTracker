# Credits Dashboard

A local desktop app that shows your GitHub Copilot CLI credit (AIU) and token
consumption, with shared dashboard filters for project and model plus a
dedicated HTML export page for date-range reporting.

🔒 **Privacy-first**: usage data stays on your machine. The app reads
`~/.copilot/session-store.db` read-only and does not send usage records,
prompts, responses, or transcripts to a service. It checks a release feed for
update availability; it downloads nothing until you accept. Featured GitHub
links open externally only when you choose them. No GitHub permissions are
required.

## Download

Grab the latest Windows build from the
[Releases page](https://github.com/jm-parent/CreditsTracker/releases/latest):
download and run `CreditsTracker-<version>-win32-x64-Setup.exe` — no Node.js
required. The release also lists a `.nupkg` file and a `RELEASES` manifest;
those are Squirrel auto-update metadata consumed by the app itself when
checking for updates, not something to download by hand — only the
`Setup.exe` asset is needed to install or upgrade.

## Features

A sidebar lets you switch between eight navigation entries. Usage tabs are
scoped to the current project/model/date filters, while Featured projects is a
static, offline-friendly catalogue and HTML export has its own report filters:

- **Daily consumption** — total AIU credits, tokens, and requests at a
  glance, with a stacked bar chart of credits over time broken down by
  project (hover a bar to see the per-project breakdown for that day).
  Click a day to open an hourly breakdown showing usage trends throughout
  that day.
- **Monthly activity** — a calendar-style heatmap for scanning which days of
  the current month were active, with project/model filtering carried through
  from the main dashboard controls.
- **By project** — per-project totals with a breakdown chart and table;
  click a project's bar to drill into a detail page for that project.
- **By model** — per-model totals with a breakdown chart and a table
  showing AIU credits and each model's "% of total" share of usage.
- **Raw data** — a sortable table of every session with date, summary,
  model(s) used, AIU credits, tokens, and request count, for drilling into
  the underlying data.
- **Export HTML report** — an export workspace with its own project, model,
  and date filters plus period shortcuts for **All dates**, **Last 7 days**,
  **This month**, and **Previous month**. Each export writes a single
  standalone `.html` report with the chosen base name. The report includes the
  existing session summary and session-level detail; prompts and responses are
  never exported.
- **Logs** — the application's own diagnostic log (startup, database access,
  failed IPC calls, and any renderer crash with its stack trace), filterable
  by level and text. Logs are also written to
  `%APPDATA%\credits-tracker\logs\app.log` (rotated at 2 MB), and the page
  offers "Copy", "Open log folder", and "Clear" so a broken screen can be
  reported with the underlying error attached or old diagnostics removed.
- **Featured projects** — a curated, offline-friendly collection of GitHub
  projects with descriptions, tags, and one-click links to open each
  repository in the system browser.

Additional capabilities include:

- **Filtering** — the dashboard views share project/model filters for
  exploration, while the HTML export page provides its own project, model,
  and date-range export filters so report selection does not disturb the
  on-screen dashboard.
- **Live updates** — the dashboard refreshes itself automatically every few
  seconds, so credits from a Copilot CLI (or Copilot Chat) session you just
  finished show up on screen shortly after, without restarting the app.
- **Copilot Chat included** — usage from the GitHub Copilot Chat extension in
  VS Code is merged in alongside Copilot CLI usage, so you get one unified
  view of your Copilot credit consumption.
- **Opt-in app updates** — the app checks GitHub Releases for a newer version
  on startup and every few hours. When one is found, a small download icon
  appears next to the version number in the sidebar; clicking it opens a
  dialog with the release notes. Nothing is ever downloaded or installed
  until you accept, and the new version is applied when you restart the app.

## Screenshots

<!-- TODO: screenshots below still show the pre-sidebar single-page layout; refresh after next UI pass -->

**Dashboard overview**

![Dashboard overview](docs/screenshots/dashboard-overview.png)

**Credits by model**

![Credits by model](docs/screenshots/credits-by-model.png)

**Hourly detail**

![Hourly detail](docs/screenshots/hourly-detail.png)

**Raw data table**

![Raw data table](docs/screenshots/raw-data-table.png)

## For developers

Building, testing, releasing, and a technical overview of how the app works
live in the [developer guide](docs/DEVELOPMENT.md).
