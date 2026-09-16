# Daily Consumption Project Path Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the exact project selector with a live, case-insensitive project-path substring filter that keeps every usage view and metric backed by the same server-filtered dataset.

**Architecture:** Extend the shared filter contract with `projectSearch` while preserving the exact `project` filter used by project detail. Apply one literal substring predicate in the shared SQLite `buildWhereClause`, and thread the new value through the existing React filter bar, data hooks, monthly request, and chart update context. No new IPC method or dependency is needed.

**Tech Stack:** TypeScript, React 19, Electron/Vite, better-sqlite3, Vitest, React Testing Library, Testing Library user-event.

## Global Constraints

- Search is a case-insensitive substring of `COALESCE(s.repository, s.cwd)`.
- The search is sent on every non-empty text change; there is no debounce.
- Empty or whitespace-only input removes `projectSearch` and restores all projects.
- The project selector is replaced by a `Project path` text input; the model selector remains.
- The project-path input is hidden when `showProjectFilter` is false.
- The existing exact `project` filter remains available for project detail.
- Use `instr(lower(COALESCE(s.repository, s.cwd)), lower(@projectSearch)) > 0` rather than `LIKE` so wildcard characters and Windows backslashes remain literal.
- Preserve existing request cancellation, last-known-data behavior, polling, error logging, and no-data messages.
- Do not add an export surface, a debounce, a new IPC method, or unrelated refactoring.
- Keep the existing Node 24 / npm / Vitest setup; add no dependencies.

## File map

- Modify `src/shared/types.ts`: add `projectSearch` to `UsageFilters` and `MonthlyActivityParams`.
- Modify `src/main/db.ts`: add the trimmed project-path predicate to `buildWhereClause`, which is reused by all usage queries.
- Modify `src/main/db.test.ts`: verify partial, case-insensitive, literal path matching and no-match behavior across usage query consumers.
- Modify `src/renderer/components/FilterBar.tsx`: replace the project select with the labeled text input and keep model filtering unchanged.
- Modify `src/renderer/components/FilterBar.test.tsx`: verify input rendering, live updates, clearing, and detail-page hiding.
- Modify `src/renderer/hooks/useUsageData.ts`: re-fetch usage when `projectSearch` changes.
- Modify `src/renderer/hooks/useHourlyDetail.ts`: re-fetch hourly data when `projectSearch` changes.
- Create `src/renderer/hooks/useHourlyDetail.test.ts`: cover the new hourly filter dependency.
- Modify `src/renderer/hooks/useMonthlyActivity.ts`: re-fetch monthly data when `projectSearch` changes.
- Modify `src/renderer/hooks/useMonthlyActivity.test.ts`: verify the new monthly request parameter and dependency.
- Modify `src/renderer/hooks/useProjectDetail.ts`: re-fetch project detail when `projectSearch` changes.
- Modify `src/renderer/hooks/useProjectDetail.test.ts`: verify the new project-detail request parameter and dependency.
- Modify `src/renderer/hooks/useUsageData.test.ts`: verify the new usage request parameter and dependency.
- Modify `src/renderer/App.tsx`: pass `projectSearch` to monthly activity and include it in the chart update context.
- Modify `src/renderer/App.test.tsx`: verify that typing in the global path field forwards the live filter.

---

### Task 1: Add the shared project-path filter to SQLite queries

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/db.ts`
- Test: `src/main/db.test.ts`

**Interfaces:**
- Consumes: `UsageFilters` in `buildWhereClause`, `getUsage`, `getHourlyDetail`, `getMonthlyActivity`, and `getProjectDetail`.
- Produces: `UsageFilters.projectSearch?: string` and `MonthlyActivityParams.projectSearch?: string`; all existing database query functions accept the new field through their existing parameter types.

- [ ] **Step 1: Write failing database tests for partial project-path search**

Add cases to the existing `getUsage` filtering test (or a focused adjacent test) using `seedSchemaAndFixtures`:

```ts
const repositoryMatch = getUsage(db, { projectSearch: 'REPO-A' });
expect(repositoryMatch.totals).toEqual({ aiuCredits: 3, tokens: 120, requests: 1 });
expect(repositoryMatch.byProject).toEqual([{ key: 'org/repo-a', aiuCredits: 3 }]);

