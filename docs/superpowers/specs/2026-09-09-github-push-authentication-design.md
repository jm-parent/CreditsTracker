# GitHub push authentication design

## Goal

Document a reliable, secret-safe procedure for future Copilot sessions to push
changes to `jm-parent/CreditsTracker` when Git Credential Manager selects an
unauthorized account.

## Procedure

The instructions will direct sessions to select the `jm-parent` GitHub CLI
account, obtain its token with `gh auth token`, and pass it only in memory as
a one-command HTTP Basic authorization header to `git push`.

Before pushing to `master`, sessions must retrieve the remote ref and confirm
that it still points to the expected base commit. The documented Git push is a
normal non-force push, so GitHub rejects it if the remote branch changed.

## Security

The token must not be printed, committed, embedded in a remote URL, or saved
to Git configuration. The command removes its PowerShell variables after the
push completes. If the authenticated `jm-parent` account is absent or lacks
repository access, the session must stop and request user authentication
rather than attempt a workaround.
