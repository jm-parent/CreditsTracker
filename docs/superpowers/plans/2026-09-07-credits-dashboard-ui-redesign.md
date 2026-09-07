# Credits Dashboard UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the existing, fully-functional Credits Dashboard renderer with Tailwind CSS (dark theme) and selected shadcn/ui primitives, without changing any component's props/behavior or breaking any existing test.

**Architecture:** Add Tailwind CSS v4 via its official Vite plugin to the existing `vite.renderer.config.ts`. Add a small set of hand-authored shadcn-style UI primitives (`Card`, `Badge`, `Table`, `Skeleton`) under `src/renderer/components/ui/`, built with `class-variance-authority` + `clsx`/`tailwind-merge` (the standard shadcn `cn()` pattern), copied/adapted from the public shadcn/ui source rather than pulled in as an npm dependency. Restyle each existing component in place (same props, same exported function names, only JSX/className changes) to consume the new primitives and Tailwind utility classes. `FilterBar` keeps native `<select>`/`<input type="date">` elements (only Tailwind classes added) because Radix-based replacements are incompatible with the existing `userEvent.selectOptions()` tests.

**Tech Stack:** React 19, TypeScript, Vite 8, `@tailwindcss/vite`, `tailwindcss` v4, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, existing `recharts`, existing Vitest + Testing Library.

## Global Constraints

- No changes to component props/interfaces: `SummaryCards({ totals })`, `FilterBar({ options, filters, onChange })`, `TimeSeriesChart({ data })`, `BreakdownChart({ title, data })`, `SessionsTable({ rows })`, `EmptyState({ title, message })` all keep their exact existing signatures.
- No changes to `src/main/**`, `src/shared/**`, IPC, or the database layer.
- Dark mode only — no theme toggle, no light theme.
- `FilterBar` must keep native `<select>` and `<input type="date">` elements (no Radix/shadcn `Select`).
- The `.summary-cards` className on `SummaryCards`'s root element must be preserved verbatim — `App.test.tsx` does `container.querySelector('.summary-cards')`.
- Every existing test file must continue to pass **unmodified**, except `App.test.tsx`, which gains exactly one new test (loading skeleton) and must otherwise be unchanged.
- Every task must end with `npm test` green before committing.

---

### Task 1: Install and configure Tailwind CSS v4

**Files:**
- Modify: `package.json` (new devDependencies)
- Modify: `vite.renderer.config.ts`
- Create: `src/renderer/index.css`
- Modify: `src/renderer/main.tsx`
- Modify: `index.html` (no change expected, just verify)

**Interfaces:**
- Consumes: nothing (infra-only task).
- Produces: `src/renderer/index.css` importable by any component; Tailwind utility classes (`bg-*`, `text-*`, `flex`, `grid`, etc.) usable in all `.tsx` files from Task 2 onward. CSS variables `--background`, `--foreground`, `--card`, `--card-foreground`, `--primary`, `--primary-foreground`, `--muted`, `--muted-foreground`, `--border`, `--accent` are defined on `:root` for later tasks to reference via Tailwind's `bg-background`, `text-foreground`, etc. (configured through `@theme` in Task 1's CSS, matching Tailwind v4's CSS-first config).

- [ ] **Step 1: Install dependencies**

Run: `npm install -D tailwindcss @tailwindcss/vite` then `npm install class-variance-authority clsx tailwind-merge lucide-react`

Expected: `package.json` gains these under `devDependencies` (first command) and `dependencies` (second command).

- [ ] **Step 2: Wire the Tailwind Vite plugin into the renderer config**

Edit `vite.renderer.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

- [ ] **Step 3: Create the Tailwind entry stylesheet with dark theme tokens**

Create `src/renderer/index.css`:

```css
@import "tailwindcss";

@theme {
  --color-background: #0b0f14;
  --color-foreground: #e5e9f0;
  --color-card: #131922;
  --color-card-foreground: #e5e9f0;
  --color-primary: #3b82f6;
  --color-primary-foreground: #f8fafc;
  --color-muted: #1c2531;
  --color-muted-foreground: #94a3b8;
  --color-border: #263242;
  --color-accent: #22d3ee;
}

