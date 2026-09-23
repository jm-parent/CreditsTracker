# Feature Specification: Project Analytics and Detail

**Feature Branch**: Not applicable — baseline contract for an existing feature

**Created**: 2026-09-23

**Status**: Baseline — current behavior

**Input**: Existing Credits Dashboard behavior verified against the repository
documentation, implementation, and tests.

## User Scenarios & Testing

### User Story 1 — Compare usage by project (Priority: P1)

As a user, I can compare project credit totals and identify the largest
contributor to usage.

**Why this priority**: Project-level comparison helps users understand where
their Copilot activity is occurring.

**Independent Test**: Open By project with multiple projects in the result and
verify the summary, chart, and table agree.

**Acceptance Scenarios**:

1. **Given** project usage is available, **When** I open By project, **Then**
   I see project totals in the chart and table.
2. **Given** one project has the highest credit total, **When** I inspect the
   summary, **Then** that project is identified as the top project.
3. **Given** I select a project in the chart, **When** its detail loads,
   **Then** the detail is scoped to that project.

### User Story 2 — Inspect a project's usage (Priority: P2)

As a user, I can inspect a selected project's totals, daily trend, and
conversation summaries.

**Why this priority**: The drill-down connects aggregate comparison to the
sessions that contributed to a project's usage.

**Independent Test**: Select a project and verify that its name, totals,
timeline, and session-level conversation summaries are shown.

**Acceptance Scenarios**:

1. **Given** a project is selected, **When** its detail page opens, **Then**
   it shows total credits, tokens, requests, a time series, and conversation
   rows for that project.
2. **Given** I change the model filter in project detail, **When** results
   refresh, **Then** all displayed project details use that model filter.
3. **Given** detail is open, **When** I select Back, **Then** I return to the
   project overview.

### Edge Cases

- With no projects in the current selection, the project chart and table use
  their empty state.
- If project detail refresh fails after a successful load, the last known
  details remain visible with a refresh notice.

## Requirements

### Functional Requirements

- **FR-001**: The project overview MUST show project credit totals in a
  breakdown chart and table.
- **FR-002**: The overview MUST identify the top project when at least one
  project is present.
- **FR-003**: Selecting a project MUST open a project-specific detail view.
- **FR-004**: Project detail MUST show total AIU credits, tokens, requests,
  daily credit history, and conversation summaries.
- **FR-005**: Project detail MUST allow filtering by model and returning to
  the overview.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Each project shown in the overview has a corresponding displayed
  total.
- **SC-002**: Selecting a project shows only detail for that selected project.
- **SC-003**: The Back action returns the user to the project overview.

## Assumptions

- Project identity is represented by repository when available, otherwise by
  the local working directory.
- Project detail excludes conversation prompts and responses.

## Evidence

- `README.md` — By project overview.
- `src/renderer/components/ProjectsPage.tsx`,
  `src/renderer/components/ProjectDetailPage.tsx`,
  `src/renderer/components/BreakdownChart.tsx`,
  `src/renderer/components/ConversationsTable.tsx`,
  `src/main/db.ts`.
- `src/renderer/components/ProjectsPage.test.tsx`,
  `src/renderer/components/ProjectDetailPage.test.tsx`,
  `src/main/db.test.ts`.