const cwdFallbackMatch = getUsage(db, { projectSearch: 'REPO-B' });
expect(cwdFallbackMatch.totals).toEqual({ aiuCredits: 1, tokens: 60, requests: 1 });
expect(cwdFallbackMatch.byProject).toEqual([{ key: 'C:/repo-b', aiuCredits: 1 }]);

const literalWildcard = getUsage(db, { projectSearch: 'repo-%' });
expect(literalWildcard.totals).toEqual({ aiuCredits: 0, tokens: 0, requests: 0 });

const noMatch = getUsage(db, { projectSearch: 'does-not-exist' });
expect(noMatch.totals).toEqual({ aiuCredits: 0, tokens: 0, requests: 0 });
expect(noMatch.timeSeries).toEqual([]);
```

Also extend the existing filtered consumer tests so the shared predicate is
proven to reach the other views:

```ts
expect(getHourlyDetail(db, { date: '2026-09-01', projectSearch: 'repo-a' })).toEqual([
  { hour: localHourLabel('2026-09-01 10:00:05'), aiuCredits: 3, byProject: { 'org/repo-a': 3 } },
]);

expect(getMonthlyActivity(db, { year: 2026, month: 9, projectSearch: 'repo-b' })).toEqual([
  { date: '2026-09-03', aiuCredits: 1 },
]);
```

For project detail, add a request that combines the exact project and the
search field and assert that it still returns the matching project data:

```ts
const result = getProjectDetail(db, {
  project: 'org/repo-a',
  projectSearch: 'repo-a',
});
expect(result.totals).toEqual({ aiuCredits: 3.5, tokens: 215, requests: 3 });
```

- [ ] **Step 2: Run the database tests and verify they fail**

Run:

```powershell
rtk npm test -- src/main/db.test.ts
```

Expected: FAIL because the shared filter types and `buildWhereClause` do not
yet recognize or apply `projectSearch`.

- [ ] **Step 3: Add the shared filter fields**

In `src/shared/types.ts`, extend the interfaces without removing existing
fields:

```ts
export interface UsageFilters {
  project?: string;
  projectSearch?: string;
  model?: string;
  from?: string;
  to?: string;
}

export interface MonthlyActivityParams {
  year: number;
  month: number;
  project?: string;
  projectSearch?: string;
  model?: string;
}
```

Retain the existing date-field comments and surrounding type documentation.

- [ ] **Step 4: Implement the literal, case-insensitive predicate**

In `buildWhereClause` in `src/main/db.ts`, after the exact `project` condition
and before the model/date conditions, normalize the optional search value and
add a bound parameter:

```ts
const projectSearch = filters.projectSearch?.trim();
if (projectSearch) {
  conditions.push(
    'instr(lower(COALESCE(s.repository, s.cwd)), lower(@projectSearch)) > 0',
  );
  params.projectSearch = projectSearch;
}
```

Keep the existing exact `project` condition intact. Because every database
consumer already calls `buildWhereClause`, do not duplicate the predicate in
the individual query functions.

- [ ] **Step 5: Run the database tests and verify they pass**

Run:

```powershell
rtk npm test -- src/main/db.test.ts
```

Expected: PASS for the existing database suite, including the new repository,
cwd fallback, case-insensitive, literal wildcard, no-match, hourly, monthly,
and project-detail assertions.

- [ ] **Step 6: Commit the shared query change**

```powershell
rtk git add src/shared/types.ts src/main/db.ts src/main/db.test.ts
rtk git commit -m "feat: filter usage by project path" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

The commit must include the repository's required Copilot co-author trailer.

### Task 2: Replace the project selector and propagate the filter through hooks

