# Desktop Shortcut Toast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check for a Windows Desktop shortcut at every packaged Squirrel app launch and show a persistent, retryable, non-blocking creation toast when it is missing.

**Architecture:** The Electron main process checks the expected `.lnk` path and creates the shortcut through the existing IPC bridge. The renderer owns session-only toast dismissal and creation UI state; no dismissal is persisted. Squirrel's installation-time shortcut handling remains unchanged.

**Tech Stack:** Electron 44, React 19, TypeScript 7, Tailwind CSS 4, Vitest 5, Testing Library

## Global Constraints

- Apply the check only to packaged Squirrel-managed Windows builds.
- Never show the toast in development or on non-Windows platforms.
- Keep the toast visible until the user closes it or shortcut creation succeeds; do not auto-dismiss it.
- Closing the toast affects only the current renderer session.
- Keep the toast open with a visible retryable error when creation fails.
- Preserve `src/main/squirrel-events.ts` installation and update behavior.
- Add no dependencies.

---

### Task 1: Make shortcut detection launch-based

**Files:**
- Modify: `src/main/shortcut.test.ts`
- Modify: `src/main/shortcut.ts`
- Modify: `src/main/ipc-handlers.test.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/preload.ts`
- Modify: `src/renderer/window.d.ts`

**Interfaces:**
- Produces: `shouldPromptForDesktopShortcut(): boolean`, returning true only when a packaged Windows build has no `Credits Tracker.lnk` on the Desktop.
- Preserves: `createDesktopShortcut(): boolean`, which uses the adjacent `Update.exe --createShortcut <exe>` path for Squirrel-managed installs.
- Removes: `dismissDesktopShortcutPrompt(): void` and `window.api.dismissDesktopShortcutPrompt()`.

- [ ] **Step 1: Replace persistence-oriented main-process tests with launch-time detection tests**

Update `src/main/shortcut.test.ts` so the imports contain only:

```ts
import { createDesktopShortcut, shouldPromptForDesktopShortcut } from './shortcut';
```

Remove `userDataDir`, prompt-flag setup, and the dismissal test suite. Keep the platform and packaged checks, then add the Squirrel and re-check assertions:

```ts
it('returns true when a Squirrel-managed install has no Desktop shortcut', () => {
  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  fs.writeFileSync(updateExe, '');

  expect(shouldPromptForDesktopShortcut()).toBe(true);
});

it('returns false while the Desktop shortcut exists and true again after it is removed', () => {
  const shortcutPath = path.join(desktopDir, 'Credits Tracker.lnk');
  fs.writeFileSync(shortcutPath, '');
  expect(shouldPromptForDesktopShortcut()).toBe(false);

  fs.rmSync(shortcutPath);
  expect(shouldPromptForDesktopShortcut()).toBe(true);
});
```

Change the creation tests so a failed `Update.exe --createShortcut`
invocation leaves `shouldPromptForDesktopShortcut()` true. In the successful
test, have the mock implementation write the shortcut named after the
packaged executable's basename (not the display name) before reporting
success, then assert the check returns false.

- [ ] **Step 2: Run the shortcut tests to verify they fail**

Run:

```powershell
rtk npm test -- src/main/shortcut.test.ts
```

Expected: FAIL because Squirrel installs are excluded and prompt state is persisted.

- [ ] **Step 3: Simplify shortcut detection and creation**

In `src/main/shortcut.ts`:

- remove `PROMPT_FLAG_FILE`, `flagFilePath`, `isSquirrelManaged`,
  `hasBeenPrompted`, `markPrompted`, and `dismissDesktopShortcutPrompt`;
- define support as packaged Windows only;
- make `shouldPromptForDesktopShortcut()` return
  `isSupported() && !fs.existsSync(desktopShortcutPath())`;
- retain logging and route supported installs through adjacent `Update.exe --createShortcut <exe>` in `createDesktopShortcut()`;
- stop marking any prompt state after success or failure.

The resulting detection core must be:

```ts
function isSupported(): boolean {
  return process.platform === 'win32' && app.isPackaged;
}

export function shouldPromptForDesktopShortcut(): boolean {
  return isSupported() && !fs.existsSync(desktopShortcutPath());
}
```

- [ ] **Step 4: Remove the obsolete dismissal IPC contract and update its tests**

In `src/main/ipc-handlers.ts`, remove the `dismissDesktopShortcutPrompt`
import and handler. Adjust the creation log copy from “first-launch prompt” to
“Desktop shortcut toast”.

In `src/main/ipc-handlers.test.ts`, remove the mocked
`dismissDesktopShortcutPrompt`, invocation of
`handlers.get('dismiss-desktop-shortcut-prompt')`, and its assertion.

