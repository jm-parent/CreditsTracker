# Spec Kit for Contributors

This repository uses [GitHub Spec Kit](https://github.com/github/spec-kit) to
keep feature requirements, plans, and implementation tasks aligned. Spec Kit
is contributor tooling; it is not an application or npm dependency.

## Setup

The project is initialized for GitHub Copilot in skills mode. The checked-in
`.specify/` configuration and `.github/skills/speckit-*/` files are the
project integration; do not reinitialize the repository on every clone.

Specify CLI requires Python 3.11 or newer and `uv`. Install the CLI for your
user with:

```powershell
uv tool install specify-cli
specify check
```

`specify check` checks available tools and editor/agent prerequisites. It does
not validate the meaning or completeness of feature specifications.

For a new project adoption only, initialize from the repository root with the
Copilot integration and PowerShell scripts:

```powershell
specify init --here --force --integration copilot --non-interactive --script ps
```

Initialization merges generated files into the project and `--force` skips
the confirmation prompt. Review the resulting diff before accepting it,
especially if `.specify/` or `.github/skills/` already contains project-owned
files. Do not overwrite existing Copilot instructions or unrelated changes.

## Spec-Driven Development

The CLI installs skills; invoke them in Copilot chat, one at a time. They are
not terminal commands. Establish the project constitution once, then use this
workflow for a new, bounded feature:

1. `/speckit-specify` — describe user value and observable behavior.
2. `/speckit-clarify` — resolve material ambiguity before planning.
3. `/speckit-plan` — choose a technical approach that fits this repository.
4. `/speckit-checklist` — optionally review requirement quality.
5. `/speckit-tasks` — create dependency-ordered implementation tasks.
6. `/speckit-analyze` — check consistency across the specification, plan, and
   tasks before implementation.
7. `/speckit-implement` — implement the reviewed tasks.
8. `/speckit-converge` — compare the result with the spec; repeat
   implement/converge if it identifies remaining work.

For an existing feature, update that feature's `spec.md` first. Before running
plan or task skills, point Spec Kit at the intended feature directory through
`.specify/feature.json` or the `SPECIFY_FEATURE_DIRECTORY` environment
variable. The selected directory, not the current Git branch, identifies the
active feature. Do not run specify against an existing feature in a way that
creates a duplicate directory.

## Existing Feature Specifications

The root `specs/` directory contains a baseline functional contract for each
current product capability. These baseline folders intentionally start with
`spec.md` only: they describe shipped behavior, not retroactive implementation
plans, task lists, or historical decisions. See [`specs/README.md`](../specs/README.md)
for the feature index.

Keep each `spec.md` as the living source of truth for its feature. State
requirements and acceptance scenarios in user-observable terms; put technical
design in `plan.md` when an actual change is being planned. If implementation
or test evidence does not establish a behavior, record the uncertainty and
clarify it rather than assuming a product rule.

## Repository Constraints

- Usage data is read locally. The application does not send usage records,
  prompts, responses, or raw transcripts to a service.
- The update checker makes a release-availability request; it does not
  download an update until the user accepts. Opening a featured GitHub
  repository is also user initiated.
- Preserve the Electron main/preload/renderer boundaries and the read-only
  Copilot CLI database access.
- Keep HTML reports standalone and exclude prompts, assistant responses, and
  raw transcripts.
- If code behavior changes, follow the existing tests and run `npm test`.
  Documentation-only changes need link and content review, not the app test
  suite.

For the complete application architecture and build workflow, see
[`docs/DEVELOPMENT.md`](DEVELOPMENT.md).

## Official References

- [Adopting Spec Kit in an Existing Project](https://github.com/github/spec-kit/blob/main/docs/guides/existing-projects.md)
- [Spec-Driven Development Quickstart](https://github.com/github/spec-kit/blob/main/docs/quickstart.md)
- [Supported AI Coding Agent Integrations](https://github.com/github/spec-kit/blob/main/docs/reference/integrations.md)
- [Spec Persistence Models](https://github.com/github/spec-kit/blob/main/docs/concepts/spec-persistence.md)
