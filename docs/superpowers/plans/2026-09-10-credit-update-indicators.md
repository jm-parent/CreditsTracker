# Credit Update Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Scope Amendment (2026-09-10):** Task 5 below ("Monthly Heatmap
> Highlights") was completed as written and then explicitly reverted the same
> day after review. The monthly activity heatmap is out of scope for live
> update feedback; see the "Monthly Heatmap Highlights" task for the reverted
> steps and the amendment note at its end for what shipped instead. Every
> other task's heatmap-adjacent statements below (Goal, Architecture, Global
> Constraints, File Structure) describe the plan as originally approved and
> are historical for the heatmap specifically — they no longer describe the
> current, shipped behavior of `ActivityHeatmapPage`.

**Goal:** Show a transient `+X` or negative correction beside updated credit values and highlight only the chart bars or heatmap cells whose values changed.

**Architecture:** A renderer-only hook compares keyed numeric snapshots and exposes transient changes without modifying polling or shared data types. A reusable `CreditValue` component renders numeric deltas, while Recharts cells and heatmap buttons consume the same keyed-change output for targeted highlights. Page-level context keys prevent filter, navigation, and month changes from looking like incoming usage.

**Tech Stack:** React 19, TypeScript 7, Tailwind CSS 4, Recharts 3, Vitest 5, Testing Library

## Global Constraints

- Keep the existing five-second polling interval unchanged.
- Do not modify the database, Electron main process, preload API, IPC handlers, or shared data types.
- Animate AIU credit values only; tokens and request counts remain static.
- Numeric deltas remain visible for 1,500 ms; chart and heatmap highlights remain visible for 1,000 ms.
- Initial data, filter changes, page changes, project changes, and month changes establish a baseline without animation.
- Failed refreshes retain the previous successful baseline and emit no animation.
- Respect `prefers-reduced-motion: reduce` and keep transient indicators hidden from accessibility APIs.
- Use Conventional Commits and include the repository-required `Co-authored-by` trailer.

---

## File Structure

- Create `src/renderer/hooks/useCreditChanges.ts`: compare keyed values across successful snapshots, reset safely across contexts, and expire transient changes.
- Create `src/renderer/hooks/useCreditChanges.test.ts`: fake-timer coverage for baselines, resets, positive and negative changes, successive updates, and cleanup.
- Create `src/renderer/components/CreditValue.tsx`: render a formatted credit value plus an inaccessible transient delta.
- Create `src/renderer/components/CreditValue.test.tsx`: presentation, sign, replacement, and accessibility assertions.
- Modify `src/renderer/index.css`: define numeric and graphical update animations plus reduced-motion overrides.
- Modify `src/renderer/App.tsx`: derive stable usage and monthly context keys and pass them to page components.
- Modify `src/renderer/components/DailyConsumptionPage.tsx`: pass context to summary cards and the time-series chart.
- Modify `src/renderer/components/ProjectsPage.tsx`: pass context to project summary, chart, and table.
- Modify `src/renderer/components/ModelsPage.tsx`: pass context to model summary, chart, and table.
- Modify `src/renderer/components/ProjectDetailPage.tsx`: derive a project-detail context key for the shared credit displays.
- Modify `src/renderer/components/SummaryCards.tsx`: use `CreditValue` for total AIU credits.
- Modify `src/renderer/components/BreakdownSummaryCards.tsx`: use `CreditValue` for total and top-entry credits.
- Modify `src/renderer/components/SessionsTable.tsx`: track project rows by project key and use `CreditValue`.
- Modify `src/renderer/components/ModelTable.tsx`: track model rows by model key and use `CreditValue`.
- Modify `src/renderer/components/ConversationsTable.tsx`: track conversations by session ID and use `CreditValue`.
- Modify `src/renderer/components/TimeSeriesChart.tsx`: highlight changed date/project segments.
- Modify `src/renderer/components/BreakdownChart.tsx`: highlight changed project or model bars.
- Modify `src/renderer/components/ActivityHeatmapPage.tsx`: highlight changed day cells and reset by displayed month. **Reverted 2026-09-10** — see the Scope Amendment note under Task 5.
- Modify the matching component tests to cover integration and preserve existing behavior.

---

### Task 1: Keyed Credit Change Tracker

**Files:**
- Create: `src/renderer/hooks/useCreditChanges.ts`
- Create: `src/renderer/hooks/useCreditChanges.test.ts`

**Interfaces:**
- Consumes: a successful snapshot identity, a context reset key, and keyed numeric values.
- Produces:

