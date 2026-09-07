# Credits Dashboard — UI Redesign (Tailwind CSS + shadcn/ui)

**Status:** Approved (autonomous decision — user unavailable for live review; decisions documented below for later review)
**Date:** 2026-09-07
**Builds on:** `docs/superpowers/specs/2026-09-07-credits-dashboard-design.md` (original app design, already implemented and merged)

## Context

The Credits Dashboard app (Electron + React + Vite/TypeScript) is fully implemented,
tested (32 tests passing), and merged to `master`. It works functionally but has
no visual styling at all — components render with browser-default HTML (no CSS
file exists anywhere in the renderer). The user asked to modernize the UI.

## Goal

Restyle the existing renderer components with a modern, dark-themed dashboard
look, using **Tailwind CSS** for utility styling and **shadcn/ui** for
accessible, pre-built UI primitives (Card, Select, Table, Badge, Skeleton).

**Explicitly out of scope:**
- No changes to Electron main process, IPC, database layer, or business logic.
- No changes to component props/interfaces — every existing component keeps
  its exact same public API (`SummaryCards({ totals })`, `FilterBar({ options,
  filters, onChange })`, etc.) so no consumer code changes beyond JSX/styling.
- No light/dark theme toggle — dark mode only, decided autonomously (standard
  choice for a developer-facing local tool; documented here for the user to
  override later if desired).
- No new features (no toggle, no new filters, no new data).

## Decisions Made Autonomously (user was unavailable to confirm live)

1. **Dark mode only**, no toggle. Rationale: this is a local dev-tool
   dashboard, dark mode is the common default expectation for this audience,
   and a toggle adds complexity (theme persistence, system-preference
   detection) with no clearly requested benefit for a v1.
2. **shadcn/ui over Mantine/Chakra/Ant Design**. Rationale: shadcn/ui copies
   component source directly into the repo (no opaque runtime dependency),
   composes cleanly with the project's existing plain-CSS-class components,
   and its accessible Radix UI primitives (Select, Table) are drop-in
   replacements for the native `<select>`/`<table>` elements already in use —
   preserving all existing `getByLabelText`/`getByRole` test queries.
3. **Restyle in place, no restructuring.** Every existing `.tsx` component
   file is edited to add Tailwind classes and swap native HTML elements for
   shadcn primitives; no component is renamed, split, or moved.

If the user wants a toggle or a different library after reviewing this spec,
that's a follow-up, not a blocker for this round.

## Architecture

### New tooling (renderer-only, no Electron/main process impact)

- **Tailwind CSS v4** (`tailwindcss`, `@tailwindcss/vite` — Vite plugin, avoids
  a separate PostCSS config file since the project already uses Vite for the
  renderer build).
- **shadcn/ui** components, generated via the `npx shadcn@latest add <component>`
  CLI (or manually authored if the CLI doesn't fit the project's existing
  `vite.renderer.config.ts` alias setup) into
  `src/renderer/components/ui/` — a new directory, isolated from the
  existing feature components in `src/renderer/components/`.
- Supporting libraries: `class-variance-authority`, `clsx`, `tailwind-merge`
  (shadcn's standard `cn()` utility, in a new `src/renderer/lib/utils.ts`),
  `lucide-react` (icon set used by shadcn examples).
- **Correction made during planning:** the original draft of this spec
  proposed replacing `FilterBar`'s native `<select>` elements with shadcn's
  `Select` component (Radix UI-based). This was reconsidered: Radix's
  `Select` does not render a native `<select>` element (it's a
  button-triggered, portal-rendered custom listbox), which is incompatible
  with the existing test suite's `userEvent.selectOptions(...)` calls
  (`FilterBar.test.tsx`) — that API only works on real `<select>` elements.
  Since "no existing test may need to change" is a hard constraint of this
  redesign, **`FilterBar` keeps native `<select>`/`<input type="date">`
  elements**, restyled with Tailwind utility classes only (border, rounded
  corners, dark background, focus ring) — no Radix/shadcn `Select`
  component, no `@radix-ui/react-select` dependency needed.
- New file: `src/renderer/index.css` — Tailwind directives + shadcn's CSS
  custom properties (`--background`, `--foreground`, `--card`, `--primary`,
  `--border`, etc.), dark values only, set on `:root` (no `.dark` class
  needed since there's only one theme).
- `src/renderer/main.tsx` gains one new import: `import './index.css';`.

### Component-by-component changes

All changes are visual/structural-in-JSX only — no prop or exported-function
signature changes.

| Component | Change |
|---|---|
| `App.tsx` | Wraps content in a dark-background full-height layout: sticky header (title), filter bar row, responsive grid for cards/charts/table below. Replaces the bare `<p className="refresh-notice">` with a small dismissible-looking banner (still just conditional JSX, no new state). Uses the previously-unused `loading` value from `useUsageData` to render `Skeleton` placeholders during the very first load (when `data` is still `null` and `loading` is `true`). |
| `SummaryCards.tsx` | Three `Card` components in a flex/grid row, each with an icon (lucide-react), a large bold value, and a muted label underneath. |
| `FilterBar.tsx` | Horizontal flex row; native `<select>` and `<input type="date">` elements are kept as-is (see correction above) but restyled with Tailwind classes (border, rounded corners, dark background, focus ring); same `id`/`htmlFor` wiring preserved so `getByLabelText('Project')` etc. keep working. |
| `TimeSeriesChart.tsx` / `BreakdownChart.tsx` | Each wrapped in a `Card`; recharts `stroke`/`fill` colors updated to the theme's accent color (CSS variable read via a plain hex/rgb fallback, since recharts doesn't consume CSS variables directly for SVG props); grid lines/tooltip restyled to match dark theme. |
| `SessionsTable.tsx` | Wrapped in `Card`; native `<table>` replaced with shadcn `Table` primitives; sort indicator becomes a small chevron icon (↑/↓) next to "AIU credits" header instead of relying purely on cursor style; sorting logic (the 3-state cycle) is unchanged. |
| `EmptyState.tsx` | Centered flex column, icon + heading + message, matches the dark theme. |

### Testing

- **No behavioral change is intended.** The existing 32 tests query by
  `role`, `label`, and visible text — none of them assert on CSS classes or
  DOM structure beyond ARIA roles/labels, so they must continue passing
  unmodified. This is the primary regression check for this redesign: if any
  existing test needs to change, that's a signal a behavior (not just a
  style) changed unintentionally, and it must be justified explicitly during
  implementation review — not silently patched.
- One new behavior is introduced (Skeleton on first load) and needs one new
  test in `App.test.tsx`: assert a loading-skeleton placeholder (e.g. via a
  `data-testid="dashboard-skeleton"` or `role="status"`) appears before
  `data` resolves, using the existing `useUsageData`'s `loading` flag (no
  hook changes needed — the flag already exists and is already tested at the
  hook level in Task 7).

### Error handling

No change to error-handling logic (`EmptyState` display conditions, refresh
notice condition) — only their visual presentation changes.

## Data flow

Unchanged. This is a pure presentation-layer restyle; `useUsageData`,
`window.api`, IPC, and the main process are untouched.