**Files:**
- Modify: `src/renderer/components/FilterBar.tsx`
- Modify: `src/renderer/components/FilterBar.test.tsx`
- Modify: `src/renderer/hooks/useUsageData.ts`
- Modify: `src/renderer/hooks/useUsageData.test.ts`
- Modify: `src/renderer/hooks/useHourlyDetail.ts`
- Create: `src/renderer/hooks/useHourlyDetail.test.ts`
- Modify: `src/renderer/hooks/useMonthlyActivity.ts`
- Modify: `src/renderer/hooks/useMonthlyActivity.test.ts`
- Modify: `src/renderer/hooks/useProjectDetail.ts`
- Modify: `src/renderer/hooks/useProjectDetail.test.ts`

**Interfaces:**
- Consumes: `UsageFilters.projectSearch` and `MonthlyActivityParams.projectSearch` from Task 1.
- Produces: `FilterBar` emits `UsageFilters` with `projectSearch`; all four hooks include it in their effect dependency lists and forward it through existing IPC calls.

- [ ] **Step 1: Write failing component and hook tests**

Update `src/renderer/components/FilterBar.test.tsx` to assert the new
control and its live behavior:

```tsx
it('renders a project path input and the model options', () => {
  render(<FilterBar options={options} filters={{}} onChange={vi.fn()} />);

  expect(screen.getByLabelText('Project path')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Search project path')).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'gpt-5.4' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'org/repo-a' })).not.toBeInTheDocument();
});

it('emits the project path search on every text change and clears it', async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<FilterBar options={options} filters={{}} onChange={onChange} />);

  const input = screen.getByLabelText('Project path');
  await user.type(input, 'repo-a');
  expect(onChange).toHaveBeenLastCalledWith({ projectSearch: 'repo-a' });

  await user.clear(input);
  expect(onChange).toHaveBeenLastCalledWith({});
});

it('does not keep a whitespace-only search filter', async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<FilterBar options={options} filters={{}} onChange={onChange} />);

  await user.type(screen.getByLabelText('Project path'), '   ');
  expect(onChange).toHaveBeenLastCalledWith({});
});

it('hides the project path input when showProjectFilter is false', () => {
  render(<FilterBar options={options} filters={{}} onChange={vi.fn()} showProjectFilter={false} />);

  expect(screen.queryByLabelText('Project path')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Model')).toBeInTheDocument();
});
```

Update the existing model test to use the unchanged model selector and
remove the old exact-project select test.

Extend `useUsageData.test.ts` with a rerender from `{}` to
`{ projectSearch: 'repo-a' }` and assert:

```ts
expect(window.api.getUsage).toHaveBeenLastCalledWith({ projectSearch: 'repo-a' });
```

Extend `useMonthlyActivity.test.ts` with a rerender to
`{ year: 2026, month: 9, projectSearch: 'repo-a' }` and assert that exact
object is sent to `getMonthlyActivity`.

Extend `useProjectDetail.test.ts` with a rerender to
`{ projectSearch: 'repo-a' }` and assert:

```ts
expect(window.api.getProjectDetail).toHaveBeenLastCalledWith({
  project: 'org/repo-a',
  projectSearch: 'repo-a',
});
```

Create `src/renderer/hooks/useHourlyDetail.test.ts` using the existing hook
test setup pattern. Mock `getHourlyDetail` with an empty array, render with
`date = '2026-09-01'` and `{ projectSearch: 'repo-a' }`, wait for loading to
finish, and assert:

```ts
expect(window.api.getHourlyDetail).toHaveBeenCalledWith({
  date: '2026-09-01',
  projectSearch: 'repo-a',
});
```

Add a rerender assertion in the same file that changes the search to
`'repo-b'` and verifies a second IPC call with the new value.

- [ ] **Step 2: Run the focused renderer tests and verify they fail**

Run:

