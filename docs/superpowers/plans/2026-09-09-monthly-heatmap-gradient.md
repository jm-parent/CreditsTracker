# Monthly Heatmap Gradient Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the monthly activity heatmap cells with a clearer blue/cyan intensity scale while preserving readable day numbers and existing calendar behavior.

**Architecture:** Keep the current `ActivityHeatmapPage` as the only behavior-owning component. Replace dynamic `color-mix` backgrounds with explicit intensity style metadata and update tests to verify the accessibility contract without depending on fragile browser color serialization.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4 theme variables, Vitest, Testing Library.

## Global Constraints

- Keep the monthly calendar layout, previous/next navigation, summary cards, and data scaling relative to the selected month's maximum unchanged.
- Use five discrete levels: level 0 for no activity and levels 1-4 for progressively stronger blue/cyan backgrounds.
- Cell day numbers must remain readable at every intensity.
- Preserve each cell's accessible name and title with date and exact credit value.
- Preserve the existing legend text ("Less" to "More") and its accessible label.
- Preserve keyboard-focusable `<button>` cells and visible focus behavior.
- Change only `src/renderer/components/ActivityHeatmapPage.tsx` and its colocated test unless validation reveals a directly related issue.
- Do not add dependencies.

---

## File Structure

- `src/renderer/components/ActivityHeatmapPage.tsx`: owns monthly calendar rendering, intensity calculation, visual style metadata, cell labels, summary cards, and the legend.
- `src/renderer/components/ActivityHeatmapPage.test.tsx`: verifies the monthly calendar behavior, accessible labels, navigation callbacks, empty state, and the new readable intensity metadata.

### Task 1: Heatmap color scale and readable cell metadata

**Files:**
- Modify: `src/renderer/components/ActivityHeatmapPage.test.tsx`
- Modify: `src/renderer/components/ActivityHeatmapPage.tsx`

**Interfaces:**
- Consumes: `intensityLevel(credits: number, maxCredits: number): number`, current cell rendering, and current legend rendering in `ActivityHeatmapPage.tsx`.
- Produces: `cellStyle(level: number): React.CSSProperties`, used by both day cells and legend swatches, with stable `backgroundColor`, `color`, `border`, and CSS custom property metadata for tests.

- [ ] **Step 1: Write failing tests for the new visual/accessibility contract**

Add this test to `src/renderer/components/ActivityHeatmapPage.test.tsx`:

```tsx
it('uses five readable blue/cyan intensity levels for the legend and day cells', () => {
  render(
    <ActivityHeatmapPage
      year={2026}
      month={9}
      data={[
        { date: '2026-09-01', aiuCredits: 0 },
        { date: '2026-09-02', aiuCredits: 1 },
        { date: '2026-09-03', aiuCredits: 2 },
        { date: '2026-09-04', aiuCredits: 3 },
        { date: '2026-09-05', aiuCredits: 4 },
      ]}
      loading={false}
      error={null}
      onPrevMonth={vi.fn()}
      onNextMonth={vi.fn()}
    />,
  );

  const legend = screen.getByLabelText('Intensity scale from no activity to highest activity');
  const swatches = Array.from(legend.querySelectorAll('[data-intensity-level]'));

  expect(swatches).toHaveLength(5);
  expect(swatches.map((swatch) => swatch.getAttribute('data-intensity-level'))).toEqual([
    '0',
    '1',
    '2',
    '3',
    '4',
  ]);
  expect(swatches.map((swatch) => swatch.getAttribute('data-intensity-color'))).toEqual([
    'none',
    'low',
    'medium',
    'high',
    'highest',
  ]);

  expect(screen.getByRole('button', { name: 'September 1, 2026: 0.00 credits' })).toHaveAttribute(
    'data-intensity-color',
    'none',
  );
  expect(screen.getByRole('button', { name: 'September 5, 2026: 4.00 credits' })).toHaveAttribute(
    'data-intensity-color',
    'highest',
  );
});
```

This test intentionally checks semantic intensity metadata and the accessible cell names instead of raw computed CSS colors.

- [ ] **Step 2: Run the focused component test and confirm the new test fails**

Run:

