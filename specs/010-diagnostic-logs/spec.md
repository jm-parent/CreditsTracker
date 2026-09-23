# Feature Specification: Diagnostic Logs

**Feature Branch**: Not applicable — baseline contract for an existing feature

**Created**: 2026-09-23

**Status**: Baseline — current behavior

**Input**: Existing Credits Dashboard behavior verified against the repository
documentation, implementation, and tests.

## User Scenarios & Testing

### User Story 1 — Find and share diagnostic information (Priority: P1)

As a user, I can search and filter application logs, then copy the visible
entries or open their log folder to help investigate a problem.

**Why this priority**: The diagnostic page exposes information needed to
understand data-source, IPC, and renderer failures.

**Independent Test**: Load log entries, filter by level and text, and verify
that copy and open-folder actions operate on the displayed app log.

**Acceptance Scenarios**:

1. **Given** log entries are available, **When** I select a minimum severity
   or enter text, **Then** only matching entries are shown newest first.
2. **Given** auto-refresh is enabled, **When** new entries arrive, **Then**
   the page periodically refreshes; turning it off stops periodic refresh.
3. **Given** entries match my filters, **When** I select Copy, **Then** those
   visible entries are copied and the button briefly confirms success.
4. **Given** the log file is available, **When** I select Open log folder,
   **Then** the containing folder is revealed by the operating system.
5. **Given** I select Clear, **When** the action completes, **Then** the
   in-memory entries are cleared and the app log file is truncated when file
   logging is available.

### Edge Cases

- If clipboard copying fails, the failure is written to application
  diagnostics.
- If logs cannot be loaded, the page displays the loading error.
- If no entries match the current filters, the page shows an empty-result
  message.

## Requirements

### Functional Requirements

- **FR-001**: The page MUST filter log entries by minimum severity and text
  in the message, scope, or detail.
- **FR-002**: The page MUST display matching entries newest first and show
  total, error, and warning counts.
- **FR-003**: The page MUST allow manual refresh and optional automatic
  refresh.
- **FR-004**: The page MUST copy the currently visible filtered entries.
- **FR-005**: The page MUST allow opening the application log folder and
  clearing in-memory entries and the writable log file.
- **FR-006**: The page MUST show loading, error, and no-match states.
- **FR-007**: The page MUST allow a manual app update check; update behavior is
  specified in [012 — Opt-in app updates](../012-opt-in-app-updates/spec.md).

## Success Criteria

### Measurable Outcomes

- **SC-001**: Applying a severity and text filter shows only entries meeting
  both selections.
- **SC-002**: Copy contains the visible filtered entries and a successful
  action is acknowledged on the page.
- **SC-003**: Clearing logs removes the current in-memory entries and
  truncates the writable log file.

## Assumptions

- The application log is stored under
  `%APPDATA%\\credits-tracker\\logs\\app.log` and is rotated at 2 MB.
- Clearing logs does not delete other application data.
- Log access and file operations remain local to the user's machine.

## Evidence

- `README.md` — log location, rotation, filtering, copy, and folder access.
- `src/main/logger.ts`, `src/renderer/hooks/useLogs.ts`,
  `src/renderer/components/LogsPage.tsx`, `src/main/ipc-handlers.ts`.
- `src/main/logger.test.ts`, `src/renderer/components/LogsPage.test.tsx`,
  `src/main/ipc-handlers.test.ts`.
