# Larger patch-notes popup design

## Goal

Make the application update dialog large enough to read release notes
comfortably without changing the update flow or allowing the dialog to
outgrow smaller screens.

## Current root cause

`UpdateDialog` constrains the dialog panel to `max-w-md`, and the release-notes
`pre` element is limited to `max-h-40`. Long release notes therefore occupy a
narrow, short scroll area even when the app window has room to display more
content.

## Design

The dialog panel will use Tailwind's responsive `max-w-2xl` width. The release
notes block will use a responsive viewport-aware maximum height equivalent to
16 rem capped at half of the viewport height, while retaining its existing
internal vertical scrolling, line wrapping, border, and muted styling.

The overlay padding remains `p-4`, so the dialog continues to have space around
it on small windows. No update state, button, close behavior, or accessibility
attribute changes are needed.

## Verification

The existing `UpdateDialog` tests will assert that the dialog uses the
approved `max-w-2xl` class and that release notes use the viewport-aware
maximum-height class. Existing tests for available, downloading, ready, and
error states must continue to pass.

## Scope

Only `src/renderer/components/UpdateDialog.tsx` and its focused test file are
expected to change during implementation. No updater, IPC, release-feed, or
application-window behavior changes are included.
