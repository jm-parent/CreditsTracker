# Monthly Heatmap Gradient Design

## Goal

Improve the existing monthly activity heatmap so its cells use a clearer,
progressive blue/cyan intensity scale while keeping the current calendar
layout, relative-to-month data scaling, navigation, and legend behavior.

## Selected Approach

Keep the existing five discrete intensity levels:

- level 0: no activity / muted dark background;
- levels 1-4: progressively brighter blue/cyan backgrounds;
- level 4: the brightest color for the busiest day of the selected month.

Replace the current `color-mix` expression with explicit theme-aware colors
or CSS classes/variables that are stable across supported Chromium rendering.
The intensity calculation and data flow remain unchanged.

## Accessibility and Readability

Cell day numbers must remain readable at every intensity:

- use a consistent light foreground color with sufficient contrast against
  every non-empty background;
- keep the muted foreground treatment for inactive cells only when it remains
  readable, otherwise use the same light foreground;
- preserve each cell's existing accessible name and title, including the date
  and exact credit value, so users do not need to infer values from color;
- retain the existing text legend ("Less" to "More") and its accessible label;
- preserve keyboard-focusable `<button>` cells and visible focus behavior.

The selected colors should be checked against WCAG-oriented contrast expectations
for small text, especially the brightest cyan level.

## Scope

Only `ActivityHeatmapPage.tsx` and, if needed, the renderer stylesheet should
change. No database, IPC, hook, layout, or navigation behavior changes are
required. Existing tests should be extended only if necessary to assert the
new level/color-related accessibility contract without coupling tests to an
implementation-specific color string.

## Validation

Run the focused `ActivityHeatmapPage` test and the full existing Vitest suite.
Verify the resulting cells visually or through rendered styles that all five
legend swatches and cell labels remain readable.
