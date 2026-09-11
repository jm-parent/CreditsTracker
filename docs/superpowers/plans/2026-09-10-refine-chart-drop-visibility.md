# Refine Chart Drop Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chart credit-drop labels slightly larger and keep simultaneous Daily labels closer to the center of their date column.

**Architecture:** Keep the existing `CreditDropLabel` SVG component and `ReferenceDot` positioning unchanged. Adjust only the shared CSS font size and the horizontal spacing multiplier used by Daily stacked labels, with focused component regressions for both values.

**Tech Stack:** React 19, TypeScript, Recharts, CSS, Vitest, Testing Library

## Global Constraints

- Chart drop labels use a 14 px font with the existing semibold weight and contrasting outline.
- Daily simultaneous labels use a 3 px spacing step around the column center.
- `By Project` and `By Model` labels remain exactly centered over their bars.
- Do not change the 1.2-second lifecycle, animation path, colors, negative correction behavior, reduced-motion behavior, polling, or chart interactions.
- Do not add dependencies or modify Electron main-process, preload, IPC, persistence, or shared data types.

---

### Task 1: Enlarge and Recenter Chart Drop Labels

**Files:**
- Modify: `src/renderer/index.css`
- Modify: `src/renderer/components/TimeSeriesChart.tsx`
- Test: `src/renderer/components/CreditDropLabel.test.tsx`
- Test: `src/renderer/components/TimeSeriesChart.test.tsx`

**Interfaces:**
- Consumes: Existing `.credit-drop` CSS class and `CreditDropLabel.offsetX?: number`.
- Produces: 14 px shared drop typography and Daily offsets calculated with a 3 px spacing step.

- [ ] **Step 1: Write the failing typography test**

In `src/renderer/components/CreditDropLabel.test.tsx`, import the renderer stylesheet and assert the rendered label's computed font size:

```tsx
import '../index.css';

it('uses the approved 14 px chart-drop typography', () => {
  const { container } = render(
    <svg>
      <CreditDropLabel
        x={20}
        y={40}
        width={30}
        change={{ delta: 2.5, animationKey: 4 }}
        color="#f97316"
      />
    </svg>,
  );

  const label = container.querySelector('[data-credit-drop="true"]');
  expect(label).not.toBeNull();
  expect(getComputedStyle(label as Element).fontSize).toBe('14px');
});
```

- [ ] **Step 2: Write the failing Daily-centering assertion**

In the existing `renders a distinct, colored, offset label for each project that changed on the same date` test in `src/renderer/components/TimeSeriesChart.test.tsx`, replace the uniqueness-only assertion with an exact 3 px separation:

```tsx
const xPositions = drops.map((drop) => Number(drop.getAttribute('x')));
expect(Math.abs(xPositions[1] - xPositions[0])).toBe(3);
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
rtk npm test -- src/renderer/components/CreditDropLabel.test.tsx src/renderer/components/TimeSeriesChart.test.tsx
```

Expected: FAIL because `.credit-drop` still reports `12px` and the two Daily labels are still separated by `6` pixels.

- [ ] **Step 4: Apply the minimal visual adjustment**

In `src/renderer/index.css`, change only the shared font size:

```css
.credit-drop {
  font-size: 14px;
  font-weight: 600;
}
```

Preserve the existing outline, transform origin, animation declarations, and reduced-motion rules.

In `src/renderer/components/TimeSeriesChart.tsx`, change only the spacing multiplier:

```tsx
offsetX={(projectIndex - (projectKeys.length - 1) / 2) * 3}
```

Do not change persistent project ordering, stack-top calculation, `ReferenceDot`, colors, or keys.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```powershell
rtk npm test -- src/renderer/components/CreditDropLabel.test.tsx src/renderer/components/TimeSeriesChart.test.tsx
```

Expected: both test files pass, including the new 14 px typography assertion and exact 3 px Daily spacing assertion.

- [ ] **Step 6: Run complete validation**

Run:

```powershell
rtk npm test
rtk npm run make
rtk git diff --check
```

Expected: the complete test suite passes, Windows Squirrel artifacts build successfully, and the diff check reports no whitespace errors.

- [ ] **Step 7: Commit the implementation**

```powershell
rtk git add src/renderer/index.css src/renderer/components/TimeSeriesChart.tsx src/renderer/components/CreditDropLabel.test.tsx src/renderer/components/TimeSeriesChart.test.tsx
rtk git commit -m "fix: improve chart credit drop visibility" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```
