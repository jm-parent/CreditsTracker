# Credits Dashboard

A local desktop app that shows your GitHub Copilot CLI credit (AIU) and token
consumption, filterable by project, model, and date range. Reads
`~/.copilot/session-store.db` read-only — no network calls, no GitHub
permissions required.

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
