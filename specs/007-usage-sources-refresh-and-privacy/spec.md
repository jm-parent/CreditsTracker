# Feature Specification: Usage Sources, Refresh, and Privacy

**Feature Branch**: Not applicable — baseline contract for an existing feature

**Created**: 2026-09-23

**Status**: Baseline — current behavior

**Input**: Existing Credits Dashboard behavior verified against the repository
documentation, implementation, and tests.

## User Scenarios & Testing

### User Story 1 — See usage from supported Copilot sources (Priority: P1)

As a user, I can see usage recorded by Copilot CLI and, when available, VS
Code Copilot Chat in the same dashboard.

**Why this priority**: A unified view prevents users from having to combine
separate sources manually.

**Independent Test**: Provide usage fixtures from both sources and verify that
the shared usage views include their records.

**Acceptance Scenarios**:

1. **Given** the Copilot CLI database exists, **When** the dashboard loads,
   **Then** its usage records are included in the displayed totals.
2. **Given** VS Code Copilot Chat usage files are available, **When** the
   application reads them, **Then** their usage is included with CLI usage.
3. **Given** the VS Code data source is unavailable or cannot be read,
   **When** CLI data is available, **Then** the app continues using CLI data
   and records the source error in its diagnostics.

### User Story 2 — See recent usage without restarting (Priority: P1)

As a user, I can see recent usage after a session finishes without closing and
reopening the application.

**Why this priority**: Automatic refresh keeps the local dashboard useful
during ongoing work.

**Independent Test**: Add a source event after the first successful load and
verify it appears after the next refresh cycle.

**Acceptance Scenarios**:

1. **Given** source data changes, **When** the next usage refresh occurs,
   **Then** the dashboard can display the new data without an application
   restart.
2. **Given** a transient refresh fails after data has loaded, **When** the
   page remains open, **Then** it keeps the last successful snapshot and shows
   the existing refresh notice.

### Edge Cases

- If the Copilot CLI database is missing, the app uses an empty usage schema
  and shows its unavailable/empty state rather than terminating.
- VS Code Chat is optional; its absence does not prevent the CLI source from
  being used.
- A failed refresh does not replace the last successfully displayed usage
  snapshot.

## Requirements

### Functional Requirements

- **FR-001**: The application MUST read the Copilot CLI session database
  locally and without writing to it.
- **FR-002**: The application MUST include supported VS Code Copilot Chat
  usage when those local records are available.
- **FR-003**: The application MUST present supported source usage through one
  unified set of dashboard queries.
- **FR-004**: The app MUST refresh its merged view and dashboard results
  periodically while open without requiring a restart.
- **FR-005**: A missing CLI database MUST result in an empty-data experience,
  not an application crash.
- **FR-006**: A VS Code source-read failure MUST be logged and MUST NOT prevent
  otherwise available CLI usage from being displayed.
- **FR-007**: Usage records, prompts, responses, and transcripts MUST NOT be
  sent to an external service.
- **FR-008**: HTML reports MUST exclude prompts, assistant responses, and raw
  conversation transcripts while retaining their documented session
  metadata and summaries.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Available usage from both supported local sources contributes
  to the same filtered dashboard totals.
- **SC-002**: Newly recorded usage can appear within the normal approximately
  five-second refresh cycle, without restarting the app.
- **SC-003**: Missing or unreadable optional source data leaves the app in a
  usable state and provides an appropriate empty or diagnostic indication.
- **SC-004**: Generated HTML reports contain no prompts, assistant responses,
  or raw transcripts.

## Assumptions

- Source databases and VS Code storage remain on the user's local machine.
- The approximately five-second cadence describes the current coordinated
  renderer polling and lazy main-process refresh; it is not a real-time
  guarantee.
- The update availability request and user-initiated external GitHub links are
  separate from usage-data transfer.

## Evidence

- `README.md` — privacy, live updates, and Copilot Chat inclusion.
- `docs/DEVELOPMENT.md` — merged database, local sources, refresh, and report
  privacy boundary.
- `src/main/db.ts`, `src/main/vscode-chat-store.ts`,
  `src/main/ipc-handlers.ts`, `src/renderer/hooks/useUsageData.ts`.
- `src/main/db.test.ts`, `src/main/vscode-chat-store.test.ts`,
  `src/main/ipc-handlers.test.ts`, `src/renderer/hooks/useUsageData.test.ts`.
