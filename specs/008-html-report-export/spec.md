# Feature Specification: HTML Report Export

**Feature Branch**: Not applicable — baseline contract for an existing feature

**Created**: 2026-09-23

**Status**: Baseline — current behavior

**Input**: Existing Credits Dashboard behavior verified against the repository
documentation, implementation, and tests.

## User Scenarios & Testing

### User Story 1 — Select and preview a report (Priority: P1)

As a user, I can select a project, model, and date range and review the report
summary before saving it.

**Why this priority**: A preview lets users confirm the intended scope before
creating a report file.

**Independent Test**: Change each export filter and verify that the preview
reflects the new selection without changing dashboard filters.

**Acceptance Scenarios**:

1. **Given** export data is available, **When** I choose project, model, or
   date filters, **Then** the preview updates for that selection.
2. **Given** I choose All dates, Last 7 days, This month, or Previous month,
   **When** the shortcut is applied, **Then** its date range is reflected in
   the export filters and preview.
3. **Given** the start date is after the end date, **When** the selection is
   evaluated, **Then** a validation message appears and export is unavailable.

### User Story 2 — Save a standalone report (Priority: P1)

As a user, I can save a self-contained HTML report for the selected usage.

**Why this priority**: A saved file provides a portable view of selected
aggregates and session details.

**Independent Test**: Export a non-empty selection and verify the chosen HTML
file contains the selected reporting content and no transcript content.

**Acceptance Scenarios**:

1. **Given** a valid, non-empty selection, **When** I choose Export, **Then**
   a Save As dialog lets me select the report path.
2. **Given** I cancel Save As, **When** the dialog closes, **Then** no report
   file is written.
3. **Given** the selected file already exists, **When** the overwrite warning
   appears, **Then** choosing Cancel preserves the existing file.
4. **Given** I confirm overwriting an existing report, **When** export
   succeeds, **Then** the standalone HTML report is written to that path.

### Edge Cases

- An empty or unavailable preview disables export.
- An invalid date range displays validation feedback.
- A failed preview hides stale preview results until a later successful
  refresh.
- A write failure is reported in the export page without presenting a
  success result.

## Requirements

### Functional Requirements

- **FR-001**: The export page MUST maintain its own project, model, and date
  filters, separate from shared dashboard filters.
- **FR-002**: The page MUST provide All dates, Last 7 days, This month, and
  Previous month date shortcuts.
- **FR-003**: The page MUST preview totals and usage breakdowns for the
  selected export filters.
- **FR-004**: The page MUST reject a start date that falls after the end date.
- **FR-005**: Export MUST be unavailable while the preview is loading, invalid,
  failed, or empty.
- **FR-006**: Export MUST produce a standalone HTML report with no external
  resources.
- **FR-007**: The report MUST include the selected aggregate and session-level
  details, including the existing session summary.
- **FR-008**: The report MUST NOT include prompts, assistant responses, or raw
  conversation transcripts.
- **FR-009**: Save As cancellation MUST leave the filesystem unchanged; an
  existing report MUST require overwrite confirmation.
- **FR-010**: Export failures MUST be shown to the user and MUST NOT appear as
  successful exports.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Each supported export filter changes the preview without
  changing the active dashboard filter selection.
- **SC-002**: A valid non-empty selection produces a single standalone HTML
  file at the path selected by the user.
- **SC-003**: A canceled save or canceled overwrite leaves the selected output
  file unchanged.
- **SC-004**: The generated report contains no prompts, assistant responses,
  or raw transcripts.

## Assumptions

- Period shortcuts use the application's current local-date behavior and
  available data bounds.
- The suggested default report name is `copilot-usage.html`; the user chooses
  the final save location.
- Report session detail remains limited to metadata and the existing summary.

## Evidence

- `README.md` — export filters, period shortcuts, and privacy scope.
- `docs/DEVELOPMENT.md` — independent export state and Save As flow.
- `src/renderer/components/ExportPage.tsx`,
  `src/renderer/components/ExportFilters.tsx`,
  `src/renderer/hooks/useExportPreview.ts`,
  `src/main/html-report.ts`, `src/main/export-files.ts`,
  `src/main/ipc-handlers.ts`.
- `src/main/html-report.test.ts`, `src/main/export-files.test.ts`,
  `src/main/ipc-handlers.test.ts`, `src/renderer/components/ExportPage.test.tsx`,
  `src/renderer/components/ExportFilters.test.tsx`,
  `src/renderer/hooks/useExportPreview.test.ts`.