```powershell
rtk npm test -- src/renderer/components/FilterBar.test.tsx src/renderer/hooks/useUsageData.test.ts src/renderer/hooks/useHourlyDetail.test.ts src/renderer/hooks/useMonthlyActivity.test.ts src/renderer/hooks/useProjectDetail.test.ts
```

Expected: FAIL because the old project select is still rendered and the hook
dependency arrays do not yet include `projectSearch`.

- [ ] **Step 3: Replace the project select with the controlled text input**

In `FilterBar.tsx`, keep the existing `FilterBarProps`, model select, and
generic `update` helper. Replace only the `showProjectFilter` project `<select>`
block with:

```tsx
{showProjectFilter && (
  <div className="flex flex-col gap-1">
    <label htmlFor="project-filter" className="text-xs font-medium text-muted-foreground">
      Project path
    </label>
    <input
      id="project-filter"
      type="text"
      placeholder="Search project path"
      className="min-w-64 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      value={filters.projectSearch ?? ''}
      onChange={(event: ChangeEvent<HTMLInputElement>) =>
        update({ projectSearch: event.target.value.trim() ? event.target.value : undefined })
      }
    />
  </div>
)}
```

Remove the project-option rendering from this component; `options.projects`
can remain in the shared `FilterOptions` contract for compatibility with the
existing filter-options IPC response and callers.

- [ ] **Step 4: Add `projectSearch` to every relevant effect dependency**

Make the following surgical dependency updates:

```ts
// useUsageData.ts
}, [filters.project, filters.projectSearch, filters.model, filters.from, filters.to]);

// useHourlyDetail.ts
}, [date, filters.project, filters.projectSearch, filters.model, filters.from, filters.to]);

// useMonthlyActivity.ts
}, [params.year, params.month, params.project, params.projectSearch, params.model]);

// useProjectDetail.ts
}, [project, filters.project, filters.projectSearch, filters.model, filters.from, filters.to]);
```

Do not change the cancellation flags, polling interval, error logging, or
request construction; spreading the filter object already forwards the new
field to IPC.

- [ ] **Step 5: Run the focused renderer tests and verify they pass**

Run:

```powershell
rtk npm test -- src/renderer/components/FilterBar.test.tsx src/renderer/hooks/useUsageData.test.ts src/renderer/hooks/useHourlyDetail.test.ts src/renderer/hooks/useMonthlyActivity.test.ts src/renderer/hooks/useProjectDetail.test.ts
```

Expected: PASS for the new text input behavior, model behavior, hide behavior,
live usage requests, and all hook dependency assertions.

- [ ] **Step 6: Commit the renderer filter and hook changes**

