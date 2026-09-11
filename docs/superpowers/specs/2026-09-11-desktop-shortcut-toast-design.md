# Desktop shortcut toast design

## Goal

On every packaged Windows application launch, check whether the Credits
Tracker Desktop shortcut exists. If it does not, show a non-blocking toast
that invites the user to create it.

## Shortcut detection

The Electron main process remains the source of truth for shortcut detection
and creation. `src/main/shortcut.ts` will check for
`Credits Tracker.lnk` in Electron's `desktop` path on every renderer mount.

The check applies to every packaged Windows build, including Squirrel-managed
installations and portable ZIP builds. Development runs and non-Windows
platforms remain unsupported and never show the toast.

The existing persisted prompt flag is removed from this flow. Closing the
toast suppresses it only for the current application session. If the shortcut
is still missing at the next launch, the toast appears again.

## User interface

The existing blocking Desktop shortcut dialog is replaced by a compact toast
positioned at the bottom-right of the application window. It does not obscure
or disable the dashboard.

The toast contains:

- a short explanation that no Desktop shortcut was found;
- a **Create shortcut** action;
- a close button with an accessible label;
- a visible in-progress state while creation is running.

The toast remains visible until the user closes it or shortcut creation
succeeds. It does not disappear on a timer.

## Data flow

When the renderer mounts, its shortcut hook invokes the existing IPC check.
The main process returns whether the packaged Windows application lacks the
expected Desktop shortcut.

Selecting **Create shortcut** invokes the existing creation IPC operation,
which routes Squirrel-managed installs through the adjacent `Update.exe`
with `--createShortcut` and the packaged executable basename, while portable
builds continue using Electron's `shell.writeShortcutLink`. A successful
result closes the toast. Closing the toast only updates renderer state and
does not call a persistence IPC handler.

The obsolete dismissal persistence API and its prompt flag file are removed.
Squirrel's install/update shortcut creation remains unchanged and continues
to serve as the preferred installation-time path; the launch-time toast is a
recovery path when that shortcut is absent.

## Error handling

If shortcut detection fails, the failure is logged and the dashboard remains
usable without showing an unverified prompt.

If shortcut creation throws or reports failure, the toast remains open,
displays a concise failure message, and restores the action so the user can
retry. The error is also logged through the existing renderer and main-process
logging facilities.

## Accessibility

The toast is exposed as an appropriate status region. Its action and close
controls are keyboard accessible, the close button has an explicit accessible
name, and progress and error text do not rely on color alone.

## Verification

Targeted tests will cover:

- missing and existing shortcut detection for packaged Squirrel and portable
  Windows builds;
- no prompt in development or on unsupported platforms;
- toast rendering when the shortcut is absent;
- session-only dismissal and reappearance after a new mount;
- closing after successful creation;
- remaining open with a retryable error after failed creation;
- removal of the obsolete persistent dismissal IPC surface.

The existing Squirrel event behavior remains covered by its current tests.