```ts
export interface CreditDatum {
  key: string;
  value: number;
}

export interface CreditChange {
  delta: number;
  animationKey: number;
}

export function useCreditChanges(
  snapshot: object,
  values: readonly CreditDatum[],
  resetKey: string,
  durationMs: number,
): ReadonlyMap<string, CreditChange>;
```

- [ ] **Step 1: Write failing hook tests**

Create tests with `renderHook`, `act`, and `vi.useFakeTimers()` that prove:

```ts
const initial = { rows: [{ key: 'a', value: 10 }] };
const { result, rerender, unmount } = renderHook(
  ({ snapshot, values, resetKey }) =>
    useCreditChanges(snapshot, values, resetKey, 1_500),
  {
    initialProps: {
      snapshot: initial,
      values: initial.rows,
      resetKey: 'all-projects',
    },
  },
);

expect(result.current.size).toBe(0);

const increased = { rows: [{ key: 'a', value: 12.5 }] };
rerender({
  snapshot: increased,
  values: increased.rows,
  resetKey: 'all-projects',
});
expect(result.current.get('a')?.delta).toBe(2.5);

act(() => vi.advanceTimersByTime(1_500));
expect(result.current.size).toBe(0);

const corrected = { rows: [{ key: 'a', value: 11 }] };
rerender({
  snapshot: corrected,
  values: corrected.rows,
  resetKey: 'all-projects',
});
expect(result.current.get('a')?.delta).toBe(-1.5);
```

Add separate tests showing that a changed `resetKey` ignores the currently
displayed stale snapshot and the first new snapshot, that a second update in
the same context emits a delta, that a successive update replaces the old
delta and increments `animationKey`, and that unmounting clears the timer.

- [ ] **Step 2: Run the hook test and verify the expected failure**

Run:

```powershell
rtk npm test -- src/renderer/hooks/useCreditChanges.test.ts
```

Expected: FAIL because `useCreditChanges.ts` does not exist.

- [ ] **Step 3: Implement the change tracker**

Implement the hook with:

```ts
const previousValuesRef = useRef<ReadonlyMap<string, number> | null>(null);
const previousSnapshotRef = useRef<object | null>(null);
const resetKeyRef = useRef(resetKey);
const awaitingFreshSnapshotRef = useRef(false);
const animationKeyRef = useRef(0);
const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const [changes, setChanges] = useState<ReadonlyMap<string, CreditChange>>(new Map());
```

Use an effect keyed by `snapshot`, `resetKey`, and `durationMs`. On the first
snapshot, store `new Map(values.map(({ key, value }) => [key, value]))` and
emit nothing. When `resetKey` changes, remember the current `snapshot`, clear
changes and timers, and wait for a different snapshot reference; that first
fresh snapshot becomes the new baseline. For ordinary fresh snapshots, compare
matching keys with `Object.is`, emit only non-zero finite deltas, replace the
previous map, increment `animationKey`, and schedule one cleanup timer.

Do not treat new keys as deltas because they have no prior value. Removed keys
simply disappear from the baseline. Return cleanup that cancels the active
timer on unmount.

- [ ] **Step 4: Run the hook tests**

Run:

```powershell
rtk npm test -- src/renderer/hooks/useCreditChanges.test.ts
```

Expected: PASS with all change-tracking cases green.

- [ ] **Step 5: Commit**

```powershell
rtk git add src/renderer/hooks/useCreditChanges.ts src/renderer/hooks/useCreditChanges.test.ts
rtk git commit -m "feat: track transient credit changes" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Reusable Numeric Credit Indicator

**Files:**
- Create: `src/renderer/components/CreditValue.tsx`
- Create: `src/renderer/components/CreditValue.test.tsx`
- Modify: `src/renderer/index.css`

**Interfaces:**
- Consumes: `CreditChange` from Task 1.
- Produces:

```ts
export interface CreditValueProps {
  value: number;
  change?: CreditChange;
  className?: string;
  suffix?: string;
}

export function CreditValue(props: CreditValueProps): React.JSX.Element;
```

- [ ] **Step 1: Write failing component tests**

Cover the final value, positive and negative formatting, replacement through a
changed React key, suffix rendering, and accessibility:

```tsx
render(
  <CreditValue
    value={12.5}
    change={{ delta: 2.5, animationKey: 1 }}
    suffix=" credits"
  />,
);