```powershell
rtk git add src/renderer/components/FilterBar.tsx src/renderer/components/FilterBar.test.tsx src/renderer/hooks/useUsageData.ts src/renderer/hooks/useUsageData.test.ts src/renderer/hooks/useHourlyDetail.ts src/renderer/hooks/useHourlyDetail.test.ts src/renderer/hooks/useMonthlyActivity.ts src/renderer/hooks/useMonthlyActivity.test.ts src/renderer/hooks/useProjectDetail.ts src/renderer/hooks/useProjectDetail.test.ts
rtk git commit -m "feat: add live project path filter input" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

The commit must include the repository's required Copilot co-author trailer.

### Task 3: Wire App-level monthly filtering and update context

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

**Interfaces:**
- Consumes: `UsageFilters.projectSearch` from Task 1 and the updated `FilterBar`/hooks from Task 2.
- Produces: monthly activity requests that include the same search term and an animation context key that changes whenever the active project-path search changes.

- [ ] **Step 1: Write the failing App integration tests**

Update the existing dashboard-loading assertion in `App.test.tsx` so it looks
for the new accessible field instead of a project `<option>`:

```ts
expect(screen.getByLabelText('Project path')).toBeInTheDocument();
```

Add an integration test that types into the global field and waits for the
latest usage request:

```tsx
it('re-fetches usage when the project path changes', async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText('3.00');

  await user.type(screen.getByLabelText('Project path'), 'repo-a');

  await waitFor(() => {
    expect(window.api.getUsage).toHaveBeenLastCalledWith({ projectSearch: 'repo-a' });
  });
});
```

Update the monthly activity navigation test to assert that the initial
request still contains the current month and no active filters:

```ts
expect(window.api.getMonthlyActivity).toHaveBeenCalledWith({
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  project: undefined,
  projectSearch: undefined,
  model: undefined,
});
```

Add a second App-level test that sets a non-empty filter before navigating to
Monthly activity and asserts:

```ts
expect(window.api.getMonthlyActivity).toHaveBeenLastCalledWith(
  expect.objectContaining({ projectSearch: 'repo-a' }),
);
```

Use `waitFor` for IPC call assertions so the test does not depend on React
effect timing.

- [ ] **Step 2: Run the App tests and verify the new assertions fail**

Run:

```powershell
rtk npm test -- src/renderer/App.test.tsx
```

Expected: the new monthly propagation assertion fails because the App does
not yet pass `projectSearch`; the update-context change is implemented in the
same task and remains covered by the existing chart reset-key tests.

- [ ] **Step 3: Pass the search to monthly activity**

In the `useMonthlyActivity` call in `App.tsx`, add the existing filter value:

```ts
const monthlyActivity = useMonthlyActivity({
  year: activityMonth.year,
  month: activityMonth.month,
  project: filters.project,
  projectSearch: filters.projectSearch,
  model: filters.model,
});
```

Because `MonthlyActivityParams` and `getMonthlyActivity` already pass the
remaining filter fields into `buildWhereClause`, no new bridge or IPC handler
is required.

- [ ] **Step 4: Include the search in the chart update context**

Add the new value to `usageUpdateContextKey`:

```ts
const usageUpdateContextKey = JSON.stringify({
  project: dataFilters?.project ?? null,
  projectSearch: dataFilters?.projectSearch ?? null,
  model: dataFilters?.model ?? null,
  from: dataFilters?.from ?? null,
  to: dataFilters?.to ?? null,
});
```

Keep deriving the key from `dataFilters`, not the currently typed `filters`,
so a pending request cannot baseline the previous result under the new
search term.

- [ ] **Step 5: Run the App tests and verify they pass**

Run:

```powershell
rtk npm test -- src/renderer/App.test.tsx
```

Expected: PASS for dashboard loading, live project-path usage requests,
monthly activity propagation, existing project navigation, error behavior, and
the unchanged model/date flows.

- [ ] **Step 6: Commit the App integration**

```powershell
rtk git add src/renderer/App.tsx src/renderer/App.test.tsx
rtk git commit -m "feat: propagate project path filter across dashboard" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

The commit must include the repository's required Copilot co-author trailer.

### Task 4: Run the complete verification suite

**Files:**
- No source files should be changed in this task unless a failing test exposes a regression directly caused by Tasks 1-3.

**Interfaces:**
- Consumes: all committed changes from Tasks 1-3.
- Produces: evidence that the complete Vitest suite and diff checks pass.

- [ ] **Step 1: Run the complete test suite**

Run:

```powershell
rtk npm test
```

Expected: PASS with zero failed tests.

- [ ] **Step 2: Check the final diff for whitespace errors and unexpected files**

Run:

```powershell
rtk git diff --check
rtk git status --short
```

Expected: `git diff --check` reports no errors, and status contains only
intentional task changes (or is clean if all commits are present).

- [ ] **Step 3: Confirm the final behavior manually from the test contract**

Verify the implemented path:

1. An empty Daily Consumption filter shows all projects and retains the model selector.
2. Typing `repo-a` sends `projectSearch: 'repo-a'` and updates totals and charts from the filtered SQLite result.
3. Typing `REPO-A` matches `org/repo-a`.
4. A path containing `%`, `_`, or Windows backslashes is searched literally.
5. Clearing the field restores the unfiltered data.
6. Hourly detail, monthly activity, and project detail use the same search field.
7. No export page or unrelated UI change is present.
