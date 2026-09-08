# Sidebar Navigation With Stats Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single stacked dashboard page with a left sidebar that
switches between 4 views: daily consumption (cumulative credits per day),
per-project totals, per-model totals, and the existing raw data browser.

**Architecture:** `App.tsx` gets a new `activeTab` state
(`'daily' | 'projects' | 'models' | 'raw'`) rendered alongside a new
`Sidebar` component. Three new presentational page components
(`DailyConsumptionPage`, `ProjectsPage`, `ModelsPage`) each wrap existing
chart/table components with tab-specific summary cards. No IPC/backend
changes — everything is derived from the `UsageResult` already returned by
`useUsageData`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, recharts, lucide-react,
vitest + @testing-library/react (existing stack, no new dependencies).

## Global Constraints

- No new IPC handlers, no changes to `src/main/**` or `preload.ts` — all data
  comes from the existing `UsageResult` (`totals`, `timeSeries`, `byProject`,
  `byModel`).
- The shared `FilterBar` (project/model/date) stays visible on the 3 stats
  tabs and hidden on the raw data tab, matching current behavior.
- Sidebar has exactly 4 entries: "Daily consumption", "By project",
  "By model", "Raw data".
- Switching sidebar tabs always clears any open overlay (`selectedProject`,
  `selectedDate`).
- Follow existing Tailwind conventions already used in the codebase:
  `border-border`, `bg-muted`, `bg-primary text-primary-foreground`,
  `rounded-md`, `text-sm`/`text-xs`, `text-foreground`/`text-muted-foreground`.
- Run `npx vitest run <path>` (not the full suite) after each task's test
  file changes, per the "smallest targeted test command" rule; run the full
  `npm test` only at the end.

---

### Task 1: `BreakdownSummaryCards` component

**Files:**
- Create: `src/renderer/components/BreakdownSummaryCards.tsx`
- Test: `src/renderer/components/BreakdownSummaryCards.test.tsx`

**Interfaces:**
- Produces: `BreakdownSummaryCards({ countLabel, count, totalCredits,
  topLabel, topKey, topCredits }: BreakdownSummaryCardsProps)` — a
  presentational component with no internal state, exported as a named
  export `BreakdownSummaryCards`, and its prop type exported as
  `BreakdownSummaryCardsProps` from the same file.

```ts
export interface BreakdownSummaryCardsProps {
  /** e.g. "Projects" or "Models" */
  countLabel: string;
  count: number;
  totalCredits: number;
  /** e.g. "Top project" or "Top model" */
  topLabel: string;
  topKey: string;
  topCredits: number;
}
```

This mirrors the visual style of `SummaryCards` (`src/renderer/components/SummaryCards.tsx`):
a `<div className="summary-cards grid grid-cols-1 gap-4 sm:grid-cols-3">` of
3 `Card`/`CardContent` blocks, each with a `summary-value` span (large,
bold) and a `summary-label` span (small, muted). Reuse the `Card` and
`CardContent` components from `./ui/card`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BreakdownSummaryCards } from './BreakdownSummaryCards';

