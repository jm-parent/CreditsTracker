# Feature Specifications

These living specifications describe the current user-visible behavior of
Credits Dashboard. They were documented from the application, existing
documentation, and tests; they are not retroactive implementation plans.

When a feature changes, update its `spec.md` in the same change. For new work,
use the selected feature directory before generating a `plan.md` and
`tasks.md`. Spec Kit selects a feature by directory state, not by Git branch.
See [`docs/SPECKIT.md`](../docs/SPECKIT.md) for setup and workflow guidance.

## Dashboard and Analytics

| Specification | Coverage |
| --- | --- |
| [001 — Dashboard navigation and filters](001-dashboard-navigation-and-filters/spec.md) | Sidebar sections, navigation, dashboard filter behavior, and drill-down dismissal. |
| [002 — Daily consumption and hourly detail](002-daily-consumption-and-hourly-detail/spec.md) | Usage summary, project-stacked daily chart, and selected-day hourly detail. |
| [003 — Monthly activity](003-monthly-activity/spec.md) | Calendar heatmap, month navigation, and busiest/quietest active days. |
| [004 — Project analytics and detail](004-project-analytics-and-detail/spec.md) | Project totals, chart/table, and project drill-down. |
| [005 — Model analytics](005-model-analytics/spec.md) | Per-model totals and share of total usage. |

## Data and Reports

| Specification | Coverage |
| --- | --- |
| [006 — Raw session browser](006-raw-session-browser/spec.md) | Raw session and usage-event tables, page navigation, and empty/error states. |
| [007 — Usage sources, refresh, and privacy](007-usage-sources-refresh-and-privacy/spec.md) | Copilot CLI and VS Code Chat sources, merged usage, refresh behavior, and data boundaries. |
| [008 — HTML report export](008-html-report-export/spec.md) | Independent export filters, period presets, preview, standalone report, and save behavior. |

## Supporting Features

| Specification | Coverage |
| --- | --- |
| [009 — Featured projects](009-featured-projects/spec.md) | Curated catalogue, tag filtering, and user-initiated GitHub links. |
| [010 — Diagnostic logs](010-diagnostic-logs/spec.md) | In-app log filtering, refresh, copy, clear, file access, and diagnostics. |
| [011 — Desktop shortcut onboarding](011-desktop-shortcut-onboarding/spec.md) | Eligibility, prompt, creation, dismissal, and failure behavior. |
| [012 — Opt-in app updates](012-opt-in-app-updates/spec.md) | Availability checks, user-approved download, and restart flow. |
| [013 — Credit change indicators](013-credit-change-indicators/spec.md) | Temporary visual indication of positive and negative credit changes. |
