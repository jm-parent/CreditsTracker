# Credit Update Indicators

**Status:** Approved
**Date:** 2026-09-10
**Amended:** 2026-09-10 — the monthly activity heatmap is explicitly out of
scope for live update feedback. See "Scope Amendment" below; every other
mention of heatmap highlighting in this document describes the original,
now-superseded design and is retained only for history.

## Context

The dashboard refreshes usage data every five seconds, but updated values replace
their predecessors without any visual feedback. Users can therefore miss new
usage, especially in dense tables and charts.

## Goal

Add visible but unobtrusive feedback that identifies both where credit data
changed and, for numeric values, by how much.

This is a renderer-only comfort improvement. It must not change persistence,
IPC, polling frequency, filtering, sorting, or the shared data format.

## Interaction Design

### Numeric credit values

- Replace a displayed credit value immediately when fresh data arrives.
- When the value differs from the previous successful refresh, show a compact
  delta beside it.
- A positive delta uses a soft green treatment and a leading plus sign, such as
  `+12.40`.
- A negative correction uses a soft orange treatment and a minus sign. Red is
  avoided because a corrected value is not necessarily an application error.
- The delta fades in with a slight upward movement, remains readable briefly,
  and fades out 1.5 seconds after the change.
- Keep the delta in the normal inline flow beside the value so it cannot be
  clipped or hidden behind adjacent content.
- Apply the behavior to visible AIU credit amounts in summary cards and table
  cells. Non-credit counts, token values, and request values are out of scope.

### Charts

- Compare chart points by stable semantic key: date for time-series data, and
  project or model key for breakdown data.
- Apply the drop animation consistently to the `Daily consumption`,
  `By Project`, and `By Model` charts.
- A positive delta appears just above the changed bar or stacked segment in
  that project's stable chart color. It tilts slightly to the right, falls
  toward the segment with accelerating vertical motion, then shrinks and fades
  on contact, like a drop entering the column.
- Project and model breakdown bars each use the existing stable key-to-color
  mapping, so every project and every model keeps the same color across renders.
  The drop always matches its target bar or segment.
- The complete drop animation lasts 1.2 seconds and replaces the previous
  cyan/green glow; changed bars do not glow.
- If several projects change on the same date, render one drop per project.
  Offset simultaneous drops horizontally by a few pixels so their `+X.XX`
  labels remain distinguishable while each falls into its own colored segment.
- Negative corrections do not use the falling-drop metaphor. They display a
  compact orange `−X.XX` above the affected segment and fade in place, because
  a falling value implies addition.
- The monthly activity heatmap is excluded from this behavior; see "Scope
  Amendment" below.
- Preserve Recharts' normal bar-size transition so the new magnitude remains
  understandable.
- Do not flash the complete chart or display a global update notification.

### Baselines and resets

The first successful result establishes a baseline and does not animate.
Changing a filter, page, selected project, date range, model, or displayed
month also establishes a new baseline. These user-driven context changes must
not be presented as incoming data.

Only a later successful refresh in the same context can produce indicators.
If a refresh fails, the last known data remains visible and no update animation
runs.

When another change arrives while an indicator is active, replace the displayed
delta with the newest difference and restart the effect.

## Architecture

### Change tracking

Introduce a small renderer hook that:

1. Accepts a current numeric value, a stable identity, and a reset identity
   representing the active data context.
2. Stores the previous successfully rendered value for that identity.
3. Returns the current delta and an animation instance identifier when the
   value changes.
4. Clears transient indicator state after the configured display duration.
5. Resets without emitting a delta when the data context changes.

The hook owns comparison and timing only. It does not fetch data and does not
alter `useUsageData`.

### Numeric presentation

Add a focused credit-value component that renders the formatted current value
and, when supplied by the change tracker, the transient delta. Summary cards
and credit table cells reuse this component so formatting, timing, and
accessibility behavior remain consistent.

Rows must be tracked by their project or model key rather than their current
array position. This preserves the correct association when credit-based
sorting moves a row after an update.

### Chart presentation