body {
  background-color: var(--color-background);
  color: var(--color-foreground);
  margin: 0;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
```

- [ ] **Step 4: Import the stylesheet in the renderer entry point**

Edit `src/renderer/main.tsx` to add `import './index.css';` as the first import (view the file first to place it correctly relative to existing imports).

- [ ] **Step 5: Run the full test suite to confirm no regression**

Run: `npm test`
Expected: all existing tests still pass (this task adds no new tests — it's pure infra with no component changes yet).

- [ ] **Step 6: Verify the dev server still boots**

Run: `npm start` (wait ~10-15s for the Electron window/Vite dev server to report ready, then stop it) — confirms the Tailwind Vite plugin doesn't break the build. If a full Electron launch isn't possible in this environment, at minimum run `npx vite build --config vite.renderer.config.ts` (or the project's existing renderer build step) to confirm Tailwind compiles without errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vite.renderer.config.ts src/renderer/index.css src/renderer/main.tsx
git commit -m "chore: add Tailwind CSS v4 to renderer build"
```

---

### Task 2: Add shared `cn()` utility and UI primitives (Card, Badge, Skeleton)

**Files:**
- Create: `src/renderer/lib/utils.ts`
- Create: `src/renderer/components/ui/card.tsx`
- Create: `src/renderer/components/ui/badge.tsx`
- Create: `src/renderer/components/ui/skeleton.tsx`
- Test: `src/renderer/components/ui/card.test.tsx`
- Test: `src/renderer/components/ui/skeleton.test.tsx`

**Interfaces:**
- Consumes: Tailwind classes from Task 1's `index.css` (via `bg-card`, `text-card-foreground`, `border-border`, etc.).
- Produces:
  - `cn(...inputs: ClassValue[]): string` from `src/renderer/lib/utils.ts` — used by every UI primitive and later by restyled feature components.
  - `Card`, `CardHeader`, `CardTitle`, `CardContent` React components from `src/renderer/components/ui/card.tsx`, each accepting `{ className?: string; children?: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>`.
  - `Badge` component from `src/renderer/components/ui/badge.tsx` accepting `{ className?: string; children?: React.ReactNode }`.
  - `Skeleton` component from `src/renderer/components/ui/skeleton.tsx` accepting `{ className?: string }`, rendering a `<div role="status" aria-label="Loading" className="animate-pulse ...">`.

- [ ] **Step 1: Write the failing test for `Skeleton`'s accessible role**

Create `src/renderer/components/ui/skeleton.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Skeleton } from './skeleton';

describe('Skeleton', () => {
  it('renders a status role for loading placeholders', () => {
    render(<Skeleton />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/ui/skeleton.test.tsx`
Expected: FAIL — `Cannot find module './skeleton'`

- [ ] **Step 3: Create the `cn()` utility**

Create `src/renderer/lib/utils.ts`:

```typescript
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Implement `Skeleton`**

Create `src/renderer/components/ui/skeleton.tsx`:

```typescript
import { cn } from '../../lib/utils';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn('animate-pulse rounded-md bg-muted', className)}
    />
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/ui/skeleton.test.tsx`
Expected: PASS

- [ ] **Step 6: Write the failing test for `Card` composition**

Create `src/renderer/components/ui/card.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardContent } from './card';

describe('Card', () => {
  it('renders a title and content together', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Example title</CardTitle>
        </CardHeader>
        <CardContent>Example content</CardContent>
      </Card>,
    );

    expect(screen.getByText('Example title')).toBeInTheDocument();
    expect(screen.getByText('Example content')).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/ui/card.test.tsx`
Expected: FAIL — `Cannot find module './card'`

- [ ] **Step 8: Implement `Card` and its subcomponents**

Create `src/renderer/components/ui/card.tsx`:

```typescript
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-card text-card-foreground shadow-sm', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-medium text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pt-0', className)} {...props} />;
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/ui/card.test.tsx`
Expected: PASS

- [ ] **Step 10: Implement `Badge` (no dedicated test — trivial wrapper, covered indirectly once used in Task 4)**

Create `src/renderer/components/ui/badge.tsx`:

```typescript
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 11: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the two new UI primitive tests.

