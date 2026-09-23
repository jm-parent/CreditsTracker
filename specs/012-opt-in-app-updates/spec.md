# Feature Specification: Opt-in App Updates

**Feature Branch**: Not applicable — baseline contract for an existing feature

**Created**: 2026-09-23

**Status**: Baseline — current behavior

**Input**: Existing Credits Dashboard behavior verified against the repository
documentation, implementation, and tests.

## User Scenarios & Testing

### User Story 1 — Review an available update (Priority: P1)

As a user, I can see when a compatible app update is available and review its
release notes before choosing whether to download it.

**Why this priority**: Users need to control whether an update is downloaded
and when the application restarts.

**Independent Test**: Provide an available release response and verify that
the sidebar affordance opens a dialog with version and release information.

**Acceptance Scenarios**:

1. **Given** a supported packaged build starts, **When** its availability
   check finds a release, **Then** the app shows an update affordance and
   release details.
2. **Given** an update is available, **When** I do not accept it, **Then** no
   update is downloaded or installed.
3. **Given** I accept the update, **When** the download is staged, **Then**
   the dialog offers a restart action.
4. **Given** the update feed fails, **When** the check completes, **Then** the
   error state can be reviewed and retried.

### User Story 2 — Apply an accepted update (Priority: P2)

As a user, I can restart the app when an accepted update has finished
downloading.

**Why this priority**: The staged update is applied only at a user-selected
restart point.

**Independent Test**: Simulate an update-ready state and verify that Restart
now requests application restart.

**Acceptance Scenarios**:

1. **Given** the update is downloading, **When** progress is displayed,
   **Then** the dialog uses an indeterminate progress indicator rather than a
   percentage.
2. **Given** the update is ready, **When** I choose Restart now, **Then** the
   app restarts to apply the update.
3. **Given** the app is an unsupported or unpackaged development build,
   **When** update state is read, **Then** the update affordance is not shown.

### Edge Cases

- A no-update response marks the app up to date.
- A failed availability or download attempt enters an error state rather than
  silently appearing successful.
- Periodic checks do not reset a download already in progress or an update
  already staged.

## Requirements

### Functional Requirements

- **FR-001**: A supported packaged build MUST check release availability on
  startup and periodically while running.
- **FR-002**: An availability check MUST NOT download or install an update.
- **FR-003**: The app MUST present an available version and release notes
  before the user can accept the download.
- **FR-004**: The app MUST download and stage an update only after the user
  accepts.
- **FR-005**: The app MUST show an indeterminate download state and then offer
  restart when the update is ready.
- **FR-006**: The app MUST report check and download errors in its update
  state.
- **FR-007**: Unsupported platforms and unpackaged development builds MUST
  report updates as unavailable and hide the update affordance.

## Success Criteria

### Measurable Outcomes

- **SC-001**: No update download begins before the user accepts the available
  update.
- **SC-002**: A staged update can be applied only after the user selects the
  restart action.
- **SC-003**: Unsupported builds show no actionable update badge.

## Assumptions

- Update checks use the public Electron update service; no GitHub API
  permissions are required.
- Availability checks run on startup and every four hours in supported
  packaged builds.
- Update downloads use the platform's packaged updater and provide no
  byte-level progress.

## Evidence

- `README.md` — user-driven update behavior.
- `docs/DEVELOPMENT.md` — update feed, cadence, platform support, and
  download/apply lifecycle.
- `src/main/updater.ts`, `src/renderer/hooks/useAppUpdate.ts`,
  `src/renderer/components/UpdateDialog.tsx`,
  `src/renderer/components/Sidebar.tsx`.
- `src/main/updater.test.ts`,
  `src/renderer/components/UpdateDialog.test.tsx`,
  `src/renderer/components/Sidebar.test.tsx`.
