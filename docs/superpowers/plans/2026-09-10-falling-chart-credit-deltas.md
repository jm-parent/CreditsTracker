# Falling Chart Credit Deltas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace chart update halos with colored `+X.XX` labels that tilt and fall into updated bars on Daily consumption, By Project, and By Model.

**Architecture:** A reusable SVG label component renders transient deltas through Recharts `LabelList`, keeping bar rectangles and click targets untouched. Existing keyed change tracking supplies delta values and animation identities; breakdown charts color every bar by its stable key, while stacked daily-series labels use each project color and a small horizontal offset.

**Tech Stack:** React 19, TypeScript 7, Recharts 3, Tailwind CSS 4, Vitest 5, Testing Library

## Global Constraints

- Apply the falling-drop animation to `Daily consumption`, `By Project`, and `By Model`.
- Positive deltas use the target project/model color, last exactly 1,200 ms, tilt right, accelerate downward, shrink, and fade on contact.
- Negative corrections use orange `−X.XX` text and fade in place without falling.
- Simultaneously changed stacked projects render separate horizontally offset labels.
- Replace the existing bar halo completely; do not retain brightness or drop-shadow animation.
- Give By Model bars stable per-model colors matching their labels.
- Preserve all bar clicks, transparent full-column click targets, tooltips, axes, stacking, and normal Recharts bar-size transitions.
- Initial loads and context changes remain non-animated; failed refreshes emit no indicator.
- Keep transient labels non-interactive and hidden from accessibility APIs.
- Under `prefers-reduced-motion: reduce`, labels fade in place without translation, rotation, or scaling.
- Do not add live update feedback to the monthly heatmap.
- Do not modify polling, database, Electron main process, preload, IPC, or shared data types.

---

## File Structure

- Create `src/renderer/components/CreditDropLabel.tsx`: reusable SVG delta label for Recharts `LabelList`.
- Create `src/renderer/components/CreditDropLabel.test.tsx`: formatting, color, positioning, animation-mode, and accessibility tests.
- Modify `src/renderer/index.css`: replace halo keyframes with falling-label and reduced-motion keyframes.
- Modify `src/renderer/components/BreakdownChart.tsx`: render stable-colored project/model bars and their labels.
- Modify `src/renderer/components/BreakdownChart.test.tsx`: verify project/model colors, positive/negative labels, reset, and removal.
- Modify `src/renderer/components/ModelsPage.tsx`: enable stable model colors.
- Modify `src/renderer/components/ModelsPage.test.tsx`: verify model chart requests keyed colors.
- Modify `src/renderer/components/TimeSeriesChart.tsx`: render project-colored labels with per-series horizontal offsets.
- Modify `src/renderer/components/TimeSeriesChart.test.tsx`: verify one label per changed segment, offsets, colors, and preserved click targets.

---

### Task 1: Reusable SVG Drop Label

**Files:**
- Create: `src/renderer/components/CreditDropLabel.tsx`
- Create: `src/renderer/components/CreditDropLabel.test.tsx`
- Modify: `src/renderer/index.css`

**Interfaces:**
- Consumes:

```ts
import type { CreditChange } from '../hooks/useCreditChanges';

export interface CreditDropLabelProps {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  change?: CreditChange;
  color: string;
  offsetX?: number;
}
```

- Produces:

```ts
export function CreditDropLabel(props: CreditDropLabelProps): React.JSX.Element | null;
```

- [ ] **Step 1: Write failing component tests**

Test the rendered SVG directly:

```tsx
const { container } = render(
  <svg>
    <CreditDropLabel
      x={20}
      y={40}
      width={30}
      change={{ delta: 2.5, animationKey: 4 }}
      color="#f97316"
      offsetX={3}
    />
  </svg>,
);

const label = container.querySelector('[data-credit-drop="true"]');
expect(label).toHaveTextContent('+2.50');
expect(label).toHaveAttribute('fill', '#f97316');
expect(label).toHaveAttribute('x', '38');
expect(label).toHaveAttribute('y', '34');
expect(label).toHaveAttribute('aria-hidden', 'true');
expect(label).toHaveClass('credit-drop-positive');
```

Add separate tests asserting:

```tsx
expect(renderedNegative).toHaveTextContent('−1.50');
expect(renderedNegative).toHaveAttribute('fill', '#fb923c');
expect(renderedNegative).toHaveClass('credit-drop-negative');
expect(renderWithoutChange.container.querySelector('text')).toBeNull();
```

