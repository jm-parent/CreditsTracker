# Desktop Shortcut and Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a Squirrel.Windows desktop shortcut and display the packaged application version in the sidebar footer for the 1.4.1 patch release.

**Architecture:** Configure Squirrel directly for the installer behavior. Expose Electron's `app.getVersion()` through an IPC handler and the preload bridge, then load it once in `App` and render it in a non-interactive `Sidebar` footer.

**Tech Stack:** Electron 44, Electron Forge MakerSquirrel, React 19, TypeScript 7, Tailwind CSS, Vitest, Testing Library, semantic-release.

## Global Constraints

- Enable Squirrel's native `createDesktopShortcut` behavior without changing Start menu, uninstall, or auto-update behavior.
- Render the exact installed package version as `v{version}` at the bottom of the lateral navigation menu.
- Omit the version footer if retrieving it fails; dashboard data loading must remain unaffected.
- Do not add dependencies.
- Release only through the existing semantic-release workflow from `master`; use a `fix:` Conventional Commit to create 1.4.1.

---

## File Structure

| File | Responsibility |
|---|---|
| `forge.config.ts` | Enables the native Squirrel desktop-shortcut setting. |
| `forge.config.test.ts` | Captures the Squirrel-maker options passed by Forge configuration. |
| `src/main/ipc-handlers.ts` | Registers the renderer-facing application-version IPC handler. |
| `src/main/ipc-handlers.test.ts` | Verifies the version IPC channel delegates to Electron's app version. |
| `src/preload.ts` | Exposes the version channel through the constrained renderer bridge. |
| `src/renderer/window.d.ts` | Types `window.api.getAppVersion(): Promise<string>`. |
| `src/renderer/App.tsx` | Loads the version once and supplies it to the sidebar. |
| `src/renderer/App.test.tsx` | Covers successful retrieval and graceful version lookup failure. |
| `src/renderer/components/Sidebar.tsx` | Renders the fixed footer version text. |
| `src/renderer/components/Sidebar.test.tsx` | Covers footer content and navigation preservation. |

### Task 1: Configure Squirrel desktop shortcut

**Files:**
- Create: `forge.config.test.ts`
- Modify: `forge.config.ts:44-48`

**Interfaces:**
- Consumes: `MakerSquirrel` constructor options from `@electron-forge/maker-squirrel`.
- Produces: a `MakerSquirrel` instance constructed with `{ authors: 'jm-parent', setupIcon: './assets/icon.ico', createDesktopShortcut: true }`.

- [ ] **Step 1: Write the failing configuration test**

```ts
import { describe, expect, it, vi } from 'vitest';

const squirrelOptions: Array<Record<string, unknown>> = [];

vi.mock('@electron-forge/maker-squirrel', () => ({
  MakerSquirrel: class {
    constructor(options: Record<string, unknown>) {
      squirrelOptions.push(options);
    }
  },
}));

vi.mock('@electron-forge/maker-zip', () => ({ MakerZIP: class {} }));
vi.mock('@electron-forge/plugin-vite', () => ({ VitePlugin: class {} }));
vi.mock('@electron-forge/plugin-auto-unpack-natives', () => ({ AutoUnpackNativesPlugin: class {} }));

describe('Forge Squirrel configuration', () => {
  it('requests a desktop shortcut from Squirrel.Windows', async () => {
    await import('./forge.config');
    expect(squirrelOptions).toContainEqual(
      expect.objectContaining({ createDesktopShortcut: true }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- forge.config.test.ts`  
Expected: FAIL because `createDesktopShortcut` is absent.

- [ ] **Step 3: Add the native Squirrel option**

```ts
new MakerSquirrel({
  authors: 'jm-parent',
  setupIcon: './assets/icon.ico',
  createDesktopShortcut: true,
}),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- forge.config.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit the installer behavior**

```bash
git add forge.config.ts forge.config.test.ts
git commit -m "fix: create a desktop shortcut on Windows install"
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
