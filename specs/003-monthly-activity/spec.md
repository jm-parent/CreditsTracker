# Feature Specification: Monthly Activity

**Feature Branch**: Not applicable — baseline contract for an existing feature

**Created**: 2026-09-23

**Status**: Baseline — current behavior

**Input**: Existing Credits Dashboard behavior verified against the repository
documentation, implementation, and tests.

## User Scenarios & Testing

### User Story 1 — Scan activity across a month (Priority: P1)

As a user, I can view a calendar heatmap of activity for a month and move
between months to spot active and quiet periods.

**Why this priority**: The calendar gives a compact overview of when filtered
usage occurred.

**Independent Test**: Open Monthly activity and verify the selected month,
heatmap, summary days, and month-navigation controls.

**Acceptance Scenarios**:

1. **Given** the page opens, **When** monthly data is available, **Then** a
   calendar heatmap and busiest/quietest active-day summaries are displayed.
2. **Given** I select a previous or next month, **When** the selection
   changes, **Then** the heatmap and summaries represent that month.
3. **Given** project or model filters are active, **When** monthly activity
   loads, **Then** the heatmap reflects those filters.

### Edge Cases

- A month with no active days shows “No activity” summaries and the existing
  empty heatmap state.
- A refresh error after data was loaded retains the last known heatmap data
  and displays a refresh notice.

## Requirements

### Functional Requirements

- **FR-001**: The page MUST show a calendar heatmap for one selected month.
- **FR-002**: The page MUST provide previous-month and next-month controls.
- **FR-003**: The page MUST show the busiest active day and the quietest
  active day when activity exists.
- **FR-004**: Monthly activity MUST respect the shared project, project-path,
  and model filters.
- **FR-005**: The page MUST distinguish a month with no activity from a
  populated month.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Selecting a month displays activity values for that month only.
- **SC-002**: Changing a shared usage filter changes the monthly result to
  match the selected filter.
- **SC-003**: A month with no activity is clearly distinguishable from a
  month with usage.

## Assumptions

- The selected month defaults to the current month when the application
  starts.
- Project and model filters are shared with the usage dashboard; the
  heatmap does not introduce a separate filter state.

## Evidence

- `README.md` — Monthly activity feature description.
- `src/renderer/components/ActivityHeatmapPage.tsx`,
  `src/renderer/hooks/useMonthlyActivity.ts`, `src/main/db.ts`.
- `src/renderer/components/ActivityHeatmapPage.test.tsx`,
  `src/renderer/hooks/useMonthlyActivity.test.ts`, `src/main/db.test.ts`.