Also verify invalid/non-numeric Recharts geometry returns `null` instead of
placing text at `NaN`.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
rtk npm test -- src/renderer/components/CreditDropLabel.test.tsx
```

Expected: FAIL because `CreditDropLabel.tsx` does not exist.

- [ ] **Step 3: Implement the SVG label**

Normalize numeric geometry with a small local helper:

```ts
function numeric(value: number | string | undefined): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
```

For valid geometry and a change, render:

```tsx
<text
  key={change.animationKey}
  x={x + width / 2 + offsetX}
  y={Math.max(12, y - 6)}
  fill={change.delta > 0 ? color : '#fb923c'}
  textAnchor="middle"
  aria-hidden="true"
  data-credit-drop="true"
  data-animation-key={change.animationKey}
  className={change.delta > 0 ? 'credit-drop credit-drop-positive' : 'credit-drop credit-drop-negative'}
>
  {change.delta > 0 ? '+' : '−'}
  {Math.abs(change.delta).toFixed(2)}
</text>
```

Set `pointerEvents="none"` so labels never intercept bar clicks.

- [ ] **Step 4: Replace halo CSS with drop CSS**

Remove `credit-chart-highlight`, `credit-chart-highlight-reduced`, and
`.credit-chart-updated`. Add:

```css
@keyframes credit-drop-fall {
  0% { opacity: 0; transform: translateY(-8px) rotate(0deg) scale(1); }
  18% { opacity: 1; transform: translateY(-6px) rotate(0deg) scale(1); }
  65% { opacity: 1; transform: translateY(4px) rotate(10deg) scale(1); }
  100% { opacity: 0; transform: translateY(16px) rotate(14deg) scale(0.55); }
}

@keyframes credit-drop-fade {
  0%, 15% { opacity: 0; }
  30%, 75% { opacity: 1; }
  100% { opacity: 0; }
}

.credit-drop {
  font-size: 12px;
  font-weight: 600;
  paint-order: stroke;
  stroke: var(--color-card);
  stroke-width: 3px;
  stroke-linejoin: round;
  transform-box: fill-box;
  transform-origin: center;
}

.credit-drop-positive { animation: credit-drop-fall 1200ms cubic-bezier(0.2, 0.65, 0.4, 1) both; }
.credit-drop-negative { animation: credit-drop-fade 1200ms ease-out both; }
```

Under reduced motion, set both classes to `credit-drop-fade` and explicitly
use `transform: none` throughout the reduced keyframes.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
rtk npm test -- src/renderer/components/CreditDropLabel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
rtk git add src/renderer/components/CreditDropLabel.tsx src/renderer/components/CreditDropLabel.test.tsx src/renderer/index.css
rtk git commit -m "feat: add falling chart credit labels" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: By Project and By Model Drops

**Files:**
- Modify: `src/renderer/components/BreakdownChart.tsx`
- Modify: `src/renderer/components/BreakdownChart.test.tsx`
- Modify: `src/renderer/components/ModelsPage.tsx`
- Modify: `src/renderer/components/ModelsPage.test.tsx`

**Interfaces:**
- Consumes: `CreditDropLabel` from Task 1 and existing `useCreditChanges`.
- Produces: `LabelList` content for each breakdown bar and stable keyed colors
  for both project and model charts.

- [ ] **Step 1: Write failing breakdown tests**

Update the Recharts test mock to keep bar animations disabled in jsdom while
preserving `LabelList`. Rerender one changed project and assert:

```ts
const drop = container.querySelector('[data-credit-drop="true"]');
expect(drop).toHaveTextContent('+2.00');
expect(drop).toHaveAttribute('fill', getColorForKey('org/repo-a'));
expect(container.querySelector('.credit-chart-updated')).toBeNull();
```

Add tests for a negative correction (`−1.00`, orange,
`credit-drop-negative`), removal after exactly 1,200 ms, and no label after an
`updateContextKey` reset.

Render a By Model chart with two model keys and assert each rectangle uses
`getColorForKey(modelKey)`. In `ModelsPage.test.tsx`, assert the chart's model
bars retain keyed colors through the real page integration.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
rtk npm test -- src/renderer/components/BreakdownChart.test.tsx src/renderer/components/ModelsPage.test.tsx
```

Expected: FAIL because breakdown charts still emit halo classes, have a
1,000 ms duration, and model bars are uniformly cyan.

- [ ] **Step 3: Render labels and stable colors**

Change the tracking duration to:

```ts
const CREDIT_CHART_ANIMATION_DURATION_MS = 1_200;
```

Always render bar cells with stable keyed colors when `colorByKey` is true.
Inside `<Bar>`, retain the existing cells and append:

```tsx
<LabelList
  dataKey="aiuCredits"
  content={(labelProps) => {
    const index = Number(labelProps.index);
    const entry = data[index];
    if (!entry) return null;
    return (
      <CreditDropLabel
        {...labelProps}
        change={changes.get(entry.key)}
        color={getColorForKey(entry.key)}
      />
    );
  }}
/>
```

Remove every `credit-chart-updated` class and `data-credit-updated` attribute.
Add `margin={{ top: 28 }}` to `BarChart` so labels above the tallest bars are
not clipped.

In `ModelsPage.tsx`, pass `colorByKey` to `BreakdownChart`, matching
`ProjectsPage`.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
rtk npm test -- src/renderer/components/CreditDropLabel.test.tsx src/renderer/components/BreakdownChart.test.tsx src/renderer/components/ModelsPage.test.tsx src/renderer/components/ProjectsPage.test.tsx
```

Expected: PASS, including existing bar-click tests.

- [ ] **Step 5: Commit**

```powershell
rtk git add src/renderer/components/BreakdownChart.tsx src/renderer/components/BreakdownChart.test.tsx src/renderer/components/ModelsPage.tsx src/renderer/components/ModelsPage.test.tsx
rtk git commit -m "feat: animate project and model credit additions" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Daily Stacked Drops and Final Validation

**Files:**
- Modify: `src/renderer/components/TimeSeriesChart.tsx`
- Modify: `src/renderer/components/TimeSeriesChart.test.tsx`

**Interfaces:**
- Consumes: `CreditDropLabel`, `getColorForKey`, `projectSegmentKey`, and
  existing date/project `CreditChange` entries.
- Produces: one colored, offset label per changed stacked segment.

- [ ] **Step 1: Write failing stacked-chart tests**

Rerender one date where two projects both increase:

```ts
const next = [{
  date: '2026-09-10',
  aiuCredits: 8,
  byProject: { 'org/repo-a': 3, 'org/repo-b': 5 },
}];
```

Assert two labels exist, contain their exact deltas, have their corresponding
`getColorForKey` fills, and have distinct `x` attributes. Assert no
`.credit-chart-updated` element remains.

Add a single-series fallback test asserting a cyan `+X.XX` label. Update timer
tests from 1,000 to exactly 1,200 ms. Keep and rerun the existing tests proving
that visible bars and transparent full-column backgrounds still call
`onDayClick` with the correct date.

- [ ] **Step 2: Run the time-series tests and verify RED**

Run:

```powershell
rtk npm test -- src/renderer/components/TimeSeriesChart.test.tsx
```

Expected: FAIL because the chart still applies halo markers and renders no SVG
delta labels.

- [ ] **Step 3: Add per-segment `LabelList` labels**

Change the tracking duration to 1,200 ms and set `margin={{ top: 28 }}`.
Inside each stacked `<Bar>`, preserve the existing `Cell` list and append a
`LabelList` whose content resolves the point by index and renders:

```tsx
<CreditDropLabel
  {...labelProps}
  change={changes.get(projectSegmentKey(point.date, projectKey))}
  color={getColorForKey(projectKey)}
  offsetX={(projectIndex - (projectKeys.length - 1) / 2) * 6}
/>
```

For the non-stacked fallback, use `changes.get(point.date)`, color `#22d3ee`,
and offset `0`. Remove halo classes and update attributes from every `Cell`,
but retain the cells themselves, the transparent backgrounds, cursor, and
click handlers.

- [ ] **Step 4: Run all chart and page tests**

Run:

```powershell
rtk npm test -- src/renderer/components/CreditDropLabel.test.tsx src/renderer/components/TimeSeriesChart.test.tsx src/renderer/components/BreakdownChart.test.tsx src/renderer/components/DailyConsumptionPage.test.tsx src/renderer/components/ProjectsPage.test.tsx src/renderer/components/ModelsPage.test.tsx src/renderer/App.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
rtk git add src/renderer/components/TimeSeriesChart.tsx src/renderer/components/TimeSeriesChart.test.tsx
rtk git commit -m "feat: animate daily stacked credit additions" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

- [ ] **Step 6: Run full validation**

Run:

```powershell
rtk npm test
rtk npm run make
rtk git diff origin/master...HEAD --check
rtk git status --short
```

Expected: all tests pass, ZIP and Squirrel artifacts are generated, the diff
has no whitespace errors, and the worktree contains no uncommitted tracked
changes.

If `npm ci --ignore-scripts` was run in a fresh checkout, restore
electron-winstaller's architecture-selected 7-Zip files before `npm run make`:

```powershell
rtk node -e "process.chdir('node_modules\\electron-winstaller'); require(process.cwd() + '\\script\\select-7z-arch.js')"
```
