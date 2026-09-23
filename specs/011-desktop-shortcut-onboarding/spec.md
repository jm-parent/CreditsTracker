# Feature Specification: Desktop Shortcut Onboarding

**Feature Branch**: Not applicable — baseline contract for an existing feature

**Created**: 2026-09-23

**Status**: Baseline — current behavior

**Input**: Existing Credits Dashboard behavior verified against the repository
documentation, implementation, and tests.

## User Scenarios & Testing

### User Story 1 — Create a desktop shortcut when eligible (Priority: P2)

As a user with an eligible packaged installation, I can create a desktop
shortcut when one is not already present.

**Why this priority**: The prompt helps users launch the installed app without
reinstalling or manually creating a shortcut.

**Independent Test**: Simulate a supported Squirrel-managed installation with
no current or legacy shortcut and verify the prompt and creation result.

**Acceptance Scenarios**:

1. **Given** the app is running from a supported Squirrel-managed install and
   no current or legacy desktop shortcut exists, **When** the app checks
   eligibility, **Then** the shortcut prompt is shown.
2. **Given** the prompt is shown, **When** I choose Create and creation
   succeeds, **Then** the prompt closes.
3. **Given** creation fails, **When** the failure is returned, **Then** the
   prompt shows an error and allows another attempt.
4. **Given** the prompt is shown, **When** I dismiss it, **Then** it closes
   without creating a shortcut.

### Edge Cases

- Unsupported platforms, non-Squirrel builds, and existing current or legacy
  shortcuts are not eligible for the prompt.
- A successful process exit is not considered success unless the expected
  desktop shortcut exists.

## Requirements

### Functional Requirements

- **FR-001**: The app MUST prompt only when the platform/build supports
  shortcut creation and no current or legacy desktop shortcut exists.
- **FR-002**: The prompt MUST allow the user to create a shortcut or dismiss
  the prompt.
- **FR-003**: Creation MUST report success only when the expected desktop
  shortcut is present.
- **FR-004**: A failed creation MUST show an error and allow the user to retry.
- **FR-005**: The app MUST NOT create the shortcut before the user chooses the
  create action.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Eligible installations show the prompt, and ineligible
  installations do not.
- **SC-002**: A successful create action closes the prompt only after the
  shortcut is verified.
- **SC-003**: A failed create action leaves the prompt available with visible
  error feedback.

## Assumptions

- Dismissing the prompt does not create or remove files.
- Eligibility is checked when the application starts; a dismissed prompt may
  be offered again on a later launch if no shortcut exists.

## Evidence

- `src/main/shortcut.ts`, `src/renderer/hooks/useDesktopShortcutPrompt.ts`,
  `src/renderer/components/DesktopShortcutToast.tsx`, `src/renderer/App.tsx`.
- `src/main/shortcut.test.ts`,
  `src/renderer/hooks/useDesktopShortcutPrompt.test.ts`,
  `src/renderer/components/DesktopShortcutToast.test.tsx`.
