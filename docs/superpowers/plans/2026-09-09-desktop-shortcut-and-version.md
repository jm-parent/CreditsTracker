# Desktop Shortcut and Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a Squirrel.Windows desktop shortcut and display the packaged application version in the sidebar footer for the 1.4.1 patch release.

**Architecture:** Handle Squirrel installation lifecycle events in the Electron
main process and call `Update.exe` to create desktop and Start menu shortcuts.
Expose Electron's `app.getVersion()` through an IPC handler and the preload
bridge, then load it once in `App` and render it in a non-interactive
`Sidebar` footer.

**Tech Stack:** Electron 44, Electron Forge MakerSquirrel, React 19, TypeScript 7, Tailwind CSS, Vitest, Testing Library, semantic-release.

## Global Constraints

- On Squirrel install or update, invoke `Update.exe --createShortcut` with
  `--shortcut-locations Desktop,StartMenu` before normal Electron startup.
- Do not alter uninstall or auto-update behavior.
- Render the exact installed package version as `v{version}` at the bottom of the lateral navigation menu.
- Omit the version footer if retrieving it fails; dashboard data loading must remain unaffected.
- Do not add dependencies.
- Release only through the existing semantic-release workflow from `master`; use a `fix:` Conventional Commit to create 1.4.1.

---

## File Structure

| File | Responsibility |
|---|---|
| `forge.config.ts` | Keeps the Squirrel maker metadata limited to supported installer options. |
| `src/main/squirrel-events.ts` | Handles Squirrel install/update events and schedules shortcut creation through `Update.exe`. |
| `src/main.test.ts` | Verifies Squirrel install/update handling and unchanged startup for ordinary or unhandled launches. |
| `src/main/ipc-handlers.ts` | Registers the renderer-facing application-version IPC handler. |
| `src/main/ipc-handlers.test.ts` | Verifies the version IPC channel delegates to Electron's app version. |
| `src/preload.ts` | Exposes the version channel through the constrained renderer bridge. |
| `src/renderer/window.d.ts` | Types `window.api.getAppVersion(): Promise<string>`. |
| `src/renderer/App.tsx` | Loads the version once and supplies it to the sidebar. |
| `src/renderer/App.test.tsx` | Covers successful retrieval and graceful version lookup failure. |
| `src/renderer/components/Sidebar.tsx` | Renders the fixed footer version text. |
| `src/renderer/components/Sidebar.test.tsx` | Covers footer content and navigation preservation. |

## Approved Corrective Decision

`MakerSquirrel` and its `electron-winstaller` dependency do not implement
`createDesktopShortcut`; the original Task 1 configuration option is ignored.
The approved implementation replaces that option and its tautological test
with a dedicated `src/main/squirrel-events.ts` helper and test. The helper
must recognize `--squirrel-install` and `--squirrel-updated` in
`process.argv`, call the installed application's adjacent `Update.exe` with
`--createShortcut <packaged-executable-name> --shortcut-locations
Desktop,StartMenu`, then quit the Electron app before regular startup.
Non-Squirrel launches and every other Squirrel event must leave normal
startup unchanged. This decision supersedes Task 1's MakerSquirrel-specific
requirements while preserving all other plan constraints.

### Task 1: Handle Squirrel shortcut creation in the main process

**Files:**
- Create: `src/main/squirrel-events.ts`
- Create: `src/main.test.ts`
- Modify: `src/main.ts`
- Modify: `forge.config.ts`

**Interfaces:**
- Consumes: `process.argv`, `process.execPath`, Electron's `app.quit()`, and `Update.exe --createShortcut`.
- Produces: `handleSquirrelEvent(): boolean`, which returns `true` only for handled install/update events and prevents the rest of Electron startup from running.

- [ ] **Step 1: Write the failing startup tests**

