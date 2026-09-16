# Categorized sidebar menu

## Context

The renderer currently presents the eight dashboard pages as one flat list in
`src/renderer/components/Sidebar.tsx`. The existing page identifiers, labels,
icons, active-tab behavior, update badge, and version footer are already
working; the change is limited to making the navigation easier to scan.

## Goals

- Group all existing pages under clear, always-visible category headings.
- Preserve one-click access to every page.
- Preserve the existing active state, accessibility attributes, update badge,
  footer, and callback behavior.
- Keep the change local to the sidebar and its tests.

## Navigation structure

The sidebar will render these four groups in this order:

| Category | Pages |
| --- | --- |
| Overview | Daily consumption, Monthly activity |
| Analysis | By project, By model |
| Data & tools | Raw data, CSV export, Logs |
| Discovery | Featured projects |

Category headings are non-interactive visual headings. Page labels remain
unchanged so existing navigation and user familiarity are preserved.

## Architecture

`Sidebar.tsx` will replace the flat `ENTRIES` constant with a typed
`NAV_GROUPS` configuration. Each group contains a label and the same entry
shape currently used by the sidebar (`DashboardTab`, label, and Lucide icon).
The component maps groups to semantic sections with a heading, then maps each
group's entries to the existing button markup.

The `DashboardTab` union, `onTabChange` callback, `aria-current="page"`,
active styling, icon rendering, update badge, and version footer remain
unchanged. `App.tsx`, route selection, data loading, hooks, pages, and IPC
code do not change.

## Behavior and accessibility

All four groups remain expanded at all times. Only page entries are buttons;
category headings are not clickable and do not introduce additional state.
The sidebar remains vertically scrollable using its existing layout. The
currently active page keeps its highlighted style and `aria-current` value.

## Error handling

No new failure paths are introduced. The sidebar continues to render from
static navigation metadata, and all existing update-state behavior remains
unchanged.

## Testing

Update `src/renderer/components/Sidebar.test.tsx` to verify:

- all four category headings are rendered;
- pages appear in the approved category/order structure;
- the active page still receives its existing active styling and
  `aria-current`;
- clicking a page still calls `onTabChange` with the same tab identifier;
- the version footer and update badge behavior remain covered by the existing
  tests.

No new integration tests are needed because tab identifiers and the
`Sidebar` callback contract do not change.

## Out of scope

- Collapsible or persisted navigation groups.
- Renaming page labels or translating the existing English UI.
- Changes to `App.tsx`, dashboard pages, hooks, IPC, or backend data.
- New navigation routes or categories driven by runtime data.
