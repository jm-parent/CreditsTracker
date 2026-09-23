# Spec Kit for Existing Credits Dashboard Features

## Status

Design approved in conversation; awaiting review of this written document.

## Goal

Adopt GitHub Spec Kit in the existing Credits Dashboard repository and document
all currently implemented product features as maintainable functional
specifications. Keep the current application, its behavior, and its development
workflow intact.

## Context

Credits Dashboard is an Electron desktop application with a React renderer. It
combines local GitHub Copilot CLI SQLite data and optional VS Code Copilot Chat
logs, then presents usage analytics, reports, diagnostics, and supporting
desktop features. The repository already has an English README and developer
guide, plus historical design and implementation documents under
`docs/superpowers/`. Those historical documents are not part of this migration.

The official Spec Kit existing-project guidance recommends initializing in
place, recording rules supported by the repository, and using the workflow for
future bounded changes rather than reconstructing the entire application from
specifications. This adoption is a deliberate exception for the baseline
inventory: documenting all existing user-visible functionality is itself the
requested deliverable.

## Decisions

1. Use the official Specify CLI with the GitHub Copilot integration. Spec Kit
   is a development tool, not an application dependency; do not add it to
   `package.json` or change runtime code.
2. Keep Spec Kit's project configuration and constitution in `.specify/`, and
   keep feature folders in the conventional repository-root `specs/` directory.
3. Treat each `spec.md` as a living functional contract. Update it when its
   feature changes; generate `plan.md` and `tasks.md` for future implementation
   work rather than inventing retroactive plans and task lists for the baseline.
4. Write project documentation and feature specifications in English to match
   the existing README and developer guide.
5. Do not convert, move, or delete the historical `docs/superpowers/` plans or
   designs.

## Proposed repository artifacts

- `.specify/` — Spec Kit configuration, templates, scripts, and project memory
  created by the official initializer.
- `.specify/memory/constitution.md` — concise, evidence-based project
  principles. Include verified architecture, testing, and privacy constraints;
  document the real network exceptions for update checks and opening curated
  GitHub links rather than asserting that the app never uses a network.
- `specs/README.md` — index of the baseline feature specifications and the
  convention for keeping them current.
- `specs/001-dashboard-navigation-and-filters/spec.md`
- `specs/002-daily-consumption-and-hourly-detail/spec.md`
- `specs/003-monthly-activity/spec.md`
- `specs/004-project-analytics-and-detail/spec.md`
- `specs/005-model-analytics/spec.md`
- `specs/006-raw-session-browser/spec.md`
- `specs/007-usage-sources-refresh-and-privacy/spec.md`
- `specs/008-html-report-export/spec.md`
- `specs/009-featured-projects/spec.md`
- `specs/010-diagnostic-logs/spec.md`
- `specs/011-desktop-shortcut-onboarding/spec.md`
- `specs/012-opt-in-app-updates/spec.md`
- `specs/013-credit-change-indicators/spec.md`
- `docs/SPECKIT.md` — Windows-oriented setup, Copilot command workflow,
  artifact layout, and living-spec maintenance guidance.
- `docs/DEVELOPMENT.md` — links to the Spec Kit guide and feature index.

The baseline specifications describe observable behavior and acceptance
scenarios, not implementation tasks. They should be cross-checked against the
README, developer guide, implementation, and relevant tests. If a behavior is
unclear or not evidenced, record the uncertainty for clarification instead of
making up a product rule.

## Feature coverage

The thirteen specifications cover:

1. Sidebar navigation and shared dashboard filters.
2. Daily AIU, token, and request totals; project chart; hourly drill-down.
3. Monthly activity heatmap and its supported filters.
4. Project usage breakdown and project detail drill-down.
5. Model totals and share of overall usage.
6. Browsing underlying session and usage-event data.
7. Copilot CLI and VS Code Chat inputs, merged data, refresh behavior, and
   privacy boundaries.
8. HTML report filters, period shortcuts, preview, save/cancel/overwrite
   behavior, and report content limits.
9. Offline-friendly featured project catalogue, tag filtering, and external
   links.
10. In-app diagnostic log viewing and log-file access.
11. Eligibility, creation, dismissal, and error behavior for the desktop
    shortcut prompt.
12. Update availability, user-approved download, and restart flow, including
    unsupported development builds.
13. Visual signals for positive and negative credit changes.

## Contributor workflow

The guide will document the current official setup prerequisites and commands
for Windows, then distinguish terminal setup from agent-chat skills. Establish
the constitution once. For a feature change, use Spec Kit's specify, clarify,
plan, tasks, analyze, implement, and converge skills, reviewing each result
before proceeding. Update the living `spec.md` first; derive or refresh plans
and tasks for that change. Do not treat generated checklist state as proof that
the implementation is complete.

Official references:

- [Adopting Spec Kit in an Existing Project](https://github.com/github/spec-kit/blob/main/docs/guides/existing-projects.md)
- [Spec-Driven Development Quickstart](https://github.com/github/spec-kit/blob/main/docs/quickstart.md)
- [Supported AI Coding Agent Integrations](https://github.com/github/spec-kit/blob/main/docs/reference/integrations.md)
- [Spec Persistence Models](https://github.com/github/spec-kit/blob/main/docs/concepts/spec-persistence.md)

## Safe initialization and validation

The repository is non-empty, so initialization must follow the official
existing-project guidance. Review the initializer's managed paths and proposed
diff before accepting it. Preserve existing Copilot instructions and all
unrelated worktree modifications; do not let a force option silently replace
user changes. Inspect the generated configuration and Copilot skill files
before adding the baseline specifications.

Validation is documentation-focused: check internal links, confirm that the
index lists every feature spec, ensure each requirement has a clear observable
acceptance scenario, and check factual claims against existing documentation,
code, and tests. No application dependency, runtime behavior, or application
test suite should change as part of documentation generation.

## Out of scope

- Changing or refactoring the Electron application.
- Adding Spec Kit to runtime or npm dependencies.
- Migrating historical Superpowers documents.
- Creating retroactive technical plans, task lists, or implementation history.
- Redesigning current features or resolving undocumented product decisions by
  assumption.

## Success criteria

- Copilot contributors can initialize and use Spec Kit from the project guide.
- A constitution records only repository-backed constraints.
- All thirteen current capabilities have linked, reviewable functional specs.
- The feature index and developer guide explain where specifications live and
  how to keep them synchronized with future changes.
- Existing application behavior and unrelated working-tree changes remain
  untouched.