```ts
it('creates Desktop and Start menu shortcuts during Squirrel install and stops startup', async () => {
  await importMainFor(['CreditsTracker.exe', '--squirrel-install']);

  expect(mockedSpawn.mock.calls[0]?.[0]).toBe(expectedUpdateExePath);
  expect(mockedSpawn.mock.calls[0]?.[1]).toEqual([
    '--createShortcut',
    'CreditsTracker.exe',
    '--shortcut-locations',
    'Desktop,StartMenu',
  ]);
  expect(app.quit).toHaveBeenCalledTimes(1);
  expect(updateElectronApp).not.toHaveBeenCalled();
  expect(app.whenReady).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/main.test.ts`  
Expected: FAIL because install/update launches still follow the normal startup path.

- [ ] **Step 3: Add the Squirrel event helper and wire it into startup**

```ts
// src/main/squirrel-events.ts
export function handleSquirrelEvent(
  argv: string[] = process.argv,
  execPath: string = process.execPath,
): boolean {
  if (!argv.some((arg) => arg === '--squirrel-install' || arg === '--squirrel-updated')) {
    return false;
  }

  spawn(path.resolve(path.dirname(execPath), '..', 'Update.exe'), [
    '--createShortcut',
    path.basename(execPath),
    '--shortcut-locations',
    'Desktop,StartMenu',
  ]);

  app.quit();
  return true;
}

// src/main.ts
if (!handleSquirrelEvent()) {
  if (app.isPackaged) {
    updateElectronApp({ repo: 'jm-parent/CreditsTracker' });
  }

  app.whenReady().then(/* existing startup */);
  app.on('window-all-closed', /* existing handler */);
}
```

- [ ] **Step 4: Remove the unsupported maker option**

Delete `forge.config.test.ts` and keep `forge.config.ts` limited to supported
`MakerSquirrel` options (`authors` and `setupIcon`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/main.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit the installer behavior**

```bash
git add forge.config.ts src/main.ts src/main/squirrel-events.ts src/main.test.ts
git commit -m "fix: create desktop shortcut during Squirrel install"
```

### Task 2: Expose the packaged app version

**Files:**
- Modify: `src/main/ipc-handlers.ts:1,70-92`
- Modify: `src/main/ipc-handlers.test.ts:4-16,51-59`
- Modify: `src/preload.ts:16-17`
- Modify: `src/renderer/window.d.ts:20-28`

**Interfaces:**
- Consumes: `app.getVersion(): string` from Electron.
- Produces: IPC channel `'get-app-version'` and `window.api.getAppVersion(): Promise<string>`.

- [ ] **Step 1: Write failing main-process test**

Extend the Electron mock with `app.getVersion`, then add:

```ts
it('returns Electron application version through get-app-version', () => {
  (app.getVersion as Mock).mockReturnValue('1.4.1');
  registerIpcHandlers('/fake/path.db');
  const handlers = (ipcMain as unknown as {
    __handlers: Map<string, (...args: unknown[]) => unknown>;
  }).__handlers;

  expect(handlers.get('get-app-version')!({})).toBe('1.4.1');
});
```

- [ ] **Step 2: Run the IPC test to verify it fails**

Run: `npm test -- src/main/ipc-handlers.test.ts`  
Expected: FAIL because no `get-app-version` handler exists.

- [ ] **Step 3: Register and bridge the version handler**

```ts
// src/main/ipc-handlers.ts
import { app, ipcMain } from 'electron';

ipcMain.handle('get-app-version', () => app.getVersion());
```

```ts
// src/preload.ts
getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),
```

```ts
// src/renderer/window.d.ts
getAppVersion: () => Promise<string>;
```

- [ ] **Step 4: Run the IPC test to verify it passes**

Run: `npm test -- src/main/ipc-handlers.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit the version bridge**

```bash
git add src/main/ipc-handlers.ts src/main/ipc-handlers.test.ts src/preload.ts src/renderer/window.d.ts
git commit -m "fix: expose installed app version"
```

### Task 3: Render the version in the sidebar footer

**Files:**
- Modify: `src/renderer/App.tsx:21-54,72`
- Modify: `src/renderer/App.test.tsx:43-66`
- Modify: `src/renderer/components/Sidebar.tsx:3-31`
- Modify: `src/renderer/components/Sidebar.test.tsx:6-31`

**Interfaces:**
- Consumes: `window.api.getAppVersion(): Promise<string>`.
- Produces: `Sidebar` prop `appVersion?: string`; the footer text is `v${appVersion}` when supplied.

- [ ] **Step 1: Write failing renderer tests**

Add `getAppVersion: vi.fn().mockResolvedValue('1.4.1')` to the shared `window.api` test setup and add:

```tsx
it('renders the packaged version in the sidebar footer', async () => {
  render(<App />);
  expect(await screen.findByText('v1.4.1')).toBeInTheDocument();
});

it('keeps the dashboard usable when version lookup fails', async () => {
  window.api.getAppVersion = vi.fn().mockRejectedValue(new Error('IPC unavailable'));
  render(<App />);
  expect(await screen.findByText('3.00')).toBeInTheDocument();
  expect(screen.queryByText(/^v/)).not.toBeInTheDocument();
});
```

Add a direct sidebar assertion:

```tsx
render(<Sidebar activeTab="daily" onTabChange={vi.fn()} appVersion="1.4.1" />);
expect(screen.getByText('v1.4.1')).toBeInTheDocument();
```

- [ ] **Step 2: Run the renderer tests to verify they fail**

Run: `npm test -- src/renderer/App.test.tsx src/renderer/components/Sidebar.test.tsx`  
Expected: FAIL because `getAppVersion` and the `appVersion` prop do not exist.

- [ ] **Step 3: Implement one-time version loading and footer layout**

```tsx
// App.tsx state
const [appVersion, setAppVersion] = useState<string | undefined>();

useEffect(() => {
  window.api.getAppVersion().then(setAppVersion).catch(() => undefined);
}, []);

// App.tsx render
<Sidebar activeTab={activeTab} onTabChange={handleTabChange} appVersion={appVersion} />
```

```tsx
// Sidebar.tsx props and footer
interface SidebarProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  appVersion?: string;
}

