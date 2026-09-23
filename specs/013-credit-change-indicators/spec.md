# Feature Specification: Credit Change Indicators

**Feature Branch**: Not applicable — baseline contract for an existing feature

**Created**: 2026-09-23

**Status**: Baseline — current behavior

**Input**: Existing Credits Dashboard behavior verified against the repository
documentation, implementation, and tests.

## User Scenarios & Testing

### User Story 1 — Notice changes after refreshed usage (Priority: P2)

As a user, I can see whether displayed credit totals have increased or
decreased since the prior successful usage snapshot.

**Why this priority**: Change indicators make newly refreshed usage easier to
notice without comparing numbers manually.

**Independent Test**: Render one successful snapshot, provide a later snapshot
with a changed credit value, and verify that a temporary directional
indication appears.

**Acceptance Scenarios**:

1. **Given** a successful baseline snapshot, **When** a later snapshot has a
   larger credit value, **Then** the corresponding summary or chart value
   shows a positive change indicator.
2. **Given** a successful baseline snapshot, **When** a later snapshot has a
   smaller credit value, **Then** the corresponding value shows a negative
   change indicator.
3. **Given** filters change, **When** the first successful snapshot for the
   new filter context arrives, **Then** it becomes the new baseline without
   showing a cross-filter change.
4. **Given** a change indicator is shown, **When** its display period ends,
   **Then** the temporary indicator is cleared.

### Edge Cases

- The first successful snapshot establishes a baseline and does not show a
  change.
- Re-rendering the same snapshot does not create another change indicator.
- A transient failed request does not compare new filters against stale data
  from the previous context.

## Requirements

### Functional Requirements

- **FR-001**: The app MUST compare credit values only across distinct
  successful snapshots in the same filter context.
- **FR-002**: An increase MUST be visually distinguished from a decrease.
- **FR-003**: The app MUST show change indicators for applicable summary and
  time-series credit values.
- **FR-004**: A filter-context change MUST clear prior indicators and use the
  first successful snapshot for the new context as its baseline.
- **FR-005**: Change indicators MUST be temporary and clear after their
  display period.

## Success Criteria

### Measurable Outcomes

- **SC-001**: An increase and a decrease between successful snapshots produce
  distinguishable indicators.
- **SC-002**: The first snapshot after a filter change produces no
  cross-context delta.
- **SC-003**: A visible indicator clears after its configured display period.

## Assumptions

- Indicators communicate credit changes only; they do not change the
  underlying totals.
- If no prior successful snapshot exists, there is no comparison to display.

## Evidence

- `src/renderer/hooks/useCreditChanges.ts`,
  `src/renderer/components/CreditValue.tsx`,
  `src/renderer/components/CreditDropLabel.tsx`,
  `src/renderer/components/SummaryCards.tsx`,
  `src/renderer/components/TimeSeriesChart.tsx`.
- `src/renderer/hooks/useCreditChanges.test.ts`,
  `src/renderer/components/CreditValue.test.tsx`,
  `src/renderer/components/CreditDropLabel.test.tsx`,
  `src/renderer/components/SummaryCards.test.tsx`,
  `src/renderer/components/TimeSeriesChart.test.tsx`.
