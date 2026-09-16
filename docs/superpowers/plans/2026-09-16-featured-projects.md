# Featured projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an offline-friendly Featured projects page with curated GitHub cards, one-tag filtering, and safe system-browser links.

**Architecture:** Keep the nine-project catalogue in a typed renderer data module and render it through a focused `FeaturedProjectsPage`. Add a validated `open-external-url` IPC bridge so the renderer can request the system browser without breaking Electron context isolation. Integrate the page as a sidebar tab that is independent of usage-data loading.

**Tech Stack:** Electron 44, React 19, TypeScript 7, `lucide-react`, Tailwind CSS 4, Vitest 5, Testing Library.

## Global Constraints

- Metadata is static and embedded in the application so the page works offline.
- Filtering uses one active tag at a time, with an `All` option.
- Clicking a card opens the repository in the system browser.
- The menu entry and page title use the English label `Featured projects`.
- Only `https://github.com/<owner>/<repo>` repository URLs may reach `shell.openExternal`.
- No GitHub API calls, live repository metadata, avatars, or network-backed refreshes.
- No database, usage-query, or main-process data-model changes.
- Reuse the existing dark theme, `Card`, `Badge`, logger, sidebar, and test conventions.
- Run tests through the repository's existing `npm test` script; do not add dependencies or test tooling.
- Every implementation commit uses a Conventional Commit message and ends with `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/main/ipc-handlers.ts` | Validate approved external repository URLs and dispatch them to Electron's system browser. |
| `src/main/ipc-handlers.test.ts` | Verify IPC registration, URL acceptance/rejection, and `shell.openExternal` calls. |
| `src/preload.ts` | Expose the narrow `openExternalUrl` bridge method. |
| `src/renderer/window.d.ts` | Type the new renderer bridge method. |
| `src/renderer/App.test.tsx`, `src/renderer/components/LogsPage.test.tsx`, `src/renderer/components/ProjectDetailPage.test.tsx`, `src/renderer/components/RawDataPage.test.tsx` | Add the bridge mock to full renderer API fixtures. |
| `src/renderer/hooks/useHourlyDetail.test.ts`, `src/renderer/hooks/useMonthlyActivity.test.ts`, `src/renderer/hooks/useProjectDetail.test.ts`, `src/renderer/hooks/useRawTable.test.ts`, `src/renderer/hooks/useUsageData.test.ts` | Add the bridge mock to hook API fixtures so the required Window API type remains valid. |
| `src/renderer/data/featuredProjects.ts` | Store the nine curated projects, icon keys, descriptions, and tags. |
| `src/renderer/components/FeaturedProjectsPage.tsx` | Render the heading, filter controls, cards, empty state, and browser-open error. |
| `src/renderer/components/FeaturedProjectsPage.test.tsx` | Test catalogue rendering, tag filtering, activation, and error feedback. |
| `src/renderer/components/Sidebar.tsx` | Add the `featured` tab and `Sparkles` icon. |
| `src/renderer/components/Sidebar.test.tsx` | Verify the new sidebar entry and active behavior. |
| `src/renderer/App.tsx` | Route the `featured` tab before database-dependent states. |
| `src/renderer/App.test.tsx` | Verify navigation and availability when usage loading fails. |
| `README.md` | Document the seventh tab and its static curated-project behavior. |

---

### Task 1: Adding the validated external-browser bridge

**Files:**
- Modify: `src/main/ipc-handlers.test.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/preload.ts`
- Modify: `src/renderer/window.d.ts`
- Modify: `src/renderer/App.test.tsx`
- Modify: `src/renderer/components/LogsPage.test.tsx`
- Modify: `src/renderer/components/ProjectDetailPage.test.tsx`
- Modify: `src/renderer/components/RawDataPage.test.tsx`
- Modify: `src/renderer/hooks/useHourlyDetail.test.ts`
- Modify: `src/renderer/hooks/useMonthlyActivity.test.ts`
- Modify: `src/renderer/hooks/useProjectDetail.test.ts`
- Modify: `src/renderer/hooks/useRawTable.test.ts`
- Modify: `src/renderer/hooks/useUsageData.test.ts`