expect(screen.getByText('12.50')).toBeInTheDocument();
expect(screen.getByText('+2.50')).toHaveAttribute('aria-hidden', 'true');
expect(screen.getByText('credits')).toBeInTheDocument();
```

For a negative change, assert `−1.50` using the Unicode minus sign and the
`credit-delta-negative` class. Assert that no delta node exists when `change`
is omitted.

- [ ] **Step 2: Run the component test and verify the expected failure**

Run:

```powershell
rtk npm test -- src/renderer/components/CreditValue.test.tsx
```

Expected: FAIL because `CreditValue.tsx` does not exist.

- [ ] **Step 3: Implement `CreditValue` and animations**

Render the value and overlay the optional delta without layout shift:

```tsx
<span className={cn('credit-value inline-flex items-baseline', className)}>
  <span>{value.toFixed(2)}</span>
  {change && (
    <span
      key={change.animationKey}
      aria-hidden="true"
      className={cn(
        'credit-delta pointer-events-none absolute left-full ml-2 whitespace-nowrap text-xs font-medium',
        change.delta > 0 ? 'credit-delta-positive' : 'credit-delta-negative',
      )}
    >
      {change.delta > 0 ? '+' : '−'}
      {Math.abs(change.delta).toFixed(2)}
    </span>
  )}
  {suffix && <span>{suffix}</span>}
</span>
```

Add CSS keyframes:

```css
@keyframes credit-delta-in-out {
  0% { opacity: 0; transform: translateY(4px); }
  15%, 75% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-3px); }
}