Add a keyed comparison helper for chart datasets. Each chart derives the set
of changed keys from its previous data in the same context and passes a
transient changed state to the relevant custom Recharts shape. The chart keeps
responsibility for rendering its own geometry; the comparison helper remains
independent of Recharts. The monthly activity heatmap does not use this
helper; see "Scope Amendment" below.

Render chart deltas through one reusable custom Recharts shape shared by the
time-series and breakdown charts. The shape preserves the original bar
rectangle and overlays non-interactive SVG text above its top edge. It receives
the stable project/model color, delta, animation identity, and simultaneous
drop offset. Existing bar clicks and transparent full-column click targets
remain unchanged.

No database, Electron main-process, preload, IPC, or shared-type changes are
required.

## Accessibility

- Respect `prefers-reduced-motion: reduce`. In reduced-motion mode, remove
  translation and resizing flourishes. Chart deltas appear above the segment
  and fade in place without falling or tilting.
- Treat transient deltas and chart drops as supplementary visual feedback.
  Hide them from accessibility APIs so screen readers are not interrupted
  every five seconds.
- Keep the final numeric value available as normal text and preserve existing
  labels, roles, keyboard behavior, and chart interactions.
- Do not rely on color alone for numeric changes: the explicit `+` or minus
  sign communicates direction.

## Error Handling

- Do not create indicators for failed refreshes.
- Do not discard the previous successful baseline on a transient error.
- Cancel pending timers when a component unmounts or its context resets.
- Handle added or removed chart keys without treating the first appearance in
  a newly selected context as a change.

## Testing

Add focused tests for:

- no delta or chart drop on initial render;
- positive and negative numeric deltas;
- indicator removal after its duration;
- replacement and restart on successive updates;
- reset without animation after a context or filter change;
- stable row association when sorting changes row order;
- changed-key detection and correctly colored drops for time-series and
  breakdown data;
- one horizontally offset drop per changed project when several stacked
  segments change on the same date;
- falling motion for additions and stationary orange fading for corrections;
- no indicator after a refresh error;
- reduced-motion styling.

Existing component and application tests must continue to pass unchanged unless
a test needs an additional assertion for the new visual feedback.

The monthly heatmap instead has focused tests asserting that a rerender with
changed data never adds `data-credit-updated`, a glow class, or a CreditValue
delta; see "Scope Amendment" below.

## Out of Scope

- A global "Data updated" toast or badge.
- Persisting update history.
- Changing the five-second polling interval.
- Animating tokens, request counts, logs, or raw data.
- Audio, desktop notifications, or attention-grabbing full-card flashes.
- Live update feedback (highlighted cells, glow, or numeric deltas) on the
  monthly activity heatmap page. See "Scope Amendment" below.

## Scope Amendment (2026-09-10)

The monthly activity heatmap page is explicitly **out of scope** for live
update feedback. Every mention above of a "changed monthly heatmap cell,"
heatmap glow, or heatmap changed-key tracking describes the original design as
approved, before this amendment; that behavior was implemented (Task 5 of the
implementation plan) and then removed the same day after review, because a
calendar of glowing/re-numbering day cells was judged too busy for a
month-at-a-glance view and not worth the added visual noise.

The monthly heatmap page keeps everything else from this feature's rollout
unaffected — data fetching, summaries, intensity colors, navigation, and
loading/error handling are unchanged — but:

- `ActivityHeatmapPage` no longer accepts an `updateContextKey` prop and does
  not call `useCreditChanges`.
- Day cells never receive `data-credit-updated` or the `credit-heatmap-updated`
  glow class.
- The busiest/quietest summary values render as plain `X.XX credits` text
  again, with no `CreditValue`/delta.
- `App` no longer derives a `monthlyUpdateContextKey`.
- The heatmap-specific `credit-heatmap-highlight` keyframes and reduced-motion
  override were removed from `index.css`. Numeric deltas and the separate
  bar-chart indicator implementation remain independent of the heatmap.

This also makes the final-review concern about navigating to the Monthly tab
during a pending usage-filter refresh moot for the heatmap specifically: with
no indicator tracker mounted on that page, there is nothing there that could
misattribute a cross-context delta in the first place.