describe('BreakdownSummaryCards', () => {
  it('renders the count, total credits, and top entry', () => {
    render(
      <BreakdownSummaryCards
        countLabel="Projects"
        count={3}
        totalCredits={12.5}
        topLabel="Top project"
        topKey="org/repo-a"
        topCredits={7.25}
      />,
    );

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('12.50')).toBeInTheDocument();
    expect(screen.getByText('Total credits')).toBeInTheDocument();
    expect(screen.getByText('org/repo-a')).toBeInTheDocument();
    expect(screen.getByText('7.25')).toBeInTheDocument();
    expect(screen.getByText('Top project')).toBeInTheDocument();
  });

  it('renders a placeholder when there is no top entry', () => {
    render(
      <BreakdownSummaryCards
        countLabel="Models"
        count={0}
        totalCredits={0}
        topLabel="Top model"
        topKey=""
        topCredits={0}
      />,
    );

    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/BreakdownSummaryCards.test.tsx`
Expected: FAIL — `Cannot find module './BreakdownSummaryCards'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { Card, CardContent } from './ui/card';

export interface BreakdownSummaryCardsProps {
  countLabel: string;
  count: number;
  totalCredits: number;
  topLabel: string;
  topKey: string;
  topCredits: number;
}

export function BreakdownSummaryCards({
  countLabel,
  count,
  totalCredits,
  topLabel,
  topKey,
  topCredits,
}: BreakdownSummaryCardsProps) {
  return (
    <div className="summary-cards grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card className="summary-card">
        <CardContent className="flex flex-col gap-1 p-4">
          <span className="summary-value text-2xl font-semibold text-foreground">{count}</span>
          <span className="summary-label text-sm text-muted-foreground">{countLabel}</span>
        </CardContent>
      </Card>
      <Card className="summary-card">
        <CardContent className="flex flex-col gap-1 p-4">
          <span className="summary-value text-2xl font-semibold text-foreground">
            {totalCredits.toFixed(2)}
          </span>
          <span className="summary-label text-sm text-muted-foreground">Total credits</span>
        </CardContent>
      </Card>
      <Card className="summary-card">
        <CardContent className="flex flex-col gap-1 p-4">
          <span className="summary-value text-2xl font-semibold text-foreground">
            {topKey ? topKey : '—'}
          </span>
          <span className="summary-label text-sm text-muted-foreground">
            {topLabel}
            {topKey ? ` (${topCredits.toFixed(2)})` : ''}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/BreakdownSummaryCards.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/BreakdownSummaryCards.tsx src/renderer/components/BreakdownSummaryCards.test.tsx
git commit -m "feat: add BreakdownSummaryCards component"
```

---

### Task 2: `ModelTable` component

**Files:**
- Create: `src/renderer/components/ModelTable.tsx`
- Test: `src/renderer/components/ModelTable.test.tsx`

**Interfaces:**
- Consumes: `BreakdownPoint` from `../../shared/types` (`{ key: string;
  aiuCredits: number }`), `getColorForKey` from `../lib/colors`.
- Produces: `ModelTable({ rows }: ModelTableProps)` named export, prop type
  `ModelTableProps` exported from the same file (`{ rows: BreakdownPoint[]
  }`).

This is a near-copy of `SessionsTable` (`src/renderer/components/SessionsTable.tsx`)
with two differences: the first column header is "Model" instead of
"Project", and there's an added "% of total" column computed as
`(row.aiuCredits / totalCredits) * 100` (0 when `totalCredits` is 0),
formatted with `toFixed(1)` + `%`. Keep the same 3-state sort behavior
(`default` → `desc` → `asc`) on the credits column, copied verbatim from
`SessionsTable`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelTable } from './ModelTable';

describe('ModelTable', () => {
  it('shows an empty message when there are no rows', () => {
    render(<ModelTable rows={[]} />);
    expect(screen.getByText('No models for this selection.')).toBeInTheDocument();
  });

  it('renders each model with its credits and percentage of the total', () => {
    render(
      <ModelTable
        rows={[
          { key: 'claude-sonnet-5', aiuCredits: 3 },
          { key: 'gpt-5.4', aiuCredits: 1 },
        ]}
      />,
    );

    expect(screen.getByText('Model')).toBeInTheDocument();
    const claudeRow = screen.getByText('claude-sonnet-5').closest('tr') as HTMLElement;
    expect(within(claudeRow).getByText('3.00')).toBeInTheDocument();
    expect(within(claudeRow).getByText('75.0%')).toBeInTheDocument();

    const gptRow = screen.getByText('gpt-5.4').closest('tr') as HTMLElement;
    expect(within(gptRow).getByText('1.00')).toBeInTheDocument();
    expect(within(gptRow).getByText('25.0%')).toBeInTheDocument();
  });

  it('sorts by credits ascending after two header clicks', async () => {
    const user = userEvent.setup();
    render(
      <ModelTable
        rows={[
          { key: 'claude-sonnet-5', aiuCredits: 3 },
          { key: 'gpt-5.4', aiuCredits: 1 },
        ]}
      />,
    );

    const header = screen.getByText('AIU credits').closest('th') as HTMLElement;
    await user.click(header); // desc (no visible change, same as default)
    await user.click(header); // asc

    const rows = screen.getAllByRole('row').slice(1); // skip header row
    expect(within(rows[0]).getByText('gpt-5.4')).toBeInTheDocument();
    expect(within(rows[1]).getByText('claude-sonnet-5')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/ModelTable.test.tsx`
Expected: FAIL — `Cannot find module './ModelTable'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { getColorForKey } from '../lib/colors';
import type { BreakdownPoint } from '../../shared/types';

export interface ModelTableProps {
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

export function ModelTable({ rows }: ModelTableProps) {
  const [sort, setSort] = useState<SortDirection>('default');

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No models for this selection.</p>;
  }

  const totalCredits = rows.reduce((sum, row) => sum + row.aiuCredits, 0);
  const sortedRows = [...rows].sort((a, b) =>
    sort === 'asc' ? a.aiuCredits - b.aiuCredits : b.aiuCredits - a.aiuCredits,
  );

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead
                role="columnheader"
                onClick={() => setSort(nextSortDirection)}
                className="cursor-pointer select-none"
              >
                <span className="inline-flex items-center gap-1">
                  AIU credits
                  {sort === 'asc' ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
                </span>
              </TableHead>
              <TableHead>% of total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: getColorForKey(row.key) }}
                    />
                    {row.key}
                  </span>
                </TableCell>
                <TableCell>{row.aiuCredits.toFixed(2)}</TableCell>
                <TableCell>
                  {totalCredits > 0 ? `${((row.aiuCredits / totalCredits) * 100).toFixed(1)}%` : '0.0%'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/ModelTable.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ModelTable.tsx src/renderer/components/ModelTable.test.tsx
git commit -m "feat: add ModelTable component with percentage-of-total column"
```

---

### Task 3: `DailyConsumptionPage` component

**Files:**
- Create: `src/renderer/components/DailyConsumptionPage.tsx`
- Test: `src/renderer/components/DailyConsumptionPage.test.tsx`

**Interfaces:**
- Consumes: `SummaryCards` from `./SummaryCards`, `TimeSeriesChart` from
  `./TimeSeriesChart`, `UsageTotals` and `TimeSeriesPoint` from
  `../../shared/types`.
- Produces: `DailyConsumptionPage({ totals, timeSeries, onDayClick }:
  DailyConsumptionPageProps)` named export, `DailyConsumptionPageProps`
  exported (`{ totals: UsageTotals; timeSeries: TimeSeriesPoint[]; onDayClick:
  (date: string) => void }`).

This is a direct extraction of the daily-chart portion currently inline in
`App.tsx` (the `<SummaryCards totals={data.totals} />` +
`<TimeSeriesChart data={data.timeSeries} onDayClick={setSelectedDate} />`
block) — no new logic.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DailyConsumptionPage } from './DailyConsumptionPage';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');

  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <actual.ResponsiveContainer width={600} height={240}>
        {children}
      </actual.ResponsiveContainer>
    ),
  };
});

