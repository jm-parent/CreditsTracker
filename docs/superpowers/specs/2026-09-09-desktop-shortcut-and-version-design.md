# Desktop shortcut and version display design

## Goal

The next patch release will create a desktop shortcut during Squirrel.Windows
installation and show the installed application version at the bottom of the
lateral navigation menu.

## Installer behavior

`MakerSquirrel` will enable `createDesktopShortcut`. Squirrel.Windows will
create the shortcut when the application is installed or updated through its
installer. The existing Start menu shortcut, uninstall entry, and auto-update
behavior remain unchanged.

## Version data flow

The Electron main process is the source of truth for the version: it will
return `app.getVersion()` through a read-only IPC handler. The preload bridge
will expose that value as `window.api.getAppVersion()`.

The renderer retrieves the version once when `App` mounts and passes it to
`Sidebar`. The sidebar renders it as `v{version}` in a non-interactive footer
anchored beneath the navigation entries. This makes the displayed value match
the packaged application version, including after a Squirrel update.

## Error behavior

Version retrieval is non-critical. If it fails, the dashboard remains usable
and the version footer is omitted rather than displaying an incorrect value.

## Verification

Targeted tests will assert the desktop-shortcut Squirrel configuration, the
IPC/preload API contract, and the rendered sidebar version footer. The full
existing test suite will run before the release commit.

## Release

The implementation will be committed with the `fix:` Conventional Commit type
and pushed to `master`. The existing semantic-release workflow will calculate
version 1.4.1 from the 1.4.0 tag, update release metadata, build the Squirrel
installer, and publish its release assets.