**Interfaces:**
- Produces `window.api.openExternalUrl(url: string): Promise<void>`.
- Registers the main-process channel `open-external-url`.
- Accepts only a canonical HTTPS GitHub repository URL with exactly two non-empty path segments after `github.com`.

- [ ] **Step 1: Write failing IPC tests for registration and valid URLs**

In `src/main/ipc-handlers.test.ts`, import `shell` alongside `app` and add
`openExternal` to the Electron mock:

```ts
import { app, ipcMain, shell } from 'electron';

shell: {
  showItemInFolder: vi.fn(),
  openExternal: vi.fn().mockResolvedValue(undefined),
},
```

Add a test that registers the handlers, retrieves `open-external-url` from
the mocked handler map, awaits it with
`https://github.com/rtk-ai/rtk`, and asserts:

```ts
await expect(
  handlers.get('open-external-url')!({}, 'https://github.com/rtk-ai/rtk'),
).resolves.toBeUndefined();
expect(shell.openExternal).toHaveBeenCalledWith('https://github.com/rtk-ai/rtk');
```

- [ ] **Step 2: Write failing rejection tests for unsafe URLs**

Add a table-driven test covering these inputs:

```ts
[
  'http://github.com/rtk-ai/rtk',
  'https://evil.example/rtk-ai/rtk',
  'https://github.com/rtk-ai',
  'https://github.com/rtk-ai/rtk/issues',
  'https://github.com/rtk-ai/rtk?redirect=https://evil.example',
  'not a URL',
]
```

For every value, assert that the handler rejects and that
`shell.openExternal` has not been called for that invocation. The test may
clear the mock between cases so the assertion only covers the current input.

- [ ] **Step 3: Run the focused tests and confirm they fail**

Run:

```text
npm test -- src/main/ipc-handlers.test.ts
```

Expected: FAIL because `open-external-url` is not registered and
`openExternal` is not yet exposed by the implementation.

- [ ] **Step 4: Implement strict URL validation and the IPC handler**

In `src/main/ipc-handlers.ts`, add a private validator near the other handler
helpers:

```ts
function validateExternalRepositoryUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Only GitHub repository URLs can be opened');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Only GitHub repository URLs can be opened');
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== 'github.com'
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.search
    || parsed.hash
    || segments.length !== 2
  ) {
    throw new Error('Only GitHub repository URLs can be opened');
  }

  return value;
}
```

Register the channel inside `registerIpcHandlers`:

```ts
handle('open-external-url', (_event: unknown, value: unknown) => {
  return shell.openExternal(validateExternalRepositoryUrl(value));
});
```

Import `shell` from `electron` with the existing `app` and `ipcMain`
imports. The existing `handle` wrapper will surface synchronous validation
errors through the rejected IPC call.

- [ ] **Step 5: Expose and type the bridge**

In `src/preload.ts`, add the bridge method beside the other renderer-facing
methods:

```ts
openExternalUrl: (url: string): Promise<void> =>
  ipcRenderer.invoke('open-external-url', url),
```

In `src/renderer/window.d.ts`, add the matching declaration:

```ts
openExternalUrl: (url: string) => Promise<void>;
```

- [ ] **Step 6: Keep existing renderer test fixtures type-safe**

Because `Window.api` is a complete required interface, add this property to
the existing `window.api = { ... }` fixtures in
`src/renderer/App.test.tsx`,
`src/renderer/components/LogsPage.test.tsx`,
`src/renderer/components/ProjectDetailPage.test.tsx`,
`src/renderer/components/RawDataPage.test.tsx`,
`src/renderer/hooks/useHourlyDetail.test.ts`,
`src/renderer/hooks/useMonthlyActivity.test.ts`,
`src/renderer/hooks/useProjectDetail.test.ts`,
`src/renderer/hooks/useRawTable.test.ts`, and
`src/renderer/hooks/useUsageData.test.ts`:

```ts
openExternalUrl: vi.fn().mockResolvedValue(undefined),
```

Keep the existing API mocks and imports unchanged; this property only fills
the new bridge contract.

- [ ] **Step 7: Run the focused tests and confirm they pass**

Run:

```text
npm test -- src/main/ipc-handlers.test.ts
```

Expected: PASS, including the existing IPC tests and the new valid/invalid
URL cases.

