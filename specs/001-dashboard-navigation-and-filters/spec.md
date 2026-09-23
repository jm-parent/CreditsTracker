# Feature Specification: Dashboard Navigation and Shared Filters

**Feature Branch**: Not applicable — baseline contract for an existing feature

**Created**: 2026-09-23

**Status**: Baseline — current behavior

**Input**: Existing Credits Dashboard behavior verified against the repository
documentation, implementation, and tests.

## User Scenarios & Testing

### User Story 1 — Navigate between dashboard areas (Priority: P1)

As a user, I can switch between the app's usage, analysis, data, and discovery
areas so I can find the view appropriate to the question I have.

**Why this priority**: Navigation is the entry point to every dashboard
capability.

**Independent Test**: Select each sidebar entry and verify that its matching
page is shown and marked active.

**Acceptance Scenarios**:

1. **Given** the dashboard is open, **When** I select any sidebar entry,
   **Then** its corresponding page is displayed.
2. **Given** a project or hourly detail overlay is open, **When** I switch
   sidebar entries, **Then** the overlay is closed.
3. **Given** I have selected shared usage filters, **When** I switch between
   usage dashboard pages, **Then** those filters remain selected.

### User Story 2 — Narrow usage views (Priority: P1)

As a user, I can filter usage views by model and project path to focus on a
subset of the available usage.

**Why this priority**: Shared filters make the usage pages useful for
investigating a particular model or project.

**Independent Test**: Choose a model and enter a project-path search, then
verify that supported dashboard results reflect both selections.

**Acceptance Scenarios**:

1. **Given** filter options are available, **When** I select a model or enter a
   project-path search, **Then** the supported usage views refresh with those
   filters.
2. **Given** a filter is cleared, **When** the next results are shown,
   **Then** that filter no longer limits the data.
3. **Given** I open Raw data, HTML export, Logs, or Featured projects,
   **Then** the shared usage filter bar is not shown on that page.

### Edge Cases

- If filter options cannot be loaded, the app records the error and shows the
  existing unavailable-data state when no usage result is available.
- Project detail omits the project-path search control because that project is
  already selected.

## Requirements

### Functional Requirements

- **FR-001**: The sidebar MUST provide navigation to Daily consumption,
  Monthly activity, By project, By model, Raw data, HTML export, Logs, and
  Featured projects.
- **FR-002**: The sidebar MUST group its entries into Overview, Analysis,
  Data & tools, and Discovery.
- **FR-003**: Usage overview pages MUST share project-path and model filters;
  project detail MUST keep its selected project and allow model filtering.
- **FR-004**: The shared usage filters MUST remain independent from the
  filters owned by the HTML export page.
- **FR-005**: Changing a navigation entry MUST clear an open project-detail or
  hourly-detail overlay.

### Key Entities

- **Usage filters**: Optional model and project-path constraints applied to
  supported dashboard usage queries.
- **Dashboard entry**: A sidebar destination with an active state and
  corresponding page.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Each of the eight sidebar entries opens its corresponding page.
- **SC-002**: Selecting a usage filter changes the supported usage results
  without changing the HTML export page's independent selection.
- **SC-003**: Switching sidebar entries closes any active project or hourly
  detail overlay.

## Assumptions

- These requirements document current navigation and filter behavior; they do
  not add new pages or filter types.
- Date-range shortcuts and date filters belong to HTML export, not the shared
  dashboard filter bar.

## Evidence

- `README.md` — feature and filter overview.
- `docs/DEVELOPMENT.md` — navigation, filter, and export-state boundaries.
- `src/renderer/components/Sidebar.tsx`, `src/renderer/components/FilterBar.tsx`,
  `src/renderer/App.tsx`.
- `src/renderer/components/Sidebar.test.tsx`,
  `src/renderer/components/FilterBar.test.tsx`, `src/renderer/App.test.tsx`.