```bash
npm test -- ActivityHeatmapPage.test.tsx
```

Expected result: the new test fails because legend swatches and cells do not yet expose `data-intensity-level` or `data-intensity-color`.

- [ ] **Step 3: Replace `cellColor` with explicit readable style metadata**

In `src/renderer/components/ActivityHeatmapPage.tsx`, import React CSS types and replace `cellColor` with a small palette:

```tsx
import type { CSSProperties } from 'react';
```

Add these constants below `INTENSITY_LEVELS`:

```tsx
const HEATMAP_LEVEL_STYLES = [
  {
    name: 'none',
    backgroundColor: '#111827',
    foregroundColor: '#e5e9f0',
    borderColor: '#263242',
  },
  {
    name: 'low',
    backgroundColor: '#12304a',
    foregroundColor: '#f8fafc',
    borderColor: '#1d4f73',
  },
  {
    name: 'medium',
    backgroundColor: '#145f7f',
    foregroundColor: '#f8fafc',
    borderColor: '#1d8fb3',
  },
  {
    name: 'high',
    backgroundColor: '#0f8fb0',
    foregroundColor: '#071015',
    borderColor: '#22d3ee',
  },
  {
    name: 'highest',
    backgroundColor: '#22d3ee',
    foregroundColor: '#071015',
    borderColor: '#67e8f9',
  },
] as const;
```

Replace the existing `cellColor` function with:

```tsx
function cellStyle(level: number): CSSProperties {
  const style = HEATMAP_LEVEL_STYLES[level] ?? HEATMAP_LEVEL_STYLES[0];
  return {
    backgroundColor: style.backgroundColor,
    color: style.foregroundColor,
    borderColor: style.borderColor,
  };
}

function intensityColorName(level: number): string {
  return HEATMAP_LEVEL_STYLES[level]?.name ?? HEATMAP_LEVEL_STYLES[0].name;
}
```

These colors preserve the app's dark blue/cyan theme and switch the foreground from light to near-black only for the brightest levels where dark text has stronger contrast.

- [ ] **Step 4: Apply the new style metadata to cells and legend swatches**

Update day cell buttons to use the new style, preserve the current label/title, and add semantic metadata:

```tsx
const level = intensityLevel(cell.aiuCredits, maxCredits);

<button
  key={cell.date}
  type="button"
  className="activity-heatmap-cell h-8 w-full rounded-sm border text-xs font-medium"
  style={cellStyle(level)}
  data-intensity-level={level}
  data-intensity-color={intensityColorName(level)}
  aria-label={cellLabel(year, month, cell)}
  title={cellLabel(year, month, cell)}
>
  {cell.day}
</button>
```

Because this is inside `cells.map`, use a block body for the `cell ? (...) : (...)` branch so `level` is computed once per rendered cell.

Update legend swatches similarly:

```tsx
<span
  key={`legend-${level}`}
  className="h-3 w-3 rounded-sm border"
  style={cellStyle(level)}
  data-intensity-level={level}
  data-intensity-color={intensityColorName(level)}
  aria-hidden="true"
/>
```

- [ ] **Step 5: Run the focused component test and confirm it passes**

Run:

```bash
npm test -- ActivityHeatmapPage.test.tsx
```

Expected result: all `ActivityHeatmapPage` tests pass.

- [ ] **Step 6: Run the full test suite**

Run:

```bash
npm test
```

Expected result: the full Vitest suite passes.

- [ ] **Step 7: Commit the implementation**

Run:

```bash
git add src/renderer/components/ActivityHeatmapPage.tsx src/renderer/components/ActivityHeatmapPage.test.tsx
git commit -m "feat: improve monthly heatmap gradient readability" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

Expected result: a feature commit containing only the component and test changes.

## Self-Review

- Spec coverage: Task 1 covers the five-level blue/cyan gradient, readable numbers, preserved accessible labels/title, preserved legend, and unchanged monthly behavior.
- Placeholder scan: no placeholder terms are present in implementation steps.
- Type consistency: `cellStyle(level: number): CSSProperties` and `intensityColorName(level: number): string` are defined before use by both cells and legend swatches.
