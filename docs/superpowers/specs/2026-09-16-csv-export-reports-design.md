# CSV export reports

## Context

Credits Tracker already reads Copilot CLI and Copilot Chat usage into one
read-only, in-memory SQLite database. The renderer can filter the dashboard by
project, model, and date, but it has no workflow for producing a report that
can be shared with a manager or analyzed outside the application.

The feature adds a dedicated export page. It produces two complementary CSV
files for one selected period:

1. an aggregated report with daily, project, and model dimensions;
2. a session-level report with one row per conversation.

The exported session report may contain the existing session summary, but it
must never contain prompt or response content.

## Goals

- Add a dedicated **CSV export** navigation entry and page.
- Let users independently select a project, model, and inclusive date range.
- Provide period shortcuts for the last seven days, the current month, the
  previous month, and all available data.
- Show an overview before exporting: total credits, tokens, requests, session
  count, model distribution, and daily consumption.
- Write two CSV files from one export action through an Electron
  **Save As** dialog.
- Keep the export consistent with the merged CLI + Copilot Chat data source.
- Include percentages and repeated totals that make the aggregated file useful
  in Excel, a pivot table, or another reporting tool.
- Keep file-system access and CSV generation in the main process.
- Preserve privacy by excluding prompts and responses.

## Non-goals

- Scheduled or recurring exports.
- E-mail delivery or automatic upload.
- Comparing two periods in the first version.
- Budget thresholds, alerts, or monetary cost estimation.
- Adding date filters to the existing dashboard tabs.
- Exporting arbitrary raw database tables as part of this workflow.

## User experience

### Navigation

`DashboardTab` gains an `export` value. `Sidebar` adds a **CSV export** entry
with a download-oriented `lucide-react` icon. Navigating to or from the page
does not mutate the filters used by the other dashboard tabs.

### Export page

`ExportPage` owns local export-filter state:

- project, with an all-projects option;
- model, with an all-models option;
- inclusive start date;
- inclusive end date;
- the selected period shortcut, when one is active.

The date controls are limited to `FilterOptions.minDate` and
`FilterOptions.maxDate`. The default selection is all available data (no
`from` or `to` constraint), so the page never silently omits historical
usage. Choosing a shortcut replaces the date range. The custom date controls
clear the shortcut when the user edits either date.

The page reports an invalid range when both dates are present and the start is
after the end. It does not request a preview or allow an export while the
range is invalid.

The preview contains:

- cards for AIU credits, tokens, requests, and sessions;
- a model table with credits and percentage of selected-period credits;
- a daily table with date, credits, tokens, and requests;
- a clear empty state when the filters select no usage.

The **Export 2 CSV files** button is disabled while the filter set is invalid,
the preview is loading, or the preview has failed. A failed preview shows a
recoverable error and logs the failure through the existing renderer logger.

### Save flow

The renderer invokes the main-process export operation with the validated
filters. The main process opens an Electron `Save As` dialog with a CSV
filter. The chosen path is treated as a base name:

- `report.csv` becomes `report-summary.csv` and `report-sessions.csv`;
- a name without `.csv` receives the same two suffixes and `.csv` extension.

If either derived file already exists, the main process asks for explicit
overwrite confirmation before writing. Cancelling either the save dialog or
the overwrite confirmation is a normal cancelled result, not an error.

After success, the page displays both created paths and the row counts. A
write failure is surfaced as an error and logged; it must not be converted to a
success-shaped response.

## Data contract

### Shared filters and preview

The export reuses `UsageFilters`:

```ts
interface UsageFilters {
  project?: string;
  model?: string;
  from?: string; // inclusive YYYY-MM-DD
  to?: string;   // inclusive YYYY-MM-DD
}
```

The new preview contract contains:

```ts
interface ExportPreview {
  totals: UsageTotals;
  sessionCount: number;
  activeDays: number;
  byModel: ExportModelPreviewRow[];
  daily: ExportDailyPreviewRow[];
}

interface ExportModelPreviewRow {
  model: string;
  aiuCredits: number;
  sharePercent: number;
}

interface ExportDailyPreviewRow {
  date: string;
  aiuCredits: number;
  tokens: number;
  requests: number;
}
```

The export request carries the filters and an optional suggested base name.
The result carries `cancelled`, the two paths when successful, and the number
of rows written to each file.