Remove `dismissDesktopShortcutPrompt` from the exposed API in `src/preload.ts`
and from `Window.api` in `src/renderer/window.d.ts`.

- [ ] **Step 5: Run the main-process and IPC tests**

Run:

```powershell
rtk npm test -- src/main/shortcut.test.ts src/main/ipc-handlers.test.ts
```

Expected: both test files PASS.

- [ ] **Step 6: Commit the main-process behavior**

```powershell
rtk git add src/main/shortcut.ts src/main/shortcut.test.ts src/main/ipc-handlers.ts src/main/ipc-handlers.test.ts src/preload.ts src/renderer/window.d.ts
rtk git commit -m "fix: check desktop shortcut on every launch" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Replace the modal with a retryable toast

**Files:**
- Create: `src/renderer/components/DesktopShortcutToast.tsx`
- Create: `src/renderer/components/DesktopShortcutToast.test.tsx`
- Delete: `src/renderer/components/DesktopShortcutDialog.tsx`
- Delete: `src/renderer/components/DesktopShortcutDialog.test.tsx`
- Modify: `src/renderer/hooks/useDesktopShortcutPrompt.ts`
- Create: `src/renderer/hooks/useDesktopShortcutPrompt.test.ts`

**Interfaces:**
- Consumes: `window.api.shouldPromptDesktopShortcut(): Promise<boolean>` and `window.api.createDesktopShortcut(): Promise<boolean>`.
- Produces: `useDesktopShortcutPrompt(): { open: boolean; creating: boolean; error: string | null; create: () => void; dismiss: () => void }`.
- Produces: `DesktopShortcutToast` props `{ creating: boolean; error: string | null; onCreate: () => void; onDismiss: () => void }`.

- [ ] **Step 1: Write failing hook tests for session dismissal and retryable failures**

Create `src/renderer/hooks/useDesktopShortcutPrompt.test.ts` using
`renderHook`, `act`, and `waitFor` from Testing Library. Initialize
`window.api.shouldPromptDesktopShortcut` and
`window.api.createDesktopShortcut` as mocks.

Cover these exact behaviors:

```ts
it('opens when the Desktop shortcut is missing', async () => {
  window.api.shouldPromptDesktopShortcut = vi.fn().mockResolvedValue(true);
  const { result } = renderHook(() => useDesktopShortcutPrompt());

  await waitFor(() => expect(result.current.open).toBe(true));
});

it('dismisses only for the current mount and prompts again on a new mount', async () => {
  window.api.shouldPromptDesktopShortcut = vi.fn().mockResolvedValue(true);
  const first = renderHook(() => useDesktopShortcutPrompt());
  await waitFor(() => expect(first.result.current.open).toBe(true));

  act(() => first.result.current.dismiss());

  expect(first.result.current.open).toBe(false);
  first.unmount();

  const second = renderHook(() => useDesktopShortcutPrompt());
  await waitFor(() => expect(second.result.current.open).toBe(true));
  expect(window.api.shouldPromptDesktopShortcut).toHaveBeenCalledTimes(2);
});

it('keeps the toast open with an error when creation reports failure', async () => {
  window.api.shouldPromptDesktopShortcut = vi.fn().mockResolvedValue(true);
  window.api.createDesktopShortcut = vi.fn().mockResolvedValue(false);
  const { result } = renderHook(() => useDesktopShortcutPrompt());
  await waitFor(() => expect(result.current.open).toBe(true));

  act(() => result.current.create());

  await waitFor(() => expect(result.current.error).toBe('Could not create the shortcut. Please try again.'));
  expect(result.current.open).toBe(true);
  expect(result.current.creating).toBe(false);
});
```

Also test that success closes the toast and a rejected IPC call produces the
same retryable error.

- [ ] **Step 2: Run the hook test to verify it fails**

Run:

```powershell
rtk npm test -- src/renderer/hooks/useDesktopShortcutPrompt.test.ts
```

Expected: FAIL because the hook has no `error` state and closes after failure.

- [ ] **Step 3: Implement session-only hook state**

Update `useDesktopShortcutPrompt` to:

- add `error: string | null`;
- make `dismiss` synchronously set `open` false without IPC;
- clear `error` before each creation attempt;
- close only when `createDesktopShortcut()` resolves `true`;
- keep the toast open and set
  `Could not create the shortcut. Please try again.` when it resolves `false`
  or rejects;
- always restore `creating` to false.

Return:

```ts
return { open, creating, error, create, dismiss };
```

- [ ] **Step 4: Write failing toast component tests**

Create `src/renderer/components/DesktopShortcutToast.test.tsx` and test:

```tsx
render(
  <DesktopShortcutToast
    creating={false}
    error={null}
    onCreate={onCreate}
    onDismiss={onDismiss}
  />,
);

