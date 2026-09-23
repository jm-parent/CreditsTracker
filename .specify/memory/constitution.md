# Credits Dashboard Constitution

## Core Principles

### I. Local-First Usage Data
Read Copilot usage sources from the local machine. Do not transmit usage
records, prompts, responses, or conversation transcripts. Document the
deliberate network exceptions accurately: release-availability checks and
opening a featured GitHub link after the user chooses it.

### II. Preserve Process Boundaries
Keep filesystem and database access in Electron's main process. Expose only
typed, intentional operations through the preload bridge; the renderer uses
that bridge instead of accessing local files directly.

### III. Keep Specifications as Product Contracts
Write feature requirements in terms of user value and observable behavior.
Derive baseline behavior from the implementation, existing documentation, and
tests. Update the owning living `spec.md` when its behavior changes; do not
invent behavior to fill documentation gaps.

### IV. Verify Behavior with Existing Tests
Preserve the established Vitest unit and component-test conventions. For
behavior changes, add or update focused tests and run the relevant checks;
documentation-only changes do not require application tests.

### V. Prefer Focused, Compatible Changes
Follow existing Electron, React, TypeScript, and Vitest patterns. Avoid
unrelated refactoring, runtime dependencies for documentation tooling, and
changes to behavior outside the feature being specified.

## Additional Constraints

- Open the Copilot CLI SQLite database read-only; keep the normalized merged
  usage view in memory.
- Preserve the documented privacy boundary for HTML reports: session metadata
  and summaries may be included, but prompts, assistant responses, and raw
  transcripts are excluded.
- Keep Spec Kit as contributor tooling; do not add it to application or npm
  runtime dependencies.
- Preserve the existing Windows packaging, CI, and semantic-release workflow.

## Development Workflow

- For a new feature, create a specification before its technical plan and
  implementation tasks.
- For an existing feature, update its living specification first and select
  the correct feature directory before generating derived artifacts.
- Run `npm test` when implementation behavior changes; use focused
  documentation and link checks for documentation-only work.
- Use Conventional Commit prefixes, including `docs:` for documentation-only
  commits, to remain compatible with the repository's release workflow.

## Governance

This constitution records repository-backed constraints for future Spec Kit
work. Amend it when an agreed project-wide constraint changes, and update
affected living specifications in the same change. If a principle conflicts
with verified current behavior, clarify the intended change before planning
implementation.

**Version**: 1.0.0 | **Ratified**: 2026-09-23 | **Last Amended**: 2026-09-23