- [ ] **Step 12: Commit**

```bash
git add src/renderer/lib/utils.ts src/renderer/components/ui/card.tsx src/renderer/components/ui/card.test.tsx src/renderer/components/ui/badge.tsx src/renderer/components/ui/skeleton.tsx src/renderer/components/ui/skeleton.test.tsx
git commit -m "feat: add shadcn-style Card, Badge, Skeleton UI primitives"
```

---

### Task 3: Add `Table` UI primitive

**Files:**
- Create: `src/renderer/components/ui/table.tsx`
- Test: `src/renderer/components/ui/table.test.tsx`

**Interfaces:**
- Consumes: `cn` from `src/renderer/lib/utils.ts` (Task 2).
- Produces: `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` components, each a thin styled wrapper around the equivalent native `<table>`/`<thead>`/`<tbody>`/`<tr>`/`<th>`/`<td>` element (so `role="table"`/`role="row"`/`role="columnheader"`/`role="cell"` continue to be produced natively, preserving `SessionsTable`'s existing `getByRole` queries in Task 6).

- [ ] **Step 1: Write the failing test**

Create `src/renderer/components/ui/table.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './table';

describe('Table', () => {
  it('renders as a native table with header and body rows', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Alice</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Alice' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/ui/table.test.tsx`
Expected: FAIL — `Cannot find module './table'`

- [ ] **Step 3: Implement `Table` and subcomponents**

Create `src/renderer/components/ui/table.tsx`:

```typescript
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('border-b border-border', className)} {...props} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-border', className)} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('hover:bg-muted/50', className)} {...props} />;
}

export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('h-10 px-3 text-left align-middle font-medium text-muted-foreground', className)} {...props} />;
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2 align-middle', className)} {...props} />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/ui/table.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/ui/table.tsx src/renderer/components/ui/table.test.tsx
git commit -m "feat: add shadcn-style Table UI primitive"
```

---

### Task 4: Restyle `SummaryCards` with `Card`

**Files:**
- Modify: `src/renderer/components/SummaryCards.tsx`
- Verify (do not modify): `src/renderer/components/SummaryCards.test.tsx`

**Interfaces:**
- Consumes: `Card`, `CardContent` from `src/renderer/components/ui/card.tsx` (Task 2).
- Produces: no interface change — `SummaryCards({ totals: UsageTotals })` unchanged.

- [ ] **Step 1: Read the existing test to confirm required text/roles/classes**

View `src/renderer/components/SummaryCards.test.tsx` and confirm which queries it uses (e.g. `getByText('AIU credits')`, `getByText('3.00')`). Also note `App.test.tsx` requires the root element to keep the exact className `summary-cards` (via `container.querySelector('.summary-cards')`).

- [ ] **Step 2: Restyle the component**

Edit `src/renderer/components/SummaryCards.tsx`:

```typescript
import { Card, CardContent } from './ui/card';
import type { UsageTotals } from '../../shared/types';

interface SummaryCardsProps {
  totals: UsageTotals;
}

export function SummaryCards({ totals }: SummaryCardsProps) {
  return (
    <div className="summary-cards grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card className="summary-card">
        <CardContent className="flex flex-col gap-1 p-4">
          <span className="summary-value text-2xl font-semibold text-foreground">{totals.aiuCredits.toFixed(2)}</span>
          <span className="summary-label text-sm text-muted-foreground">AIU credits</span>
        </CardContent>
      </Card>
      <Card className="summary-card">
        <CardContent className="flex flex-col gap-1 p-4">
          <span className="summary-value text-2xl font-semibold text-foreground">{totals.tokens}</span>
          <span className="summary-label text-sm text-muted-foreground">Tokens</span>
        </CardContent>
      </Card>
      <Card className="summary-card">
        <CardContent className="flex flex-col gap-1 p-4">
          <span className="summary-value text-2xl font-semibold text-foreground">{totals.requests}</span>
          <span className="summary-label text-sm text-muted-foreground">Requests</span>
        </CardContent>
      </Card>
    </div>
  );
}
```

Note: the root `div`'s className string starts with `summary-cards` — Tailwind utility classes are appended after it, so `querySelector('.summary-cards')` still matches (multiple classes on one element is standard; `classList` / CSS class selectors match on any one of the space-separated classes).

- [ ] **Step 3: Run the component's existing test plus App's tests**

Run: `npx vitest run src/renderer/components/SummaryCards.test.tsx src/renderer/App.test.tsx`
Expected: PASS, unmodified.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SummaryCards.tsx
git commit -m "style: restyle SummaryCards with Card primitive and Tailwind"
```

---

### Task 5: Restyle `FilterBar` (Tailwind classes only, native elements kept)

**Files:**
- Modify: `src/renderer/components/FilterBar.tsx`
- Verify (do not modify): `src/renderer/components/FilterBar.test.tsx`

**Interfaces:**
- Consumes: nothing new (no UI primitives — native `<select>`/`<input>` kept per Global Constraints).
- Produces: no interface change — `FilterBar({ options, filters, onChange })` unchanged.

- [ ] **Step 1: Read the existing test to confirm required labels**

View `src/renderer/components/FilterBar.test.tsx` and confirm it uses `getByLabelText('Project')`, `getByLabelText('Model')`, `getByLabelText('From')`, `getByLabelText('To')`, and `userEvent.selectOptions(...)` — all of which require the `<label htmlFor>` / `<select id>` pairing to stay exactly as-is.

- [ ] **Step 2: Restyle the component**

Edit `src/renderer/components/FilterBar.tsx` — replace the returned JSX only (keep `update()` logic untouched):

```typescript
  return (
    <div className="filter-bar flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="project-filter" className="text-xs font-medium text-muted-foreground">
          Project
        </label>
        <select
          id="project-filter"
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          value={filters.project ?? ''}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => update({ project: event.target.value || undefined })}
        >
          <option value="">All projects</option>
          {options.projects.map((project) => (
            <option key={project} value={project}>
              {project}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="model-filter" className="text-xs font-medium text-muted-foreground">
          Model
        </label>
        <select
          id="model-filter"
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          value={filters.model ?? ''}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => update({ model: event.target.value || undefined })}
        >
          <option value="">All models</option>
          {options.models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="from-filter" className="text-xs font-medium text-muted-foreground">
          From
        </label>
        <input
          id="from-filter"
          type="date"
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          value={filters.from ?? ''}
          onChange={(event: ChangeEvent<HTMLInputElement>) => update({ from: event.target.value || undefined })}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="to-filter" className="text-xs font-medium text-muted-foreground">
          To
        </label>
        <input
          id="to-filter"
          type="date"
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          value={filters.to ?? ''}
          onChange={(event: ChangeEvent<HTMLInputElement>) => update({ to: event.target.value || undefined })}
        />
      </div>
    </div>
  );
```

- [ ] **Step 3: Run the component's existing test**

Run: `npx vitest run src/renderer/components/FilterBar.test.tsx`
Expected: PASS, unmodified.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/FilterBar.tsx
git commit -m "style: restyle FilterBar with Tailwind classes"
```

---

### Task 6: Restyle `SessionsTable` with `Table`, `Card`, and a sort-direction icon

**Files:**
- Modify: `src/renderer/components/SessionsTable.tsx`
- Verify (do not modify): `src/renderer/components/SessionsTable.test.tsx`

**Interfaces:**
- Consumes: `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` from `src/renderer/components/ui/table.tsx` (Task 3); `Card`, `CardContent` from `src/renderer/components/ui/card.tsx` (Task 2); `ArrowUp`, `ArrowDown` icons from `lucide-react`.
- Produces: no interface change — `SessionsTable({ rows: BreakdownPoint[] })` unchanged; `nextSortDirection` logic unchanged.

- [ ] **Step 1: Read the existing test to confirm required roles**

View `src/renderer/components/SessionsTable.test.tsx` and confirm it queries via `getByRole('columnheader', { name: 'AIU credits' })` and clicks it, then re-checks row order via `getAllByRole('row')` or similar — the `role="columnheader"` attribute on the sortable header must be preserved (or come for free from `<th>`/`TableHead`, which already renders `role="columnheader"` natively — remove the explicit `role="columnheader"` prop only if the native role already satisfies the test; otherwise keep it explicit).

- [ ] **Step 2: Restyle the component**

Edit `src/renderer/components/SessionsTable.tsx`:

```typescript
import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import type { BreakdownPoint } from '../../shared/types';

interface SessionsTableProps {
  rows: BreakdownPoint[];
}

// Three-state cycle instead of a plain boolean toggle: starting in 'default'
// renders descending order (same as 'desc'), so the first click only commits
// to 'desc' (no visible change) and the second click is what actually flips
// to ascending. From then on it behaves as a normal desc/asc toggle.
type SortDirection = 'default' | 'desc' | 'asc';

function nextSortDirection(current: SortDirection): SortDirection {
  if (current === 'asc') {
    return 'desc';
  }
  return current === 'default' ? 'desc' : 'asc';
}

export function SessionsTable({ rows }: SessionsTableProps) {
  const [sort, setSort] = useState<SortDirection>('default');

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No sessions for this selection.</p>;
  }

  const sortedRows = [...rows].sort((a, b) =>
    sort === 'asc' ? a.aiuCredits - b.aiuCredits : b.aiuCredits - a.aiuCredits,
  );

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead
                role="columnheader"
                onClick={() => setSort(nextSortDirection)}
                className="cursor-pointer select-none"
              >
                <span className="inline-flex items-center gap-1">
                  AIU credits
                  {sort === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>{row.key}</TableCell>
                <TableCell>{row.aiuCredits.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Run the component's existing test**

Run: `npx vitest run src/renderer/components/SessionsTable.test.tsx`
Expected: PASS, unmodified. If it fails because the test asserts an exact accessible name like `getByRole('columnheader', { name: 'AIU credits' })` and the icon's SVG injects extra accessible text, add `aria-hidden="true"` to the `ArrowUp`/`ArrowDown` icons (lucide-react icons accept this prop) and re-run.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SessionsTable.tsx
git commit -m "style: restyle SessionsTable with Table and Card primitives"
```

---

### Task 7: Restyle `TimeSeriesChart` and `BreakdownChart` with `Card` and theme colors

**Files:**
- Modify: `src/renderer/components/TimeSeriesChart.tsx`
- Modify: `src/renderer/components/BreakdownChart.tsx`
- Verify (do not modify): `src/renderer/components/TimeSeriesChart.test.tsx`, `src/renderer/components/BreakdownChart.test.tsx`

**Interfaces:**
- Consumes: `Card`, `CardHeader`, `CardTitle`, `CardContent` from `src/renderer/components/ui/card.tsx` (Task 2).
- Produces: no interface change — both components' props unchanged; `data-testid="time-series-chart"` / `data-testid="breakdown-chart"` preserved verbatim (existing tests likely assert on these).

- [ ] **Step 1: Read both existing tests to confirm required test ids and text**

View `src/renderer/components/TimeSeriesChart.test.tsx` and `src/renderer/components/BreakdownChart.test.tsx`, confirm exact strings queried (e.g. `getByText('Credits over time')`, `getByTestId('time-series-chart')`, `getByText('No data for this selection.')`).

- [ ] **Step 2: Restyle `TimeSeriesChart`**

Edit `src/renderer/components/TimeSeriesChart.tsx`:

```typescript
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import type { TimeSeriesPoint } from '../../shared/types';

interface TimeSeriesChartProps {
  data: TimeSeriesPoint[];
}

export function TimeSeriesChart({ data }: TimeSeriesChartProps) {
  return (
    <Card className="chart-card">
      <CardHeader>
        <CardTitle>Credits over time</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data for this selection.</p>
        ) : (
          <div data-testid="time-series-chart" style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={data}>
                <XAxis dataKey="date" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: '#131922', border: '1px solid #263242', color: '#e5e9f0' }} />
                <Line type="monotone" dataKey="aiuCredits" stroke="#22d3ee" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Restyle `BreakdownChart`**

Edit `src/renderer/components/BreakdownChart.tsx`:

```typescript
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import type { BreakdownPoint } from '../../shared/types';

interface BreakdownChartProps {
  title: string;
  data: BreakdownPoint[];
}

export function BreakdownChart({ title, data }: BreakdownChartProps) {
  return (
    <Card className="chart-card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data for this selection.</p>
        ) : (
          <div data-testid="breakdown-chart" style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={data}>
                <XAxis dataKey="key" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: '#131922', border: '1px solid #263242', color: '#e5e9f0' }} />
                <Bar dataKey="aiuCredits" fill="#22d3ee" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run both components' existing tests**

Run: `npx vitest run src/renderer/components/TimeSeriesChart.test.tsx src/renderer/components/BreakdownChart.test.tsx`
Expected: PASS, unmodified.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/TimeSeriesChart.tsx src/renderer/components/BreakdownChart.tsx
git commit -m "style: restyle chart components with Card primitive and theme colors"
```

---

### Task 8: Restyle `EmptyState`

**Files:**
- Modify: `src/renderer/components/EmptyState.tsx`
- Verify (do not modify): `src/renderer/components/EmptyState.test.tsx`

**Interfaces:**
- Consumes: nothing new (plain Tailwind classes only).
- Produces: no interface change — `EmptyState({ title, message })` unchanged.

- [ ] **Step 1: Read the existing test**

View `src/renderer/components/EmptyState.test.tsx`, confirm it queries by `getByRole('heading', { name: ... })` and/or `getByText(...)` for the message.

- [ ] **Step 2: Restyle the component**

Edit `src/renderer/components/EmptyState.tsx`:

```typescript
interface EmptyStateProps {
  title: string;
  message: string;
}

export function EmptyState({ title, message }: EmptyStateProps) {
  return (
    <div className="empty-state flex min-h-screen flex-col items-center justify-center gap-2 bg-background px-4 text-center">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
```

- [ ] **Step 3: Run the component's existing test**

Run: `npx vitest run src/renderer/components/EmptyState.test.tsx`
Expected: PASS, unmodified.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/EmptyState.tsx
git commit -m "style: restyle EmptyState with Tailwind classes"
```

---

### Task 9: Restyle `App` layout and add first-load `Skeleton` state

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx` (add exactly one new test; do not change existing four tests)

**Interfaces:**
- Consumes: `Skeleton` from `src/renderer/components/ui/skeleton.tsx` (Task 2); `loading` from `useUsageData(filters)` (already produced by `src/renderer/hooks/useUsageData.ts`, previously unused).
- Produces: no interface change to `App` (it takes no props); introduces one new observable behavior — a `role="status"` skeleton placeholder shown only when `loading === true` AND `data === null` (i.e., the very first load, not subsequent polling refreshes, since `data` stays populated after the first successful fetch).

- [ ] **Step 1: Write the failing test for the loading skeleton**

Edit `src/renderer/App.test.tsx` — add this test inside the existing `describe('App', ...)` block, after the last existing test:

```typescript
  it('shows a loading skeleton before the first successful data fetch', async () => {
    let resolveUsage: (value: UsageResult) => void = () => {};
    window.api.getUsage = vi.fn().mockImplementation(
      () =>
        new Promise<UsageResult>((resolve) => {
          resolveUsage = resolve;
        }),
    );

    render(<App />);

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();

    resolveUsage(usage);
    expect(await screen.findByText('3.00')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: FAIL — new test fails (no skeleton rendered yet); the four pre-existing tests still PASS.

- [ ] **Step 3: Restyle `App` and wire in the skeleton**

Edit `src/renderer/App.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { useUsageData } from './hooks/useUsageData';
import { EmptyState } from './components/EmptyState';
import { FilterBar } from './components/FilterBar';
import { SummaryCards } from './components/SummaryCards';
import { TimeSeriesChart } from './components/TimeSeriesChart';
import { BreakdownChart } from './components/BreakdownChart';
import { SessionsTable } from './components/SessionsTable';
import { Skeleton } from './components/ui/skeleton';
import type { FilterOptions, UsageFilters } from '../shared/types';

const EMPTY_OPTIONS: FilterOptions = { projects: [], models: [], minDate: null, maxDate: null };

export function App() {
  const [options, setOptions] = useState<FilterOptions>(EMPTY_OPTIONS);
  const [optionsError, setOptionsError] = useState<Error | null>(null);
  const [filters, setFilters] = useState<UsageFilters>({});
  const { data, loading, error } = useUsageData(filters);

  useEffect(() => {
    window.api
      .getFilterOptions()
      .then(setOptions)
      .catch((err) => setOptionsError(err instanceof Error ? err : new Error(String(err))));
  }, []);

  if ((optionsError || error) && !data) {
    return (
      <EmptyState
        title="Couldn't load Copilot CLI usage data."
        message="Make sure Copilot CLI has been used on this machine, then reopen the app."
      />
    );
  }

  return (
    <div className="app min-h-screen bg-background px-6 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-foreground">Credits Dashboard</h1>
      <FilterBar options={options} filters={filters} onChange={setFilters} />
      {error && data && (
        <p className="refresh-notice mt-4 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          Couldn't refresh — showing last known data.
        </p>
      )}
      {loading && !data && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {data && (
        <div className="mt-6 flex flex-col gap-6">
          <SummaryCards totals={data.totals} />
          <TimeSeriesChart data={data.timeSeries} />
          <BreakdownChart title="Credits by project" data={data.byProject} />
          <BreakdownChart title="Credits by model" data={data.byModel} />
          <SessionsTable rows={data.byProject} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: PASS — all five tests (four original + one new) pass.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass (this is the final component task — full regression check).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.tsx src/renderer/App.test.tsx
git commit -m "style: restyle App layout, add first-load skeleton state"
```

---

### Task 10: Final visual/build verification

**Files:** none modified — verification only.

**Interfaces:** none.

- [ ] **Step 1: Run the complete test suite one final time**

Run: `npm test`
Expected: all tests pass (originally 32 tests + 3 new UI-primitive tests + 1 new App test = 36 tests, all green).

- [ ] **Step 2: Type-check the renderer**

Run: `npx tsc --noEmit` (or the project's existing typecheck script if one exists — check `package.json` `"scripts"` first)
Expected: no type errors.

- [ ] **Step 3: Build the renderer to confirm Tailwind/production build works**

Run: `npm run package` (electron-forge package step, matching the packaging verification done for v1) — if the sandbox lacks native build tools (`better-sqlite3` rebuild requirements noted in the v1 spec), fall back to `npx vite build --config vite.renderer.config.ts` to at least confirm the Tailwind CSS compiles cleanly for production.
Expected: build succeeds with no Tailwind/PostCSS errors.

- [ ] **Step 4: Manual smoke check (if a real machine/Electron runtime is available)**

Run: `npm start`, confirm the window opens with dark background, styled cards, table, and chart. Communicate to the user that this manual check should be repeated on their real machine per the same process used for v1 (Python/MSBuild/node-gyp toolchain needed for `better-sqlite3`).

- [ ] **Step 5: Commit any final cleanup (only if needed)**

If Steps 2-3 revealed no issues, no commit is needed for this task — it's verification-only.

