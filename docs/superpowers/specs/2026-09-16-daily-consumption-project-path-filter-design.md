# Daily consumption project path filter design

## Goal

Make the Daily Consumption view searchable by project path without requiring
an exact selection from the existing project list. The search must keep every
displayed metric consistent with the same filtered usage dataset.

The first delivery is limited to this filter. CSV export and other Daily
Consumption enhancements are out of scope.

## User interface

The global `FilterBar` replaces its `Project` select with a text input labeled
`Project path`. The input searches for a case-insensitive substring in the
effective project path:

- `sessions.repository` when it is present;
- otherwise `sessions.cwd`.

The input updates the active filters on every keystroke. An empty or
whitespace-only value removes the search filter and restores all projects.
The existing model filter remains unchanged. The project-path input is hidden
on the project detail page, just as the project select was hidden there.

The search applies to the complete active dataset, not only to visible chart
segments. Totals, daily bars, project/model breakdowns, hourly detail, and
monthly activity therefore remain mutually consistent. An empty result uses
the existing no-data messages.

## Data flow

`UsageFilters` gains an optional `projectSearch` field. The existing exact
`project` field remains available for project detail requests and is not
replaced.

`FilterBar` sends the normalized search value through `App` without adding a
new IPC method. The following renderer dependencies include
`filters.projectSearch` so a changed search re-fetches the corresponding
data:

- `useUsageData`;
- `useHourlyDetail`;
- `useMonthlyActivity`;
- `useProjectDetail`.

The dashboard animation context key also includes the search value. A change
from one search term to another must not be treated as a live credit update.

The shared database predicate in `src/main/db.ts` applies the search to the
effective project path using a literal substring check:

```sql
instr(lower(COALESCE(s.repository, s.cwd)), lower(@projectSearch)) > 0
```

Using `instr` rather than `LIKE` prevents wildcard characters and Windows
backslashes in a typed path from changing the search semantics. The predicate
is reused by usage totals, daily series, project/model breakdowns, hourly
detail, monthly activity, and project detail queries.

## Error handling and accessibility

The existing request cancellation and last-known-data behavior remain
unchanged. Rapid input changes may start successive requests, but stale
responses must not replace the latest filter's result.

The input has an explicit label, a stable `id`, keyboard support through the
native text control, and a path-oriented placeholder. Clearing the control
must be possible with standard text editing and must visibly restore the
unfiltered state.

## Verification

Targeted tests will cover:

- rendering the project-path input and retaining the model select;
- emitting `projectSearch` on each text change and removing it when empty;
- hiding the project-path input when `showProjectFilter` is false;
- forwarding the search from `App` to `getUsage`;
- case-insensitive partial matching against repository and cwd fallback
  values;
- no-match totals and empty series;
- propagation of the search to hourly, monthly, and project-detail requests;
- changing the animation context when the search changes.

No new export surface or unrelated refactoring will be introduced.
