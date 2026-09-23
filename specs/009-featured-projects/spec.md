# Feature Specification: Featured Projects

**Feature Branch**: Not applicable — baseline contract for an existing feature

**Created**: 2026-09-23

**Status**: Baseline — current behavior

**Input**: Existing Credits Dashboard behavior verified against the repository
documentation, implementation, and tests.

## User Scenarios & Testing

### User Story 1 — Browse the curated catalogue (Priority: P1)

As a user, I can browse a curated collection of GitHub projects related to
AI-assisted development and filter it by tag.

**Why this priority**: The catalogue is a self-contained discovery area that
does not require usage records.

**Independent Test**: Open Featured projects, select a tag, and verify that
only matching project cards remain visible.

**Acceptance Scenarios**:

1. **Given** the catalogue is open, **When** I select All, **Then** all
   curated project cards are shown.
2. **Given** a tag is available, **When** I select that tag, **Then** only
   cards with that tag are shown.
3. **Given** I open a project card, **When** the action succeeds, **Then**
   that repository opens in the system browser.
4. **Given** the external-link action fails, **When** the page handles the
   failure, **Then** it displays a retryable error message.

### Edge Cases

- A tag with no matching projects shows an empty-result message.
- The project catalogue is available without usage records; opening an
  external URL still requires the user's action.

## Requirements

### Functional Requirements

- **FR-001**: The page MUST show curated project cards with their descriptions
  and tags.
- **FR-002**: The page MUST provide an All option and a filter option for
  each tag present in the catalogue.
- **FR-003**: Selecting a tag MUST limit the visible cards to matching
  projects.
- **FR-004**: Selecting a project MUST request that its GitHub repository
  open externally.
- **FR-005**: A failed external-link request MUST be reported on the page.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Selecting All displays every project in the curated catalogue.
- **SC-002**: Selecting a tag displays only projects containing that tag.
- **SC-003**: Each project-link action either opens the selected repository
  externally or presents an error.

## Assumptions

- The catalogue is shipped as curated local data and is available offline.
- Network access is needed only after the user chooses to open a repository.

## Evidence

- `README.md` — Featured projects overview and external-link behavior.
- `src/renderer/data/featuredProjects.ts`,
  `src/renderer/components/FeaturedProjectsPage.tsx`,
  `src/main/ipc-handlers.ts`.
- `src/renderer/components/FeaturedProjectsPage.test.tsx`,
  `src/main/ipc-handlers.test.ts`.