describe('DailyConsumptionPage', () => {
  it('renders summary cards and the time series chart', () => {
    render(
      <DailyConsumptionPage
        totals={{ aiuCredits: 3, tokens: 120, requests: 1 }}
        timeSeries={[{ date: '2026-09-01', aiuCredits: 3 }]}
        onDayClick={vi.fn()}
      />,
    );

    expect(screen.getByText('3.00')).toBeInTheDocument();
    expect(screen.getByText('AIU credits')).toBeInTheDocument();
    expect(screen.getByText('Credits over time')).toBeInTheDocument();
    expect(screen.getByTestId('time-series-chart')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/DailyConsumptionPage.test.tsx`
Expected: FAIL — `Cannot find module './DailyConsumptionPage'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { SummaryCards } from './SummaryCards';
import { TimeSeriesChart } from './TimeSeriesChart';
import type { TimeSeriesPoint, UsageTotals } from '../../shared/types';

export interface DailyConsumptionPageProps {
  totals: UsageTotals;
  timeSeries: TimeSeriesPoint[];
  onDayClick: (date: string) => void;
}

export function DailyConsumptionPage({ totals, timeSeries, onDayClick }: DailyConsumptionPageProps) {
  return (
    <div className="daily-consumption-page flex flex-col gap-6">
      <SummaryCards totals={totals} />
      <TimeSeriesChart data={timeSeries} onDayClick={onDayClick} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/DailyConsumptionPage.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/DailyConsumptionPage.tsx src/renderer/components/DailyConsumptionPage.test.tsx
git commit -m "feat: add DailyConsumptionPage component"
```

---

### Task 4: `ProjectsPage` component

**Files:**
- Create: `src/renderer/components/ProjectsPage.tsx`
- Test: `src/renderer/components/ProjectsPage.test.tsx`

**Interfaces:**
- Consumes: `BreakdownSummaryCards` (Task 1), `BreakdownChart` from
  `./BreakdownChart`, `SessionsTable` from `./SessionsTable`, `BreakdownPoint`
  from `../../shared/types`.
- Produces: `ProjectsPage({ byProject, onProjectClick }: ProjectsPageProps)`
  named export, `ProjectsPageProps` exported (`{ byProject: BreakdownPoint[];
  onProjectClick: (project: string) => void }`).

Derive summary values from `byProject`:
- `count = byProject.length`
- `totalCredits = byProject.reduce((sum, p) => sum + p.aiuCredits, 0)`
- top project = the entry with the max `aiuCredits`, or `undefined` if
  `byProject` is empty (guard: use `key: '', aiuCredits: 0` when empty, so
  `BreakdownSummaryCards` renders its "—" placeholder per Task 1).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectsPage } from './ProjectsPage';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');

  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <actual.ResponsiveContainer width={600} height={240}>
        {children}
      </actual.ResponsiveContainer>
    ),
  };
});

describe('ProjectsPage', () => {
  it('renders derived summary values, the chart, and the table', () => {
    render(
      <ProjectsPage
        byProject={[
          { key: 'org/repo-a', aiuCredits: 3 },
          { key: 'org/repo-b', aiuCredits: 1 },
        ]}
        onProjectClick={vi.fn()}
      />,
    );

    expect(screen.getByText('2')).toBeInTheDocument(); // count of projects
    expect(screen.getByText('4.00')).toBeInTheDocument(); // total credits
    expect(screen.getByText('org/repo-a')).toBeInTheDocument(); // top project appears (chart/table/card)
    expect(screen.getByText('Credits by project')).toBeInTheDocument();
  });

  it('renders an empty state without crashing when there are no projects', () => {
    render(<ProjectsPage byProject={[]} onProjectClick={vi.fn()} />);

    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('No data for this selection.')).toBeInTheDocument();
  });

  it('calls onProjectClick when a chart bar is clicked', () => {
    const onProjectClick = vi.fn();
    const { container } = render(
      <ProjectsPage
        byProject={[
          { key: 'org/repo-a', aiuCredits: 3 },
          { key: 'org/repo-b', aiuCredits: 1 },
        ]}
        onProjectClick={onProjectClick}
      />,
    );

    const bar = container.querySelector('.recharts-bar-rectangle');
    expect(bar).not.toBeNull();
    fireEvent.click(bar as Element);

    expect(onProjectClick).toHaveBeenCalledWith('org/repo-a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/ProjectsPage.test.tsx`
Expected: FAIL — `Cannot find module './ProjectsPage'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { BreakdownSummaryCards } from './BreakdownSummaryCards';
import { BreakdownChart } from './BreakdownChart';
import { SessionsTable } from './SessionsTable';
import type { BreakdownPoint } from '../../shared/types';

export interface ProjectsPageProps {
  byProject: BreakdownPoint[];
  onProjectClick: (project: string) => void;
}

export function ProjectsPage({ byProject, onProjectClick }: ProjectsPageProps) {
  const totalCredits = byProject.reduce((sum, p) => sum + p.aiuCredits, 0);
  const topProject = byProject.reduce<BreakdownPoint | null>(
    (top, p) => (!top || p.aiuCredits > top.aiuCredits ? p : top),
    null,
  );

  return (
    <div className="projects-page flex flex-col gap-6">
      <BreakdownSummaryCards
        countLabel="Projects"
        count={byProject.length}
        totalCredits={totalCredits}
        topLabel="Top project"
        topKey={topProject?.key ?? ''}
        topCredits={topProject?.aiuCredits ?? 0}
      />
      <BreakdownChart
        title="Credits by project"
        data={byProject}
        onBarClick={onProjectClick}
        colorByKey
      />
      <SessionsTable rows={byProject} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/ProjectsPage.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ProjectsPage.tsx src/renderer/components/ProjectsPage.test.tsx
git commit -m "feat: add ProjectsPage component"
```

---

### Task 5: `ModelsPage` component

**Files:**
- Create: `src/renderer/components/ModelsPage.tsx`
- Test: `src/renderer/components/ModelsPage.test.tsx`

**Interfaces:**
- Consumes: `BreakdownSummaryCards` (Task 1), `BreakdownChart` from
  `./BreakdownChart`, `ModelTable` (Task 2), `BreakdownPoint` from
  `../../shared/types`.
- Produces: `ModelsPage({ byModel }: ModelsPageProps)` named export,
  `ModelsPageProps` exported (`{ byModel: BreakdownPoint[] }`). No click
  handler — there is no per-model drill-down page.

Same derived-values pattern as `ProjectsPage` (Task 4), applied to `byModel`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModelsPage } from './ModelsPage';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');

  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <actual.ResponsiveContainer width={600} height={240}>
        {children}
      </actual.ResponsiveContainer>
    ),
  };
});

describe('ModelsPage', () => {
  it('renders derived summary values, the chart, and the model table', () => {
    render(
      <ModelsPage
        byModel={[
          { key: 'claude-sonnet-5', aiuCredits: 3 },
          { key: 'gpt-5.4', aiuCredits: 1 },
        ]}
      />,
    );

    expect(screen.getByText('2')).toBeInTheDocument(); // count of models
    expect(screen.getByText('4.00')).toBeInTheDocument(); // total credits
    expect(screen.getByText('Credits by model')).toBeInTheDocument();
    expect(screen.getByText('% of total')).toBeInTheDocument();
  });

  it('renders an empty state without crashing when there are no models', () => {
    render(<ModelsPage byModel={[]} />);

    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('No data for this selection.')).toBeInTheDocument();
    expect(screen.getByText('No models for this selection.')).toBeInTheDocument();
  });
});
```

Note: this test file needs the same `vi.mock('recharts', ...)` block used in
Task 4 — add the `vi` import from `'vitest'` alongside `describe`/`it`/`expect`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/ModelsPage.test.tsx`
Expected: FAIL — `Cannot find module './ModelsPage'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { BreakdownSummaryCards } from './BreakdownSummaryCards';
import { BreakdownChart } from './BreakdownChart';
import { ModelTable } from './ModelTable';
import type { BreakdownPoint } from '../../shared/types';

export interface ModelsPageProps {
  byModel: BreakdownPoint[];
}

export function ModelsPage({ byModel }: ModelsPageProps) {
  const totalCredits = byModel.reduce((sum, m) => sum + m.aiuCredits, 0);
  const topModel = byModel.reduce<BreakdownPoint | null>(
    (top, m) => (!top || m.aiuCredits > top.aiuCredits ? m : top),
    null,
  );

  return (
    <div className="models-page flex flex-col gap-6">
      <BreakdownSummaryCards
        countLabel="Models"
        count={byModel.length}
        totalCredits={totalCredits}
        topLabel="Top model"
        topKey={topModel?.key ?? ''}
        topCredits={topModel?.aiuCredits ?? 0}
      />
      <BreakdownChart title="Credits by model" data={byModel} />
      <ModelTable rows={byModel} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/ModelsPage.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ModelsPage.tsx src/renderer/components/ModelsPage.test.tsx
git commit -m "feat: add ModelsPage component"
```

---

### Task 6: `Sidebar` component

**Files:**
- Create: `src/renderer/components/Sidebar.tsx`
- Test: `src/renderer/components/Sidebar.test.tsx`

**Interfaces:**
- Produces: `DashboardTab` type (`'daily' | 'projects' | 'models' | 'raw'`)
  and `Sidebar({ activeTab, onTabChange }: SidebarProps)` named export, both
  exported from `Sidebar.tsx`. `SidebarProps = { activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void }`. `App.tsx` (Task 7) imports
  `DashboardTab` from this file to avoid duplicating the union type.

Uses `lucide-react` icons `CalendarDays`, `FolderKanban`, `Cpu`, `Database`
(all confirmed present in the installed `lucide-react` version). Each entry
is a `<button type="button">` with `role="button"` (implicit) and an
accessible name equal to its label, so tests/consumers can select by
`getByRole('button', { name: 'By project' })`. The active tab gets
`bg-primary text-primary-foreground` (reusing the "active tab" style already
used in `RawDataPage.tsx`'s table-name switcher); inactive tabs get
`text-foreground hover:bg-muted`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('renders all four navigation entries', () => {
    render(<Sidebar activeTab="daily" onTabChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Daily consumption' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'By project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'By model' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Raw data' })).toBeInTheDocument();
  });

  it('highlights the active tab', () => {
    render(<Sidebar activeTab="projects" onTabChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'By project' }).className).toContain('bg-primary');
    expect(screen.getByRole('button', { name: 'Daily consumption' }).className).not.toContain('bg-primary');
  });

  it('calls onTabChange with the clicked tab id', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<Sidebar activeTab="daily" onTabChange={onTabChange} />);

    await user.click(screen.getByRole('button', { name: 'By model' }));

    expect(onTabChange).toHaveBeenCalledWith('models');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/Sidebar.test.tsx`
Expected: FAIL — `Cannot find module './Sidebar'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { CalendarDays, Cpu, Database, FolderKanban } from 'lucide-react';

export type DashboardTab = 'daily' | 'projects' | 'models' | 'raw';

interface SidebarProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
}

