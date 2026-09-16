# Categorized Sidebar Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the eight existing sidebar pages into four always-visible categories without changing navigation behavior.

**Architecture:** Keep the current `DashboardTab` union and `Sidebar` props unchanged. Replace the flat navigation metadata with a typed `NAV_GROUPS` configuration, render each group as a labeled section, and reuse the current page-button markup inside each section. No `App.tsx`, page, hook, IPC, or backend changes are needed.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, lucide-react, Vitest, Testing Library.

## Global Constraints

- Group all existing pages under clear, always-visible category headings.
- Preserve one-click access to every page.
- Preserve the existing active state, accessibility attributes, update badge, footer, and callback behavior.
- All four groups remain expanded at all times.
- Page labels remain unchanged so existing navigation and user familiarity are preserved.
- No changes to `App.tsx`, dashboard pages, hooks, IPC, or backend data.
- No dependency or global-style changes.

---

### Task 1: Group the sidebar navigation by category

**Files:**
- Modify: `src\renderer\components\Sidebar.tsx:20-84` — replace the flat entry metadata and map it through four labeled groups while preserving the existing button, update badge, and footer logic.
- Modify: `src\renderer\components\Sidebar.test.tsx:1-38` — add assertions for category headings and the exact page order inside each category while retaining existing behavior tests.

**Interfaces:**
- Consumes: `DashboardTab`, the existing `SidebarProps`, the existing Lucide icon imports, and the existing `onTabChange` callback.
- Produces: a module-local `NAV_GROUPS` configuration and grouped navigation markup. The public `Sidebar` props and `DashboardTab` identifiers remain unchanged for `App.tsx`.

- [ ] **Step 1: Write the failing category-structure test**

Add `within` to the Testing Library imports and replace the flat-list-only assertion with a test that checks all four headings and the exact buttons in each group:

```tsx
import { render, screen, within } from '@testing-library/react';

it('renders navigation entries under their categories', () => {
  render(<Sidebar activeTab="daily" onTabChange={vi.fn()} />);

  expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
    'Overview',
    'Analysis',
    'Data & tools',
    'Discovery',
  ]);

  const buttonsInGroup = (label: string) =>
    within(screen.getByRole('group', { name: label }))
      .getAllByRole('button')
      .map((button) => button.textContent ?? '');

  expect(buttonsInGroup('Overview')).toEqual([
    'Daily consumption',
    'Monthly activity',
  ]);
  expect(buttonsInGroup('Analysis')).toEqual([
    'By project',
    'By model',
  ]);
  expect(buttonsInGroup('Data & tools')).toEqual([
    'Raw data',
    'CSV export',
    'Logs',
  ]);
  expect(buttonsInGroup('Discovery')).toEqual([
    'Featured projects',
  ]);
});
```

Keep the existing tests for active styling, click callbacks, version footer,
and update badge behavior in the same file.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
rtk npm test -- src\renderer\components\Sidebar.test.tsx
```

Expected: the new test fails because the current flat sidebar renders no
category headings or named groups. Existing flat-entry tests may still pass;
the failure must identify the missing `Overview` heading/group rather than a
test-runner or import error.

- [ ] **Step 3: Replace the flat metadata with typed navigation groups**

In `Sidebar.tsx`, replace `ENTRIES` with these module-local types and values:

```tsx
type NavigationEntry = {
  id: DashboardTab;
  label: string;
  icon: typeof CalendarDays;
};

type NavigationGroup = {
  label: string;
  entries: NavigationEntry[];
};

const NAV_GROUPS: NavigationGroup[] = [
  {
    label: 'Overview',
    entries: [
      { id: 'daily', label: 'Daily consumption', icon: CalendarDays },
      { id: 'monthly', label: 'Monthly activity', icon: Activity },
    ],
  },
  {
    label: 'Analysis',
    entries: [
      { id: 'projects', label: 'By project', icon: FolderKanban },
      { id: 'models', label: 'By model', icon: Cpu },
    ],
  },
  {
    label: 'Data & tools',
    entries: [
      { id: 'raw', label: 'Raw data', icon: Database },
      { id: 'export', label: 'CSV export', icon: Download },
      { id: 'logs', label: 'Logs', icon: ScrollText },
    ],
  },
  {
    label: 'Discovery',
    entries: [
      { id: 'featured', label: 'Featured projects', icon: Sparkles },
    ],
  },
];
```

Replace the direct `ENTRIES.map(...)` block inside the existing `<nav>` with
the grouped rendering below. Keep the current page-button contents and
active-class expression exactly as shown so behavior does not drift:

```tsx
{NAV_GROUPS.map(({ label, entries }, groupIndex) => {
  const headingId = `sidebar-group-${groupIndex}`;

  return (
    <section
      key={label}
      role="group"
      aria-labelledby={headingId}
      className="space-y-1"
    >
      <h2
        id={headingId}
        className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </h2>
      {entries.map(({ id, label: entryLabel, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onTabChange(id)}
          aria-current={activeTab === id ? 'page' : undefined}
          className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${
            activeTab === id
              ? 'bg-primary text-primary-foreground'
              : 'text-foreground hover:bg-muted'
          }`}
        >
          <Icon size={16} aria-hidden="true" />
          {entryLabel}
        </button>
      ))}
    </section>
  );
})}
```

Change the sidebar container's `gap-1` to `gap-4` so category headings have
clear separation, but leave `overflow-y-auto`, width, border, padding, and
the `mt-auto` version footer intact.

- [ ] **Step 4: Run the focused sidebar tests to verify the implementation**

Run:

```powershell
rtk npm test -- src\renderer\components\Sidebar.test.tsx
```

Expected: all `Sidebar.test.tsx` tests pass, including the new category/order
test and the existing active-tab, callback, footer, and update-badge tests.

- [ ] **Step 5: Run the related regression tests and inspect the diff**

Run:

```powershell
rtk npm test -- src\renderer\components\Sidebar.test.tsx src\renderer\App.test.tsx
rtk git diff --check
rtk git diff -- src\renderer\components\Sidebar.tsx src\renderer\components\Sidebar.test.tsx
```

Expected: both test files pass, `git diff --check` reports no whitespace
errors, and the diff is limited to grouped sidebar markup, its local styling,
and the corresponding tests. Confirm that no `App.tsx` or data-layer file was
modified.

- [ ] **Step 6: Commit the implementation**

```powershell
rtk git add -- src\renderer\components\Sidebar.tsx src\renderer\components\Sidebar.test.tsx
rtk git commit -m "feat: group sidebar navigation by category" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

The commit uses the repository's Conventional Commits format and preserves
the required co-author trailer.