{appVersion && (
  <p className="mt-auto px-3 pt-4 text-xs text-muted-foreground">v{appVersion}</p>
)}
```

Keep the navigation-entry mapping unchanged and preserve the sidebar's
full-height flex-column layout so `mt-auto` anchors the footer at its bottom.

- [ ] **Step 4: Run the renderer tests to verify they pass**

Run: `npm test -- src/renderer/App.test.tsx src/renderer/components/Sidebar.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit the renderer behavior**

```bash
git add src/renderer/App.tsx src/renderer/App.test.tsx src/renderer/components/Sidebar.tsx src/renderer/components/Sidebar.test.tsx
git commit -m "fix: show installed version in sidebar"
```

### Task 4: Validate and publish the patch release

**Files:**
- Modify: `CHANGELOG.md`, `package.json`, `package-lock.json` (generated by semantic-release only)

**Interfaces:**
- Consumes: commits since tag `v1.4.0`, including the Task 1 `fix:` commit.
- Produces: release commit/tag `v1.4.1`, GitHub release assets including the Squirrel `Setup.exe`, `.nupkg`, and `RELEASES`.

- [ ] **Step 1: Run the complete test suite**

Run: `npm test`  
Expected: PASS.

- [ ] **Step 2: Inspect the calculated local release**

Run: `npm run release:dry-run`  
Expected: semantic-release selects version `1.4.1` and reports the release notes without publishing.

- [ ] **Step 3: Push the implementation commits to master**

Create a pull request from the feature branch, merge it to `master`, and confirm its merge commit includes the Task 1 `fix:` commit in its history. Do not manually edit version fields.

- [ ] **Step 4: Monitor the Release workflow**

Run: `gh run list --workflow release.yml --branch master --limit 1`  
Expected: the latest Release workflow succeeds after semantic-release builds and publishes version `1.4.1`.

- [ ] **Step 5: Confirm published assets**

Run: `gh release view v1.4.1 --json tagName,assets`  
Expected: `tagName` is `v1.4.1`, with the Windows `Setup.exe`, `.nupkg`, `RELEASES`, and ZIP assets.
