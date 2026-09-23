# Feature Specification: Model Analytics

**Feature Branch**: Not applicable — baseline contract for an existing feature

**Created**: 2026-09-23

**Status**: Baseline — current behavior

**Input**: Existing Credits Dashboard behavior verified against the repository
documentation, implementation, and tests.

## User Scenarios & Testing

### User Story 1 — Compare usage by model (Priority: P1)

As a user, I can compare credit consumption across models and understand each
model's share of the selected usage.

**Why this priority**: Model comparison helps users understand how usage is
distributed across the models they used.

**Independent Test**: Open By model with usage from multiple models and verify
that the chart and table show matching totals and shares.

**Acceptance Scenarios**:

1. **Given** model usage is available, **When** I open By model, **Then** I
   see a breakdown chart and table of model totals.
2. **Given** the table contains a model, **When** I inspect its row, **Then**
   I see its AIU credits and percentage of total usage.
3. **Given** a model filter is active, **When** model analytics refresh,
   **Then** the results reflect the selected shared filter.

### Edge Cases

- With no models in the current selection, the page shows the existing empty
  state rather than a misleading share.
- A model with zero share does not imply that the model is absent from other
  filter selections.

## Requirements

### Functional Requirements

- **FR-001**: The page MUST summarize AIU credits by model for the current
  usage selection.
- **FR-002**: The page MUST show model totals in a breakdown chart and table.
- **FR-003**: Each model table row MUST show its AIU credits and percentage of
  total usage.
- **FR-004**: Model analytics MUST respect the shared project and model
  filters.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every displayed model row has a credit total and percentage of
  the selected total.
- **SC-002**: Changing a shared filter updates both the model chart and table
  to the same selection.

## Assumptions

- Percentages are calculated against the current filtered selection.
- The page presents aggregates and does not add a model-specific detail
  drill-down.

## Evidence

- `README.md` — By model feature description.
- `src/renderer/components/ModelsPage.tsx`,
  `src/renderer/components/ModelTable.tsx`,
  `src/renderer/components/BreakdownChart.tsx`, `src/main/db.ts`.
- `src/renderer/components/ModelsPage.test.tsx`,
  `src/renderer/components/ModelTable.test.tsx`, `src/main/db.test.ts`.