.credit-value { position: relative; }
.credit-delta { animation: credit-delta-in-out 1500ms ease-out both; }
.credit-delta-positive { color: #4ade80; }
.credit-delta-negative { color: #fb923c; }
```

Add a `@media (prefers-reduced-motion: reduce)` rule that removes transforms
and uses opacity-only keyframes for `.credit-delta`.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
rtk npm test -- src/renderer/components/CreditValue.test.tsx src/renderer/hooks/useCreditChanges.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
rtk git add src/renderer/components/CreditValue.tsx src/renderer/components/CreditValue.test.tsx src/renderer/index.css
rtk git commit -m "feat: display transient credit deltas" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Numeric Indicators in Cards and Tables

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/DailyConsumptionPage.tsx`
- Modify: `src/renderer/components/ProjectsPage.tsx`
- Modify: `src/renderer/components/ModelsPage.tsx`
- Modify: `src/renderer/components/ProjectDetailPage.tsx`
- Modify: `src/renderer/components/SummaryCards.tsx`
- Modify: `src/renderer/components/BreakdownSummaryCards.tsx`
- Modify: `src/renderer/components/SessionsTable.tsx`
- Modify: `src/renderer/components/ModelTable.tsx`
- Modify: `src/renderer/components/ConversationsTable.tsx`
- Test: matching `*.test.tsx` files for every modified component

**Interfaces:**
- Consumes: `useCreditChanges` and `CreditValue` from Tasks 1-2.
- Produces: a required `updateContextKey: string` prop on pages and credit
  display components.

- [ ] **Step 1: Write failing integration tests**

For `SummaryCards`, render and rerender with stable and changed totals:

```tsx
const first = { aiuCredits: 10, tokens: 100, requests: 1 };
const { rerender } = render(
  <SummaryCards totals={first} updateContextKey="all" />,
);
expect(screen.queryByText('+2.50')).not.toBeInTheDocument();

const second = { aiuCredits: 12.5, tokens: 200, requests: 2 };
rerender(<SummaryCards totals={second} updateContextKey="all" />);
expect(screen.getByText('+2.50')).toBeInTheDocument();
expect(screen.queryByText('+100.00')).not.toBeInTheDocument();
```

For `SessionsTable` and `ModelTable`, update two keyed rows so sorting changes
their positions, then assert each delta remains in the row identified through
`within(screen.getByText(rowKey).closest('tr')!)`.

For `BreakdownSummaryCards`, assert total and top-credit deltas independently.
For `ConversationsTable`, assert tracking by `sessionId`. Add a reset test that
changes `updateContextKey`, rerenders with a new snapshot, and observes no
delta.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```powershell
rtk npm test -- src/renderer/components/SummaryCards.test.tsx src/renderer/components/BreakdownSummaryCards.test.tsx src/renderer/components/SessionsTable.test.tsx src/renderer/components/ModelTable.test.tsx src/renderer/components/ConversationsTable.test.tsx
```

Expected: FAIL because the new context props and indicators are absent.

- [ ] **Step 3: Wire stable context keys through pages**

In `App.tsx`, derive:

```ts
const usageUpdateContextKey = JSON.stringify({
  project: filters.project ?? null,
  model: filters.model ?? null,
  from: filters.from ?? null,
  to: filters.to ?? null,
});
const monthlyUpdateContextKey = JSON.stringify({
  ...JSON.parse(usageUpdateContextKey),
  year: activityMonth.year,
  month: activityMonth.month,
});
```

Pass `usageUpdateContextKey` to `DailyConsumptionPage`, `ProjectsPage`, and
`ModelsPage`; pass `monthlyUpdateContextKey` to `ActivityHeatmapPage`.
Within `ProjectDetailPage`, build a context key from `project` and the same
filter fields and pass it to `SummaryCards` and `ConversationsTable`.

- [ ] **Step 4: Replace raw credit text with `CreditValue`**

Each component calls `useCreditChanges` once per incoming snapshot and maps
stable keys:

```ts
const changes = useCreditChanges(
  rows,
  rows.map((row) => ({ key: row.key, value: row.aiuCredits })),
  updateContextKey,
  1_500,
);
```

Then render:

```tsx
<CreditValue value={row.aiuCredits} change={changes.get(row.key)} />
```

Use the fixed key `total` for aggregate cards, the displayed `topKey` for
top-entry credits, project/model keys in their tables, and `sessionId` in
conversations. A newly promoted top entry therefore establishes its own
baseline instead of comparing two unrelated entities. Keep token and request
markup unchanged. Preserve all existing labels, table roles, sort handlers,
and visible formatting.

- [ ] **Step 5: Run the component and page tests**

Run:

```powershell
rtk npm test -- src/renderer/components/SummaryCards.test.tsx src/renderer/components/BreakdownSummaryCards.test.tsx src/renderer/components/SessionsTable.test.tsx src/renderer/components/ModelTable.test.tsx src/renderer/components/ConversationsTable.test.tsx src/renderer/components/DailyConsumptionPage.test.tsx src/renderer/components/ProjectsPage.test.tsx src/renderer/components/ModelsPage.test.tsx src/renderer/components/ProjectDetailPage.test.tsx src/renderer/App.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
rtk git add src/renderer/App.tsx src/renderer/components/DailyConsumptionPage.tsx src/renderer/components/DailyConsumptionPage.test.tsx src/renderer/components/ProjectsPage.tsx src/renderer/components/ProjectsPage.test.tsx src/renderer/components/ModelsPage.tsx src/renderer/components/ModelsPage.test.tsx src/renderer/components/ProjectDetailPage.tsx src/renderer/components/ProjectDetailPage.test.tsx src/renderer/components/SummaryCards.tsx src/renderer/components/SummaryCards.test.tsx src/renderer/components/BreakdownSummaryCards.tsx src/renderer/components/BreakdownSummaryCards.test.tsx src/renderer/components/SessionsTable.tsx src/renderer/components/SessionsTable.test.tsx src/renderer/components/ModelTable.tsx src/renderer/components/ModelTable.test.tsx src/renderer/components/ConversationsTable.tsx src/renderer/components/ConversationsTable.test.tsx
rtk git commit -m "feat: show credit deltas across dashboard values" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Targeted Bar Chart Highlights

**Files:**
- Modify: `src/renderer/components/TimeSeriesChart.tsx`
- Modify: `src/renderer/components/TimeSeriesChart.test.tsx`
- Modify: `src/renderer/components/BreakdownChart.tsx`
- Modify: `src/renderer/components/BreakdownChart.test.tsx`
- Modify: `src/renderer/index.css`

**Interfaces:**
- Consumes: `useCreditChanges` from Task 1 and `updateContextKey: string`.
- Produces: `data-credit-updated="true"` on only the changed Recharts `Cell`
  elements.

- [ ] **Step 1: Write failing chart tests**

Rerender each chart with a new array reference in the same context. For the
breakdown chart, change one keyed value and assert only one element has
`data-credit-updated="true"`.

For the stacked time-series chart, change one project contribution on one date:

```tsx
const next = [
  {
    date: '2026-09-01',
    aiuCredits: 4,
    byProject: { 'org/repo-a': 2, 'org/repo-b': 2 },
  },
];
```

Assert that the `org/repo-a` segment on `2026-09-01` is marked while the
unchanged `org/repo-b` segment is not. Advance fake timers by 1,000 ms and
assert all update markers are removed. Also assert no markers on initial
render or after `updateContextKey` changes.

- [ ] **Step 2: Run chart tests and verify they fail**

Run:

```powershell
rtk npm test -- src/renderer/components/TimeSeriesChart.test.tsx src/renderer/components/BreakdownChart.test.tsx
```

Expected: FAIL because chart cells do not expose update state.

- [ ] **Step 3: Add keyed chart comparisons**

For breakdown data, compare:

```ts
data.map(({ key, aiuCredits }) => ({ key, value: aiuCredits }))
```

For time-series data with project stacks, compare segment keys:

```ts
data.flatMap((point) =>
  projectKeys.map((projectKey) => ({
    key: `${point.date}\u0000${projectKey}`,
    value: point.byProject?.[projectKey] ?? 0,
  })),
)
```

For non-stacked data, compare by date. Render a `<Cell>` for each data point
inside each `<Bar>`, preserving existing `fill`, `background`, cursor, and
click behavior. Apply `className="credit-chart-updated"` and
`data-credit-updated="true"` only when the matching key exists in the change
map.

- [ ] **Step 4: Add the graphical animation**

Append:

```css
@keyframes credit-chart-highlight {
  0% { filter: brightness(1) drop-shadow(0 0 0 transparent); }
  25%, 70% { filter: brightness(1.3) drop-shadow(0 0 6px #4ade80); }
  100% { filter: brightness(1) drop-shadow(0 0 0 transparent); }
}

.credit-chart-updated {
  animation: credit-chart-highlight 1000ms ease-out both;
}
```

In the existing reduced-motion media query, disable the glow animation and
apply a brief opacity/color emphasis without transform or geometry changes.

- [ ] **Step 5: Run chart tests**

Run:

```powershell
rtk npm test -- src/renderer/components/TimeSeriesChart.test.tsx src/renderer/components/BreakdownChart.test.tsx
```

Expected: PASS, including all existing click-target tests.

- [ ] **Step 6: Commit**

```powershell
rtk git add src/renderer/components/TimeSeriesChart.tsx src/renderer/components/TimeSeriesChart.test.tsx src/renderer/components/BreakdownChart.tsx src/renderer/components/BreakdownChart.test.tsx src/renderer/index.css
rtk git commit -m "feat: highlight updated chart bars" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Monthly Heatmap Highlights (completed, then reverted — see amendment)

**Files:**
- Modify: `src/renderer/components/ActivityHeatmapPage.tsx`
- Modify: `src/renderer/components/ActivityHeatmapPage.test.tsx`
- Modify: `src/renderer/index.css`

**Interfaces:**
- Consumes: `useCreditChanges`, the monthly `updateContextKey`, and existing
  date-keyed `TimeSeriesPoint[]`.
- Produces: a transient `credit-heatmap-updated` class and
  `data-credit-updated="true"` on changed day buttons, plus numeric deltas for
  the busiest and quietest credit values.

- [ ] **Step 1: Write failing heatmap tests**

Render September data, rerender a new September snapshot with only September 15
changed, and assert:

```ts
expect(
  screen.getByRole('button', { name: 'September 15, 2026: 2.00 credits' }),
).toHaveAttribute('data-credit-updated', 'true');
expect(
  screen.getByRole('button', { name: 'September 1, 2026: 12.30 credits' }),
).not.toHaveAttribute('data-credit-updated');
```

Assert that an updated busiest or quietest day shows the matching numeric
delta through `CreditValue`. Advance 1,000 ms and assert the cell marker
clears; advance to 1,500 ms and assert the numeric delta clears. Change the
context key to October, rerender October data, and assert no October cell or
summary value is marked.

- [ ] **Step 2: Run the heatmap test and verify it fails**

Run:

```powershell
rtk npm test -- src/renderer/components/ActivityHeatmapPage.test.tsx
```

Expected: FAIL because changed cells are not marked.

- [ ] **Step 3: Integrate keyed day tracking**

Call:

```ts
const changes = useCreditChanges(
  data,
  data.map((point) => ({ key: point.date, value: point.aiuCredits })),
  updateContextKey,
  1_000,
);
```

On each real day button, add `credit-heatmap-updated` and
`data-credit-updated="true"` only when `changes.has(cell.date)`. Do not alter
the existing inline intensity colors, labels, titles, navigation handlers, or
legend swatches.

Call `useCreditChanges` a second time with the same date-keyed values and a
1,500 ms duration for numeric presentation. Replace the raw busiest and
quietest credit strings with `CreditValue`, using
`numericChanges.get(busiest.date)` and `numericChanges.get(quietest.date)`.
When the identity of the busiest or quietest day changes, its new date key has
no previous value and therefore emits no misleading cross-day delta.

- [ ] **Step 4: Add heatmap-specific glow CSS**

Reuse the chart highlight timing but use `box-shadow` instead of SVG
`drop-shadow`:

```css
@keyframes credit-heatmap-highlight {
  0%, 100% { box-shadow: 0 0 0 transparent; }
  25%, 70% { box-shadow: 0 0 0 2px #4ade80, 0 0 10px #4ade8080; }
}

.credit-heatmap-updated {
  animation: credit-heatmap-highlight 1000ms ease-out both;
}
```

Provide an opacity-only reduced-motion override.

- [ ] **Step 5: Run heatmap and application tests**

Run:

```powershell
rtk npm test -- src/renderer/components/ActivityHeatmapPage.test.tsx src/renderer/App.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
rtk git add src/renderer/components/ActivityHeatmapPage.tsx src/renderer/components/ActivityHeatmapPage.test.tsx src/renderer/index.css
rtk git commit -m "feat: highlight updated heatmap days" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

**Scope Amendment (2026-09-10):** Steps 1-6 above were completed exactly as
written and committed as `feat: highlight updated heatmap days`. Later the
same day, after further review, the user narrowed scope: the monthly heatmap
page must have **no** live visual update feedback at all. That decision was
implemented in a follow-up change (`refactor: remove live heatmap update
indicators`), which:

- Removed the `updateContextKey` prop from `ActivityHeatmapPageProps` and the
  two `useCreditChanges` calls (cell and numeric) from `ActivityHeatmapPage`.
- Removed the `credit-heatmap-updated` class and `data-credit-updated`
  attribute from day-cell buttons; cells render with only their intensity
  style, label, and title as before this task.
- Replaced the `CreditValue`-based busiest/quietest summary values with plain
  `{value.toFixed(2)} credits` text, restoring the pre-Task-5 presentation.
- Removed the `credit-heatmap-highlight` / `credit-heatmap-highlight-reduced`
  keyframes, the `.credit-heatmap-updated` rule, and its reduced-motion
  override from `src/renderer/index.css`. The shared `.credit-delta` and
  `.credit-chart-updated` rules used elsewhere were left untouched.
- Removed `monthlyUpdateContextKey` from `App.tsx` and restored
  `data={monthlyActivity.data ?? []}` (a non-nullable
  `TimeSeriesPoint[]` prop contract), since the nullable-data guard existed
  only to keep the first successful month response from being misread as an
  all-zero baseline by the now-removed tracker.
- Rewrote `ActivityHeatmapPage.test.tsx` to assert the opposite of Step 1's
  tests: a rerender with changed monthly data must never add
  `data-credit-updated`, a `credit-heatmap-updated` class, or a `+X`/`−X`
  CreditValue delta, while the data, summaries, intensity colors, navigation,
  and loading/error behavior asserted by the original (pre-Task-5) tests keep
  passing.

The steps above (1-6) are left as written to preserve an accurate record of
what was built and reviewed for this task; they no longer describe the
current behavior of `ActivityHeatmapPage`. This also renders moot the
final-review concern (recorded in `.superpowers/sdd/2026-09-10-credit-update-indicators/final-fix-report.md`)
about navigating to the Monthly tab while a usage-filter refresh is pending:
with no indicator tracker mounted on that page, there is nothing there left
to misattribute a cross-context delta.

---

### Task 6: Full Regression and Build Validation

**Files:**
- Modify only files required to correct failures caused by Tasks 1-5.

**Interfaces:**
- Consumes: the completed renderer indicators.
- Produces: a tested, type-safe packaged application.

- [ ] **Step 1: Run the full test suite**

Run:

```powershell
rtk npm test
```

Expected: all Vitest files and tests PASS with zero failures.

- [ ] **Step 2: Build the Windows package**

Run:

```powershell
rtk npm run make
```

Expected: exit code 0 and a Windows x64 ZIP under
`out/make/zip/win32/x64/`.

- [ ] **Step 3: Inspect the final diff**

Run:

```powershell
rtk git diff master...HEAD --check
rtk git status --short
```

Expected: no whitespace errors and no uncommitted source or test changes.

- [ ] **Step 4: Commit any validation-only correction**

Only if Steps 1-3 required a source correction:

```powershell
rtk git add src/renderer
rtk git commit -m "fix: correct credit update indicator regression" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

If no correction was required, do not create an empty commit.