### Aggregated CSV

The summary CSV uses one row per `(date, project, model)` combination. Its
columns are:

```text
date
project
model
aiu_credits
input_tokens
output_tokens
tokens
requests
day_total_aiu_credits
model_total_aiu_credits
model_share_percent
project_total_aiu_credits
project_share_percent
```

`requests` is the number of usage events in the group. Token columns are
summed independently and also exposed as a combined `tokens` value.

The percentage denominators are the selected-period total:

- `model_share_percent` is the model total divided by period total;
- `project_share_percent` is the project total divided by period total.

`day_total_aiu_credits` is repeated for each row on that date. The report
does not add a row for a missing day. When the selected-period total is zero,
all percentage fields are `0`.

Events without a repository or working directory use `Unassigned` for the
project column. The date grouping and inclusive filtering use the same
timestamp interpretation as the existing dashboard SQL so exported totals
remain comparable with the on-screen totals.

### Session CSV

The sessions CSV uses one row per session:

```text
session_id
created_at
date
project
summary
models
aiu_credits
input_tokens
output_tokens
tokens
requests
```

`models` is a stable, sorted, delimiter-separated list of distinct models
used by the session. `summary` is the existing session summary or an empty
CSV value. Prompt and response fields are not selected by the query.

### CSV encoding

Both files are UTF-8 with a BOM, use `;` as the delimiter for direct opening
in French Excel installations, and quote fields according to CSV rules when
they contain the delimiter, a quote, or a line break. Numeric values use a
period as the decimal separator so they remain machine-readable.

## Architecture and data flow

1. `ExportPage` loads the existing `FilterOptions` and keeps its filter state
   local to the page.
2. A new renderer hook requests an export preview for valid filters.
3. A new main-process database function builds the preview and export rows
   from the current merged database. It reuses the existing filter-clause
   conventions and applies the project/model/date predicates to both data
   sets.
4. `ipc-handlers.ts` registers:
   - a preview channel that returns `ExportPreview`;
   - an export channel that opens the save dialog, fetches the report rows,
     serializes the two CSVs, confirms overwrites, and writes the files.
5. `preload.ts` and `src/renderer/window.d.ts` expose the typed operations.
6. A pure CSV serializer handles headers, delimiters, quoting, BOM, and
   numeric formatting. The main-process write path owns only file-system and
   dialog concerns.

The report extraction is shared between preview and export so that the
displayed totals and generated files use the same filter and aggregation
logic. The main process performs validation as a second boundary; renderer
validation is only a user-experience optimization.

## Error handling

- Missing or invalid dates produce a typed validation error.
- A missing source database follows the existing merged-database behavior and
  returns an empty preview/report rather than reading another location.
- Preview failures retain no stale success state and are logged with the
  existing logger.
- Save-dialog cancellation returns `{ cancelled: true }`.
- Existing output files require explicit confirmation.
- File-system or serialization failures are thrown through IPC, logged by the
  existing `handle` wrapper, and rendered as an actionable error.
- If writing both output files cannot complete, the result is not reported as
  successful. Temporary artifacts, if used by the implementation, are cleaned
  up only at their explicitly resolved paths.

## Testing

### Main process and shared logic

- Aggregation by date, project, and model.
- Inclusive `from`/`to` filtering and project/model filtering.
- Correct totals and percentages, including zero-credit and empty results.
- `Unassigned` project handling.
- Session grouping, input/output/combined token totals, request counts, and
  stable multi-model lists.
- CSV quoting for semicolons, quotes, and line breaks.
- UTF-8 BOM, headers, decimal formatting, and row counts.
- IPC registration, dialog cancellation, overwrite confirmation, successful
  writes, and surfaced write failures.

### Renderer

- Sidebar navigation to the export page without changing dashboard filters.
- Period shortcut calculations and custom-date validation.
- Preview loading, empty state, failure state, and model percentages.
- Export button disabled states and success paths/row counts.

## Future use cases

The first version deliberately leaves several useful workflows outside scope:

- monthly chargeback reports by repository or team;
- period-over-period comparisons for a manager presentation;
- budgets and alerts when a project exceeds a credit target;
- scheduled exports to a shared folder;
- anomaly detection for unusually expensive days;
- model-efficiency recommendations based on credits per request or token.

The aggregated report contract keeps these additions possible without
changing the session-level privacy boundary.
