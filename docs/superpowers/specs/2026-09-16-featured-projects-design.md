# Featured projects page

## Context

Credits Tracker already uses a sidebar-driven React renderer with focused pages
for usage statistics, raw data, and logs. The app is intentionally local and
privacy-first: it reads local usage data and does not require a GitHub
connection.

This feature adds a curated **Featured projects** page to the sidebar. It
will showcase nine GitHub repositories selected by the user as static cards
with an icon, title, description, repository name, and tags. The page will
remain useful when the local Copilot database is unavailable because it does
not depend on usage data.

## Goals

- Add a `Featured projects` entry to the existing sidebar navigation.
- Display the nine supplied repositories as curated, statically defined cards.
- Give every card an icon, editorial title, concise description, repository
  identifier, and one or more tags.
- Filter the cards with a single active tag at a time, including an `All`
  state.
- Open a repository in the user's system browser when its card is activated.
- Preserve Electron context isolation and reject external URLs outside the
  approved GitHub repository shape.
- Keep the page responsive and consistent with the existing dark theme,
  `Card`, and `Badge` components.

## Non-goals

- No GitHub API calls, live repository metadata, avatars, or network-backed
  refreshes.
- No favorites, persistence, sorting controls, search field, or multi-tag
  selection in this iteration.
- No database, usage-query, or main-process data-model changes.
- No embedded GitHub pages or in-app browser.

## User decisions

- Metadata is static and embedded in the application so the page works
  offline.
- Filtering uses one active tag at a time, with an `All` option.
- Clicking a card opens the repository in the system browser.
- The menu entry and page title use the English label `Featured projects` to
  match the existing interface.
- The recommended implementation is a static catalogue plus a dedicated,
  validated IPC channel for external URLs.

## Curated catalogue

The catalogue is stored in a typed renderer module rather than fetched at
runtime. The descriptions below are concise editorial copy based on the
public repository descriptions and can be edited without changing the page
component.

| Repository | Description | Tags |
| --- | --- | --- |
| `rtk-ai/rtk` | A Rust CLI proxy that reduces LLM token consumption for common development commands. | AI coding, Developer tools, Performance |
| `obra/superpowers` | An agentic skills framework and software development methodology for structured coding work. | AI coding, Workflow, Skills |
| `ayghri/i-have-adhd` | An ADHD-friendly coding-agent skill that keeps answers visible, focused, and actionable. | AI coding, Productivity, Accessibility |
| `DietrichGebert/ponytail` | A pragmatic coding-agent approach that avoids unnecessary implementation and favors simple solutions. | AI coding, Productivity, Developer tools |
| `tt-a1i/archify` | An agent skill for producing beautiful, verifiable architecture, workflow, sequence, data-flow, and lifecycle diagrams. | AI coding, Architecture, Visualization |
| `affaan-m/ECC` | An agent-harness optimization system combining skills, instincts, memory, security, and research-first development. | AI coding, Developer tools, Workflow |
| `alibaba/open-code-review` | A hybrid deterministic and LLM-assisted code-review tool with line-level feedback and multi-language rules. | Code review, Security, AI coding |
| `kirodotdev/Kiro` | An agentic IDE designed to support software work from prototype through production. | AI coding, IDE, Spec-driven |
| `github/spec-kit` | A toolkit for getting started with spec-driven development. | Spec-driven, Developer tools, AI coding |

Each entry also contains its canonical URL in the form
`https://github.com/<owner>/<repo>`, a stable identifier, and an icon key.
Icon keys are mapped to existing `lucide-react` icons in the page component,
so the catalogue remains serializable and does not contain JSX.

## Architecture

### Navigation

Extend `DashboardTab` with `featured` and add one sidebar entry using a
`Sparkles` icon. `App.tsx` renders `FeaturedProjectsPage` when this tab is
active. The existing `handleTabChange` behavior continues to clear
`selectedProject` and `selectedDate`.

The featured route is checked before the database-dependent empty state. This
means the sidebar can still navigate to the curated page when
`getFilterOptions` or `getUsage` fails, while the existing error and Logs
experiences remain unchanged for the other tabs.

The page owns its heading and introduction. The surrounding dashboard header
remains hidden only for the existing project-detail behavior, not for the new
tab.

### Catalogue and page component

Add a module such as `src/renderer/data/featuredProjects.ts` containing:

```ts
export type FeaturedProjectTag = string;

export interface FeaturedProject {
  id: string;
  repository: string;
  url: string;
  title: string;
  description: string;
  icon: 'gauge' | 'sparkles' | 'focus' | 'wand' | 'workflow'
    | 'shield' | 'brain' | 'terminal' | 'file';
  tags: FeaturedProjectTag[];
}

export const FEATURED_PROJECTS: readonly FeaturedProject[] = [...];
```

`FeaturedProjectsPage` receives the catalogue (with the module constant as
the default caller-owned value) and keeps only the selected tag in local
state:

```ts
interface FeaturedProjectsPageProps {
  projects?: readonly FeaturedProject[];
}
```

It derives the unique displayed tags from the catalogue, starts with `All`,
and filters a project into the result when its `tags` array contains the
active tag. The page renders:

1. A heading and short explanation that these are curated GitHub projects.
2. An accessible filter group with `All` and one button per tag. Buttons expose
   `aria-pressed`.
3. A responsive grid of cards.
4. A concise empty state if a future catalogue or filter produces no cards.

Each card reuses `Card` and `Badge`, presents its mapped Lucide icon in a
decorative icon container, and exposes the repository as visible text. The
whole card is keyboard activatable and has an explicit `View on GitHub`
affordance without nesting interactive controls.

### External-browser bridge

Add `openExternalUrl(url: string): Promise<void>` to the preload API and to
the renderer `Window.api` declaration. Register an `open-external-url` handler
in `src/main/ipc-handlers.ts`.

The handler validates the input with `URL` before calling Electron's
`shell.openExternal`:

- protocol must be exactly `https:`;
- hostname must be exactly `github.com`;
- pathname must contain an owner and repository segment;
- credentials, query-based redirects, and other hosts are rejected.

The catalogue only supplies the canonical repository URLs, but validation
keeps the bridge safe if future data is edited incorrectly or another
renderer caller is introduced. The validated URL is passed unchanged to
`shell.openExternal`.

`FeaturedProjectsPage` awaits the bridge call. If it rejects, the page logs
the failure through `logError` and shows a non-blocking `role="alert"` message
such as `Could not open this GitHub repository. Please try again.` It does not
pretend that the browser was opened.

## Data flow

```text
FEATURED_PROJECTS
        |
        v
FeaturedProjectsPage -- selected tag --> filtered cards
        |
        | card activation
        v
window.api.openExternalUrl(url)
        |
        v
ipcMain open-external-url -- validate --> shell.openExternal(url)
```

There are no changes to `useUsageData`, database queries, shared usage types,
or update behavior. The featured page is independent of loading and refresh
states for usage data.

## Error handling

- Invalid external URLs fail in the main-process handler with an explicit
  error and are never passed to `shell.openExternal`.
- Browser-launch failures propagate to the renderer, are logged with the
  existing logger, and are shown in an alert within the page.
- An empty filtered result is rendered as an intentional empty state rather
  than a blank page.
- Existing database errors continue to affect only database-backed tabs; the
  static page remains navigable.

## Testing

Add or update tests covering:

- `FeaturedProjectsPage` renders all nine supplied repositories, titles,
  descriptions, icons, tags, and the `All` filter.
- Selecting a tag shows only matching cards and marks the selected filter
  with `aria-pressed`; selecting `All` restores every card.
- Card activation calls `window.api.openExternalUrl` with the exact canonical
  repository URL.
- A rejected browser-open call produces the alert and logs the failure.
- `Sidebar.test.tsx` renders and activates `Featured projects`.
- `App.test.tsx` reaches the page through the sidebar and still reaches it
  when usage-data loading fails.
- `ipc-handlers.test.ts` registers `open-external-url`, accepts a valid
  GitHub repository URL, calls `shell.openExternal`, and rejects non-HTTPS,
  non-GitHub, malformed, or incomplete repository URLs.

## Acceptance criteria

- The new tab is visible and highlighted using the same sidebar conventions as
  existing tabs.
- All nine user-supplied repositories appear on the page by default.
- Cards contain an icon, title, description, repository name, and tags.
- A single tag filter changes the visible cards without a network request.
- Clicking a card opens the corresponding GitHub repository in the system
  browser, and invalid URLs cannot reach `shell.openExternal`.
- The page works when the local usage database cannot be loaded.
- Existing tabs and update/logging behavior continue to work.
