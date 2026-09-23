# Feature Specification: Raw Session Browser

**Feature Branch**: Not applicable — baseline contract for an existing feature

**Created**: 2026-09-23

**Status**: Baseline — current behavior

**Input**: Existing Credits Dashboard behavior verified against the repository
documentation, implementation, and tests.

## User Scenarios & Testing

### User Story 1 — Inspect underlying usage records (Priority: P1)

As a user, I can browse session and usage-event records to understand the data
behind the summary views.

**Why this priority**: Direct access to source records supports investigation
when an aggregate is unexpected.

**Independent Test**: Open Raw data, switch between its tables, and verify that
their rows, columns, and page controls update.

**Acceptance Scenarios**:

1. **Given** the Raw data page opens, **When** session records are available,
   **Then** the session table displays its columns and rows.
2. **Given** I select another raw-data table, **When** its data loads,
   **Then** the selected table is shown and pagination returns to its first
   page.
3. **Given** the selected table has multiple pages, **When** I use page
   navigation, **Then** the corresponding page of rows is displayed.

### Edge Cases

- An empty table shows a no-rows state.
- A failed initial load shows an error message instead of a table.
- Loading placeholders are shown when the first page has not yet loaded.

## Requirements

### Functional Requirements

- **FR-001**: The page MUST allow browsing the available raw session and
  assistant-usage-event tables.
- **FR-002**: The table MUST show the columns and rows returned for the
  selected table.
- **FR-003**: The page MUST paginate raw results and reset to the first page
  when the user changes tables.
- **FR-004**: The page MUST show loading, error, and empty-data states.
- **FR-005**: The page MUST allow returning to Daily consumption.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A user can switch between each available raw table and see its
  returned columns and rows.
- **SC-002**: A user can reach each returned page and sees a clear empty or
  error state when no rows are available.

## Assumptions

- Raw data is an inspection view; it does not expose prompt or response
  transcripts.
- The raw-data page uses its own pagination and does not inherit dashboard
  filters.

## Evidence

- `README.md` — Raw data feature description.
- `docs/DEVELOPMENT.md` — raw-table IPC and pagination.
- `src/renderer/components/RawDataPage.tsx`,
  `src/renderer/hooks/useRawTable.ts`, `src/main/db.ts`.
- `src/renderer/components/RawDataPage.test.tsx`,
  `src/renderer/hooks/useRawTable.test.ts`, `src/main/db.test.ts`.
