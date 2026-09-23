# Feature Specification: Daily Consumption and Hourly Detail

**Feature Branch**: Not applicable — baseline contract for an existing feature

**Created**: 2026-09-23

**Status**: Baseline — current behavior

**Input**: Existing Credits Dashboard behavior verified against the repository
documentation, implementation, and tests.

## User Scenarios & Testing

### User Story 1 — Review daily usage (Priority: P1)

As a user, I can see an at-a-glance summary and daily credit chart for the
current project and model filters.

**Why this priority**: The daily view is the dashboard's default overview.

**Independent Test**: Load usage data and verify that the summary and chart
represent the same active filter selection.

**Acceptance Scenarios**:

1. **Given** usage is available, **When** I open Daily consumption, **Then**
   the summary shows AIU credits, tokens, and requests.
2. **Given** usage exists on multiple dates, **When** I inspect the chart,
   **Then** daily credit totals are shown as stacked project contributions.
3. **Given** I hover a chart bar, **When** its tooltip appears, **Then** it
   shows the per-project breakdown for that day.

### User Story 2 — Inspect a selected day by hour (Priority: P2)

As a user, I can open an hourly breakdown for a day to understand when its
usage occurred.

**Why this priority**: Hourly detail provides a drill-down from the daily
overview without changing the selected usage context.

**Independent Test**: Select a chart day and verify that an hourly detail
dialog for that date is displayed.

**Acceptance Scenarios**:

1. **Given** the daily chart has data, **When** I select a day, **Then** an
   hourly detail dialog shows the selected date and hourly project usage.
2. **Given** the selected day has no hourly results, **When** the dialog
   loads, **Then** it shows the empty state.
3. **Given** the dialog is open, **When** I close it or switch dashboard
   pages, **Then** the dialog is dismissed.

### Edge Cases

- With no matching rows, the daily chart shows its no-data state.
- If refresh fails after a successful load, the last known usage stays visible
  with a refresh notice.
- If hourly detail cannot be loaded, the dialog reports that it could not load.

## Requirements

### Functional Requirements

- **FR-001**: The daily summary MUST show total AIU credits, tokens, and
  requests for the active shared filters.
- **FR-002**: The daily chart MUST show credit totals over time, stacked by
  project when project contributions are available.
- **FR-003**: The chart tooltip MUST expose each project's contribution for
  the hovered date.
- **FR-004**: Selecting a chart day MUST open an hourly detail view for that
  date using the active usage filters.
- **FR-005**: The hourly detail view MUST allow dismissal and show loading,
  error, and empty-data states.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A user can identify the active selection's AIU credits, tokens,
  and requests from the daily summary.
- **SC-002**: A user can map a daily chart total to its displayed project
  contributions.
- **SC-003**: Selecting a date opens hourly results for that date, or a
  visible loading, error, or empty state.

## Assumptions

- Credit-change animations are specified separately in
  [013 — Credit change indicators](../013-credit-change-indicators/spec.md).
- The app retains its current daily query and refresh behavior.

## Evidence

- `README.md` — Daily consumption feature description.
- `docs/DEVELOPMENT.md` — shared filters and live refresh.
- `src/renderer/components/DailyConsumptionPage.tsx`,
  `src/renderer/components/TimeSeriesChart.tsx`,
  `src/renderer/components/HourlyDetailPanel.tsx`,
  `src/renderer/hooks/useHourlyDetail.ts`.
- `src/renderer/components/DailyConsumptionPage.test.tsx`,
  `src/renderer/components/TimeSeriesChart.test.tsx`,
  `src/renderer/components/HourlyDetailPanel.test.tsx`.