const ENTRIES: Array<{ id: DashboardTab; label: string; icon: typeof CalendarDays }> = [
  { id: 'daily', label: 'Daily consumption', icon: CalendarDays },
  { id: 'projects', label: 'By project', icon: FolderKanban },
  { id: 'models', label: 'By model', icon: Cpu },
  { id: 'raw', label: 'Raw data', icon: Database },
];

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  return (
    <nav className="sidebar flex w-56 shrink-0 flex-col gap-1 border-r border-border p-4">
      {ENTRIES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onTabChange(id)}
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${
            activeTab === id
              ? 'bg-primary text-primary-foreground'
              : 'text-foreground hover:bg-muted'
          }`}
        >
          <Icon size={16} aria-hidden="true" />
          {label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/Sidebar.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/Sidebar.tsx src/renderer/components/Sidebar.test.tsx
git commit -m "feat: add Sidebar navigation component"
```

---

### Task 7: Wire `Sidebar` and the 3 new pages into `App.tsx`

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

**Interfaces:**
- Consumes: `Sidebar`, `DashboardTab` (Task 6), `DailyConsumptionPage` (Task
  3), `ProjectsPage` (Task 4), `ModelsPage` (Task 5), `RawDataPage`
  (existing), `ProjectDetailPage` (existing), `HourlyDetailPanel` (existing),
  `FilterBar` (existing), `useUsageData`/`useHourlyDetail` (existing hooks —
  unchanged).

This task replaces the `showRawData` boolean and the implicit "home" render
branch in `App.tsx` with `activeTab: DashboardTab` (imported from
`./components/Sidebar`), defaulting to `'daily'`. Behavior:

- The layout becomes a flex row: `<Sidebar .../>` + a content column (the
  existing header, `FilterBar`, error/loading/data blocks, moved into the
  content column).
- The header row (title "Credits Dashboard" + old "Raw data" button) loses
  its "Raw data" button — that's now a sidebar entry — but keeps the title.
  Per the existing test `expect(screen.queryByRole('heading', { name: 'Credits Dashboard' })).not.toBeInTheDocument()` while in project detail, and
  `expect(screen.getByRole('heading', { name: 'Credits Dashboard' })).toBeInTheDocument()` after going back — keep that same title-hiding rule, but now
  keyed off `selectedProject` (unchanged trigger), not `activeTab`.
- `FilterBar` renders when `activeTab !== 'raw' && !selectedProject` (already
  true today for the raw-data case; extending the same condition to the 3
  stats tabs).
- Selecting a new tab in `Sidebar`'s `onTabChange` handler must also clear
  `selectedProject` and `selectedDate`, so switching tabs never leaves a
  stale overlay open:

```tsx
function handleTabChange(tab: DashboardTab): void {
  setActiveTab(tab);
  setSelectedProject(null);
  setSelectedDate(null);
}
```

- Body routing (inside the content column, when `data` is loaded and
  `!selectedProject`):

```tsx
{data && !selectedProject && activeTab === 'daily' && (
  <div className="mt-6">
    <DailyConsumptionPage
      totals={data.totals}
      timeSeries={data.timeSeries}
      onDayClick={setSelectedDate}
    />
  </div>
)}
{data && !selectedProject && activeTab === 'projects' && (
  <div className="mt-6">
    <ProjectsPage byProject={data.byProject} onProjectClick={setSelectedProject} />
  </div>
)}
{data && !selectedProject && activeTab === 'models' && (
  <div className="mt-6">
    <ModelsPage byModel={data.byModel} />
  </div>
)}
{activeTab === 'raw' && !selectedProject && <RawDataPage onBack={() => setActiveTab('daily')} />}
```

  `RawDataPage`'s existing `onBack` prop is repurposed to just switch
  `activeTab` back to `'daily'` (its "← Back" button remains, but now acts as
  "return to daily consumption" instead of toggling a boolean).
- `selectedProject` still fully overrides the tab content with
  `ProjectDetailPage`, exactly as today, but the `Sidebar` stays rendered
  alongside it (this is the one intentional behavior change flagged in the
  spec).
- Remove the now-unused `showRawData` state and the `EMPTY_OPTIONS`-adjacent
  logic is untouched.

Here is the full replacement for `App.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useUsageData } from './hooks/useUsageData';
import { useHourlyDetail } from './hooks/useHourlyDetail';
import { EmptyState } from './components/EmptyState';
import { FilterBar } from './components/FilterBar';
import { Sidebar, type DashboardTab } from './components/Sidebar';
import { DailyConsumptionPage } from './components/DailyConsumptionPage';
import { ProjectsPage } from './components/ProjectsPage';
import { ModelsPage } from './components/ModelsPage';
import { ProjectDetailPage } from './components/ProjectDetailPage';
import { RawDataPage } from './components/RawDataPage';
import { HourlyDetailPanel } from './components/HourlyDetailPanel';
import { Skeleton } from './components/ui/skeleton';
import type { FilterOptions, UsageFilters } from '../shared/types';

const EMPTY_OPTIONS: FilterOptions = { projects: [], models: [], minDate: null, maxDate: null };

export function App() {
  const [options, setOptions] = useState<FilterOptions>(EMPTY_OPTIONS);
  const [optionsError, setOptionsError] = useState<Error | null>(null);
  const [filters, setFilters] = useState<UsageFilters>({});
  const [activeTab, setActiveTab] = useState<DashboardTab>('daily');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const { data, loading, error } = useUsageData(filters);
  const hourlyDetail = useHourlyDetail(selectedDate, filters);

  useEffect(() => {
    window.api
      .getFilterOptions()
      .then(setOptions)
      .catch((err) => setOptionsError(err instanceof Error ? err : new Error(String(err))));
  }, []);

  function handleTabChange(tab: DashboardTab): void {
    setActiveTab(tab);
    setSelectedProject(null);
    setSelectedDate(null);
  }

  if ((optionsError || error) && !data) {
    return (
      <EmptyState
        title="Couldn't load Copilot CLI usage data."
        message="Make sure Copilot CLI has been used on this machine, then reopen the app."
      />
    );
  }

  return (
    <div className="app flex min-h-screen bg-background">
      <Sidebar activeTab={activeTab} onTabChange={handleTabChange} />
      <div className="flex-1 px-6 py-8">
        {!selectedProject && (
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-2xl font-semibold text-foreground">Credits Dashboard</h1>
          </div>
        )}
        {activeTab === 'raw' && !selectedProject ? (
          <RawDataPage onBack={() => setActiveTab('daily')} />
        ) : (
          <>
            {!selectedProject && <FilterBar options={options} filters={filters} onChange={setFilters} />}
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
            {data && selectedProject && (
              <div className="mt-6">
                <ProjectDetailPage
                  project={selectedProject}
                  filters={filters}
                  options={options}
                  onFiltersChange={setFilters}
                  onBack={() => setSelectedProject(null)}
                />
              </div>
            )}
            {data && !selectedProject && activeTab === 'daily' && (
              <div className="mt-6">
                <DailyConsumptionPage
                  totals={data.totals}
                  timeSeries={data.timeSeries}
                  onDayClick={setSelectedDate}
                />
              </div>
            )}
            {data && !selectedProject && activeTab === 'projects' && (
              <div className="mt-6">
                <ProjectsPage byProject={data.byProject} onProjectClick={setSelectedProject} />
              </div>
            )}
            {data && !selectedProject && activeTab === 'models' && (
              <div className="mt-6">
                <ModelsPage byModel={data.byModel} />
              </div>
            )}
          </>
        )}
      </div>
      {selectedDate && (
        <HourlyDetailPanel
          date={selectedDate}
          data={hourlyDetail.data}
          loading={hourlyDetail.loading}
          error={hourlyDetail.error}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
}
```

Now update `App.test.tsx` (already reviewed above). The daily consumption
view is the default tab, so most existing assertions (`'3.00'`, `'Credits by
project'` after navigating, etc.) need their triggering navigation updated:

- The test `'navigates to the project detail page when a project bar is
  clicked and back again'` currently finds `'Credits by project'` right
  after the initial render. Since that chart now lives under the "By
  project" tab, add a click on `screen.getByRole('button', { name: 'By
  project' })` before locating the chart.
- The test `'navigates to the raw data page when "Raw data" is clicked and
  back again'` currently clicks `screen.getByRole('button', { name: 'Raw
  data' })` assuming it's a header button — this still works unchanged since
  `Sidebar` renders a button with that same accessible name. But its "back"
  assertion (`expect(await screen.findByText('Credits by project'))...`)
  must also switch to first clicking "By project" after going back, since
  going back now returns to the `'daily'` tab, not directly to the projects
  view.

Here is the full replacement for the two affected tests (`'navigates to the
project detail page...'` and `'navigates to the raw data page...'`); all
other tests in the file are unchanged:

```tsx
  it('navigates to the project detail page when a project bar is clicked and back again', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('3.00');

    await user.click(screen.getByRole('button', { name: 'By project' }));

    const projectChartCard = screen.getByText('Credits by project').closest('.chart-card') as HTMLElement;
    expect(projectChartCard).not.toBeNull();

    const projectChart = within(projectChartCard).getByTestId('breakdown-chart');
    const bar = projectChart.querySelector('.recharts-bar-rectangle');
    expect(bar).not.toBeNull();

    await user.click(bar as Element);

    expect(await screen.findByRole('heading', { name: 'org/repo-a' })).toBeInTheDocument();
    expect(screen.getByText('Fixed the login bug')).toBeInTheDocument();
    expect(window.api.getProjectDetail).toHaveBeenCalledWith({ project: 'org/repo-a' });
    expect(screen.queryByRole('heading', { name: 'Credits Dashboard' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back/i }));

    expect(await screen.findByText('Credits by project')).toBeInTheDocument();
    expect(screen.queryByText('Fixed the login bug')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Credits Dashboard' })).toBeInTheDocument();
  });

  it('navigates to the raw data page when "Raw data" is clicked and back again', async () => {
    window.api.getRawTablePage = vi.fn().mockResolvedValue({
      columns: ['id', 'cwd'],
      rows: [{ id: 's1', cwd: 'C:/repo-a' }],
      total: 1,
      page: 0,
      pageSize: 50,
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('3.00');

    await user.click(screen.getByRole('button', { name: 'Raw data' }));

    expect(await screen.findByRole('heading', { name: 'Raw data' })).toBeInTheDocument();
    expect(screen.getByText('s1')).toBeInTheDocument();
    expect(screen.queryByText('Credits by project')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '← Back' }));

    expect(await screen.findByText('3.00')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Raw data' })).not.toBeInTheDocument();
  });
```

Additionally, add 2 new tests covering the "By model" tab and tab-clearing
overlay behavior, inserted right after the two tests above:

```tsx
  it('shows the models tab with a breakdown chart and table', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('3.00');

    await user.click(screen.getByRole('button', { name: 'By model' }));

    expect(await screen.findByText('Credits by model')).toBeInTheDocument();
    expect(screen.getByText('% of total')).toBeInTheDocument();
  });

  it('clears an open hourly detail panel when switching tabs', async () => {
    window.api.getHourlyDetail = vi.fn().mockResolvedValue([
      { hour: '10:00', aiuCredits: 3, byProject: { 'org/repo-a': 3 } },
    ]);

    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('3.00');

    const timeSeriesChart = screen.getByTestId('time-series-chart');
    const bar = timeSeriesChart.querySelector('.recharts-bar-rectangle');
    expect(bar).not.toBeNull();
    await user.click(bar as Element);

    expect(await screen.findByText('10:00')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'By project' }));

    expect(screen.queryByText('10:00')).not.toBeInTheDocument();
  });
```

- [ ] **Step 1: Apply the `App.tsx` replacement above**

Replace the full contents of `src/renderer/App.tsx` with the code block
shown above.

- [ ] **Step 2: Apply the `App.test.tsx` test replacements above**

Replace the two existing tests (`'navigates to the project detail page...'`
and `'navigates to the raw data page...'`) with their updated versions, and
insert the 2 new tests immediately after them, all as shown above. Leave
every other test in the file untouched.

- [ ] **Step 3: Run the full App test file**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: PASS (all 9 tests: the original 7 minus none removed, plus the 2
new ones — note the two replaced tests keep the same `it(...)` titles, so the
count goes from 7 to 9).

- [ ] **Step 4: Run the complete test suite**

Run: `npm test`
Expected: PASS — all test files green, including
`BreakdownSummaryCards.test.tsx`, `ModelTable.test.tsx`,
`DailyConsumptionPage.test.tsx`, `ProjectsPage.test.tsx`,
`ModelsPage.test.tsx`, `Sidebar.test.tsx`, and `App.test.tsx` from prior
tasks.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx src/renderer/App.test.tsx
git commit -m "feat: wire sidebar navigation with daily/projects/models/raw tabs into App"
```

---

## Self-Review Notes

- **Spec coverage:** Sidebar with 4 entries (Task 6/7), daily consumption tab
  (Task 3/7), projects tab with SummaryCards+chart+table (Task 1/4/7), models
  tab with SummaryCards+chart+detailed table (Task 1/2/5/7), shared FilterBar
  hidden only on raw data (Task 7), tab switch clears overlays (Task 7,
  tested), Raw data as 4th sidebar entry (Task 6/7), no backend changes
  (verified — no task touches `src/main` or `preload.ts`) — all covered.
- **Placeholder scan:** no TBD/TODO; every step has runnable code and exact
  commands.
- **Type consistency:** `DashboardTab` defined once in `Sidebar.tsx` and
  imported by `App.tsx`; `BreakdownPoint`/`UsageTotals`/`TimeSeriesPoint`
  used consistently from `shared/types` across all new components; prop
  names (`onProjectClick`, `onDayClick`, `onTabChange`) match between each
  page component's definition and its usage in `App.tsx`.