- [ ] **Step 8: Commit the bridge**

```text
rtk git add src/main/ipc-handlers.ts src/main/ipc-handlers.test.ts src/preload.ts src/renderer/window.d.ts src/renderer/App.test.tsx src/renderer/components/LogsPage.test.tsx src/renderer/components/ProjectDetailPage.test.tsx src/renderer/components/RawDataPage.test.tsx src/renderer/hooks/useHourlyDetail.test.ts src/renderer/hooks/useMonthlyActivity.test.ts src/renderer/hooks/useProjectDetail.test.ts src/renderer/hooks/useRawTable.test.ts src/renderer/hooks/useUsageData.test.ts
rtk git commit -m "feat: add validated external URL bridge" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Building the static catalogue and featured-project cards

**Files:**
- Create: `src/renderer/data/featuredProjects.ts`
- Create: `src/renderer/components/FeaturedProjectsPage.tsx`
- Create: `src/renderer/components/FeaturedProjectsPage.test.tsx`

**Interfaces:**
- Consumes `window.api.openExternalUrl(url: string): Promise<void>` from Task 1.
- Produces `FEATURED_PROJECTS: readonly FeaturedProject[]` and a
  `FeaturedProjectsPage` component with optional
  `projects?: readonly FeaturedProject[]` props for isolated tests.

- [ ] **Step 1: Write the typed catalogue**

Create `src/renderer/data/featuredProjects.ts` with the following type shape
and all nine entries:

```ts
export type FeaturedProjectIcon =
  | 'gauge'
  | 'sparkles'
  | 'focus'
  | 'wand'
  | 'workflow'
  | 'shield'
  | 'brain'
  | 'terminal'
  | 'file';

export interface FeaturedProject {
  id: string;
  repository: string;
  url: string;
  title: string;
  description: string;
  icon: FeaturedProjectIcon;
  tags: string[];
}
```

Use these exact repository URLs, repository identifiers, and tags:

```ts
{
  id: 'rtk',
  repository: 'rtk-ai/rtk',
  url: 'https://github.com/rtk-ai/rtk',
  title: 'RTK',
  description: 'A Rust CLI proxy that reduces LLM token consumption for common development commands.',
  icon: 'gauge',
  tags: ['AI coding', 'Developer tools', 'Performance'],
}
{
  id: 'superpowers',
  repository: 'obra/superpowers',
  url: 'https://github.com/obra/superpowers',
  title: 'Superpowers',
  description: 'An agentic skills framework and software development methodology for structured coding work.',
  icon: 'sparkles',
  tags: ['AI coding', 'Workflow', 'Skills'],
}
{
  id: 'i-have-adhd',
  repository: 'ayghri/i-have-adhd',
  url: 'https://github.com/ayghri/i-have-adhd',
  title: 'I Have ADHD',
  description: 'An ADHD-friendly coding-agent skill that keeps answers visible, focused, and actionable.',
  icon: 'focus',
  tags: ['AI coding', 'Productivity', 'Accessibility'],
}
{
  id: 'ponytail',
  repository: 'DietrichGebert/ponytail',
  url: 'https://github.com/DietrichGebert/ponytail',
  title: 'Ponytail',
  description: 'A pragmatic coding-agent approach that avoids unnecessary implementation and favors simple solutions.',
  icon: 'wand',
  tags: ['AI coding', 'Productivity', 'Developer tools'],
}
{
  id: 'archify',
  repository: 'tt-a1i/archify',
  url: 'https://github.com/tt-a1i/archify',
  title: 'Archify',
  description: 'An agent skill for producing beautiful, verifiable architecture, workflow, sequence, data-flow, and lifecycle diagrams.',
  icon: 'workflow',
  tags: ['AI coding', 'Architecture', 'Visualization'],
}
{
  id: 'ecc',
  repository: 'affaan-m/ECC',
  url: 'https://github.com/affaan-m/ECC',
  title: 'Everything Claude Code',
  description: 'An agent-harness optimization system combining skills, instincts, memory, security, and research-first development.',
  icon: 'shield',
  tags: ['AI coding', 'Developer tools', 'Workflow'],
}
{
  id: 'open-code-review',
  repository: 'alibaba/open-code-review',
  url: 'https://github.com/alibaba/open-code-review',
  title: 'Open Code Review',
  description: 'A hybrid deterministic and LLM-assisted code-review tool with line-level feedback and multi-language rules.',
  icon: 'brain',
  tags: ['Code review', 'Security', 'AI coding'],
}
{
  id: 'kiro',
  repository: 'kirodotdev/Kiro',
  url: 'https://github.com/kirodotdev/Kiro',
  title: 'Kiro',
  description: 'An agentic IDE designed to support software work from prototype through production.',
  icon: 'terminal',
  tags: ['AI coding', 'IDE', 'Spec-driven'],
}
{
  id: 'spec-kit',
  repository: 'github/spec-kit',
  url: 'https://github.com/github/spec-kit',
  title: 'Spec Kit',
  description: 'A toolkit for getting started with spec-driven development.',
  icon: 'file',
  tags: ['Spec-driven', 'Developer tools', 'AI coding'],
}
```

- [ ] **Step 2: Write failing component tests for default rendering and filtering**

Create `src/renderer/components/FeaturedProjectsPage.test.tsx`. Set
`window.api` to a test bridge with the new method and logger:

```ts
const openExternalUrl = vi.fn().mockResolvedValue(undefined);
const log = vi.fn().mockResolvedValue(undefined);
window.api = { ...(window.api ?? {}), openExternalUrl, log } as typeof window.api;
```

Add tests that:

```ts
render(<FeaturedProjectsPage />);