expect(screen.getByRole('status')).toHaveTextContent('No Desktop shortcut found');
await userEvent.click(screen.getByRole('button', { name: 'Create shortcut' }));
expect(onCreate).toHaveBeenCalledOnce();
await userEvent.click(screen.getByRole('button', { name: 'Dismiss shortcut reminder' }));
expect(onDismiss).toHaveBeenCalledOnce();
```

Add separate assertions that the create button is disabled while `creating`
and that a supplied error is visible through an alert region.

- [ ] **Step 5: Run the toast test to verify it fails**

Run:

```powershell
rtk npm test -- src/renderer/components/DesktopShortcutToast.test.tsx
```

Expected: FAIL because `DesktopShortcutToast` does not exist.

- [ ] **Step 6: Implement the toast and remove the modal**

Create `DesktopShortcutToast.tsx` as a fixed bottom-right card:

```tsx
<aside
  role="status"
  className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-4 text-card-foreground shadow-xl"
>
```

Use `Monitor` for the message and `X` for the close control. Render the
heading `No Desktop shortcut found`, explanatory copy, a **Create shortcut**
button, and an icon-only close button named `Dismiss shortcut reminder`.
When `error` is non-null, render it in a child with `role="alert"`.

Delete `DesktopShortcutDialog.tsx` and its test after the toast tests pass.

- [ ] **Step 7: Run the focused renderer tests**

Run:

```powershell
rtk npm test -- src/renderer/hooks/useDesktopShortcutPrompt.test.ts src/renderer/components/DesktopShortcutToast.test.tsx
```

Expected: both test files PASS.

- [ ] **Step 8: Commit the toast component and state**

```powershell
rtk git add src/renderer/components/DesktopShortcutToast.tsx src/renderer/components/DesktopShortcutToast.test.tsx src/renderer/hooks/useDesktopShortcutPrompt.ts src/renderer/hooks/useDesktopShortcutPrompt.test.ts
rtk git add -u src/renderer/components/DesktopShortcutDialog.tsx src/renderer/components/DesktopShortcutDialog.test.tsx
rtk git commit -m "feat: show missing desktop shortcut toast" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Integrate the toast and verify the complete flow

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

**Interfaces:**
- Consumes: `DesktopShortcutToast` and the complete result from `useDesktopShortcutPrompt()`.
- Produces: application-level rendering of the toast without blocking dashboard interaction.

- [ ] **Step 1: Add failing application integration tests**

In the `window.api` test fixture in `src/renderer/App.test.tsx`, remove
`dismissDesktopShortcutPrompt`.

Add a test that sets:

```ts
window.api.shouldPromptDesktopShortcut = vi.fn().mockResolvedValue(true);
window.api.createDesktopShortcut = vi.fn().mockResolvedValue(true);
```

Render `<App />`, assert the dashboard and `No Desktop shortcut found` are
both visible, click **Create shortcut**, then assert
`window.api.createDesktopShortcut` was called and the toast disappears.

Add a second test where creation resolves false; assert the toast remains and
`Could not create the shortcut. Please try again.` appears.

- [ ] **Step 2: Run the application test to verify it fails**

Run:

```powershell
rtk npm test -- src/renderer/App.test.tsx
```

Expected: FAIL because `App` still renders `DesktopShortcutDialog` and does
not pass error state.

- [ ] **Step 3: Wire the toast into the application**

In `src/renderer/App.tsx`, replace the dialog import with:

```ts
import { DesktopShortcutToast } from './components/DesktopShortcutToast';
```

Replace the final shortcut render block with:

```tsx
{shortcutPrompt.open && (
  <DesktopShortcutToast
    creating={shortcutPrompt.creating}
    error={shortcutPrompt.error}
    onCreate={shortcutPrompt.create}
    onDismiss={shortcutPrompt.dismiss}
  />
)}
```

- [ ] **Step 4: Run all shortcut-related tests**

Run:

```powershell
rtk npm test -- src/main/shortcut.test.ts src/main/ipc-handlers.test.ts src/renderer/hooks/useDesktopShortcutPrompt.test.ts src/renderer/components/DesktopShortcutToast.test.tsx src/renderer/App.test.tsx
```

Expected: all selected test files PASS.

- [ ] **Step 5: Run the full test suite**

Run:

```powershell
rtk npm test
```

Expected: the full Vitest suite PASS.

- [ ] **Step 6: Build the Windows distributables**

Run:

```powershell
rtk npm run make
```

Expected: Electron Forge completes and produces Windows artifacts under
`out\make`.

- [ ] **Step 7: Commit the application integration**

```powershell
rtk git add src/renderer/App.tsx src/renderer/App.test.tsx
rtk git commit -m "feat: integrate desktop shortcut toast" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```