expect(screen.getByRole('heading', { name: 'Featured projects' })).toBeInTheDocument();
expect(screen.getByText('rtk-ai/rtk')).toBeInTheDocument();
expect(screen.getByText('github/spec-kit')).toBeInTheDocument();
expect(screen.getAllByTestId('featured-project-card')).toHaveLength(9);
expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
```

Then click the `Accessibility` filter and assert that only
`ayghri/i-have-adhd` remains visible and the filter button has
`aria-pressed="true"`. Click `All` again and assert that all nine cards return.

- [ ] **Step 3: Run the component tests and confirm they fail**

Run:

```text
npm test -- src/renderer/components/FeaturedProjectsPage.test.tsx
```

Expected: FAIL because the catalogue and page do not exist.

- [ ] **Step 4: Implement the page layout and tag filtering**

Create `FeaturedProjectsPage.tsx` with:

```ts
interface FeaturedProjectsPageProps {
  projects?: readonly FeaturedProject[];
}

export function FeaturedProjectsPage({
  projects = FEATURED_PROJECTS,
}: FeaturedProjectsPageProps) {
  const [activeTag, setActiveTag] = useState('All');
  const tags = Array.from(new Set(projects.flatMap((project) => project.tags)));
  const visibleProjects = activeTag === 'All'
    ? projects
    : projects.filter((project) => project.tags.includes(activeTag));

  return (
    <section className="featured-projects-page flex flex-col gap-6">
      <header>
        <h2>Featured projects</h2>
        <p>Curated GitHub projects for better AI-assisted development.</p>
      </header>
      <div role="group" aria-label="Filter featured projects">
        {['All', ...tags].map((tag) => (
          <button
            key={tag}
            type="button"
            aria-pressed={activeTag === tag}
            onClick={() => setActiveTag(tag)}
          >
            {tag}
          </button>
        ))}
      </div>
      {openError && <p role="alert">{openError}</p>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleProjects.map((project) => {
          const Icon = ICONS[project.icon];
          return (
            <Card key={project.id} data-testid="featured-project-card">
              <button
                type="button"
                aria-label={`Open ${project.repository} on GitHub`}
                onClick={() => void handleOpen(project)}
              >
                <Icon aria-hidden="true" />
                <h3>{project.title}</h3>
                <p>{project.repository}</p>
                <p>{project.description}</p>
                {project.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
                <span>View on GitHub</span>
                <ExternalLink aria-hidden="true" />
              </button>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
```

Use a local `activeTag` state initialized to `All`, derive unique tags with
`Array.from(new Set(projects.flatMap((project) => project.tags)))`, and filter
with:

```ts
const visibleProjects = activeTag === 'All'
  ? projects
  : projects.filter((project) => project.tags.includes(activeTag));
```

The function must render a `section.featured-projects-page` with a
`Featured projects` heading, the introductory copy
`Curated GitHub projects for better AI-assisted development.`, a
`role="group"` labelled `Filter featured projects`, the filter buttons, an
optional `role="alert"`, and a grid using
`grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3`.

Declare the icon map at module scope:

```ts
const ICONS: Record<FeaturedProjectIcon, LucideIcon> = {
  gauge: Gauge,
  sparkles: Sparkles,
  focus: Focus,
  wand: WandSparkles,
  workflow: Workflow,
  shield: ShieldCheck,
  brain: Brain,
  terminal: Terminal,
  file: FileText,
};
```

Map the nine icon keys to existing Lucide icons (`Gauge`, `Sparkles`,
`Focus`, `WandSparkles`, `Workflow`, `ShieldCheck`, `Brain`, `Terminal`, and
`FileText`). Keep the icon decorative with `aria-hidden="true"`.

Build each card from the existing `Card` and `Badge` components. Give the
card a `data-testid="featured-project-card"`, show the title, repository,
description, every tag, and a visible `View on GitHub` label with an
`ExternalLink` icon. Use one outer button for the complete card, with
`aria-label={\`Open ${project.repository} on GitHub\`}`, so no interactive
elements are nested.

- [ ] **Step 5: Add browser activation and failure feedback**

Add a focused handler inside the page:

```ts
const [openError, setOpenError] = useState<string | null>(null);

async function handleOpen(project: FeaturedProject): Promise<void> {
  setOpenError(null);
  try {
    await window.api.openExternalUrl(project.url);
  } catch (error) {
    logError('FeaturedProjectsPage', `Failed to open ${project.repository}`, error);
    setOpenError('Could not open this GitHub repository. Please try again.');
  }
}
```

Call it from the card button with `onClick={() => void handleOpen(project)}`.
Render `openError` as a `role="alert"` element above the grid. Render
`No featured projects match this tag.` when `visibleProjects.length === 0`.

- [ ] **Step 6: Add activation and error tests**

Extend the component test with:

```ts
await user.click(screen.getByRole('button', { name: /Open rtk-ai\/rtk on GitHub/i }));
expect(window.api.openExternalUrl).toHaveBeenCalledWith('https://github.com/rtk-ai/rtk');
```

Replace the bridge mock with `vi.fn().mockRejectedValue(new Error('browser unavailable'))`,
activate the same card, and assert:

```ts
expect(await screen.findByRole('alert')).toHaveTextContent(
  'Could not open this GitHub repository. Please try again.',
);
expect(window.api.log).toHaveBeenCalledWith(
  expect.objectContaining({ level: 'error', scope: 'FeaturedProjectsPage' }),
);
```

- [ ] **Step 7: Run the component tests and confirm they pass**

Run:

```text
npm test -- src/renderer/components/FeaturedProjectsPage.test.tsx
```

Expected: PASS for rendering, filtering, activation, and error feedback.

- [ ] **Step 8: Commit the catalogue and page**

```text
rtk git add src/renderer/data/featuredProjects.ts src/renderer/components/FeaturedProjectsPage.tsx src/renderer/components/FeaturedProjectsPage.test.tsx
rtk git commit -m "feat: add featured projects cards" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Integrating the new sidebar route

**Files:**
- Modify: `src/renderer/components/Sidebar.tsx`
- Modify: `src/renderer/components/Sidebar.test.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

**Interfaces:**
- Consumes `FeaturedProjectsPage` and `FEATURED_PROJECTS` from Task 2.
- Produces the `featured` `DashboardTab` route and the visible sidebar entry
  `Featured projects`.

- [ ] **Step 1: Extend Sidebar tests with the new entry**

Update the existing entry-count test to assert the existing six buttons plus:

```ts
expect(screen.getByRole('button', { name: 'Featured projects' })).toBeInTheDocument();
```

Add a click assertion:

```ts
await user.click(screen.getByRole('button', { name: 'Featured projects' }));
expect(onTabChange).toHaveBeenCalledWith('featured');
```

Update the active-tab test to render `activeTab="featured"` and assert that
the new button contains `bg-primary`.

- [ ] **Step 2: Run Sidebar tests and confirm they fail**

Run:

```text
npm test -- src/renderer/components/Sidebar.test.tsx
```

Expected: FAIL because `featured` is not part of `DashboardTab` or `ENTRIES`.

- [ ] **Step 3: Add the featured Sidebar entry**

In `Sidebar.tsx`, import `Sparkles`, extend the union:

```ts
export type DashboardTab =
  | 'daily'
  | 'monthly'
  | 'projects'
  | 'models'
  | 'raw'
  | 'logs'
  | 'featured';
```

Add the entry to `ENTRIES`:

```ts
{ id: 'featured', label: 'Featured projects', icon: Sparkles },
```

Keep the existing ordering and update badge behavior unchanged.

- [ ] **Step 4: Route the page independently of usage data**

In `App.tsx`, import `FeaturedProjectsPage` and insert
`activeTab === 'featured' ? <FeaturedProjectsPage /> :` immediately after
the existing Logs branch and immediately before the existing
`dataUnavailable ?` branch. Leave the existing empty-state and
database-backed branches unchanged after this insertion.

Do not add `FilterBar`, `useUsageData`, or any IPC data call to the featured
branch. Keep `handleTabChange` unchanged so it still clears project and hourly
detail state when switching to this tab.

- [ ] **Step 5: Run Sidebar tests and confirm they pass**

Run:

```text
npm test -- src/renderer/components/Sidebar.test.tsx
```

Expected: PASS for all existing sidebar tests and the new featured entry.

- [ ] **Step 6: Add App navigation tests**

Add an App integration test that waits for the initial dashboard, clicks
`Featured projects`, and asserts:

```ts
expect(await screen.findByRole('heading', { name: 'Featured projects' })).toBeInTheDocument();
expect(screen.getByText('rtk-ai/rtk')).toBeInTheDocument();
expect(screen.queryByLabelText('Project path')).not.toBeInTheDocument();
```

Add a database-failure case that rejects `getFilterOptions` and `getUsage`,
renders the app, clicks `Featured projects`, and asserts the featured heading
and card instead of the database empty-state message.

- [ ] **Step 7: Run App integration tests and confirm they pass**

Run:

```text
npm test -- src/renderer/App.test.tsx
```

Expected: PASS, including the existing dashboard, error, raw-data, logs, and
new featured-navigation tests.

- [ ] **Step 8: Commit the navigation integration**

```text
rtk git add src/renderer/components/Sidebar.tsx src/renderer/components/Sidebar.test.tsx src/renderer/App.tsx src/renderer/App.test.tsx
rtk git commit -m "feat: add featured projects navigation" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Updating product documentation and completing validation

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes the finished `Featured projects` behavior from Tasks 1–3.
- Produces user-facing documentation that names seven sidebar tabs and
  describes the curated-project page accurately.

- [ ] **Step 1: Update the README feature list**

Change the sidebar wording from six tabs to seven and add this feature bullet
after the model/project entries. Ensure the existing monthly tab is also
listed so all seven entries are documented:

```md
- **Monthly activity** — a calendar heatmap that shows daily activity and
  makes high-usage days easy to spot.
- **Featured projects** — a curated, offline-friendly collection of GitHub
  projects with descriptions, tags, and one-click links to open each
  repository in the system browser.
```

Do not describe live GitHub synchronization, repository avatars, or metadata
refreshes because the implementation is intentionally static.

- [ ] **Step 2: Run the complete existing test suite**

Run:

```text
npm test
```

Expected: PASS for the complete Vitest suite, including the new renderer and
IPC tests.

- [ ] **Step 3: Check the final diff for formatting and scope**

Run:

```text
rtk git diff --check
rtk git status --short
rtk git log -5 --oneline
```

Expected: no whitespace errors, only the files listed in this plan changed,
and the implementation/documentation commits are present in the recent log.

- [ ] **Step 4: Commit the documentation**

```text
rtk git add README.md
rtk git commit -m "docs: document featured projects tab" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

- [ ] **Step 5: Run the complete suite once after the documentation commit**

Run:

```text
npm test
```

Expected: PASS with the final working tree containing no uncommitted
implementation or documentation changes.
