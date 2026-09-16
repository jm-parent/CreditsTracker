# Larger Patch-Notes Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enlarge the application update dialog and its release-notes viewport so patch notes are easier to read while preserving the existing update flow.

**Architecture:** Keep the change local to the presentational `UpdateDialog` component. Increase the dialog's responsive maximum width and replace the short fixed release-notes cap with a viewport-aware cap; no update state, IPC, or updater logic changes are needed. Add focused class assertions to the existing component test before changing the component.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4 utility classes, Vitest, Testing Library.

## Global Constraints

- Use `max-w-2xl` for the dialog panel.
- Use `max-h-[min(16rem,50vh)]` for the release-notes viewport.
- Keep the overlay padding at `p-4`.
- Keep release notes wrapped and vertically scrollable with the existing `whitespace-pre-wrap` and `overflow-y-auto` behavior.
- Do not change update state transitions, buttons, close behavior, accessibility attributes, IPC, or application-window behavior.
- Limit implementation changes to `src/renderer/components/UpdateDialog.tsx` and `src/renderer/components/UpdateDialog.test.tsx`.
- Preserve the existing available, downloading, ready, and error state coverage.

---

### Task 1: Add failing presentation assertions

**Files:**
- Modify: `src/renderer/components/UpdateDialog.test.tsx`

**Interfaces:**
- Consumes: The existing `renderDialog` test helper and `UpdateDialog` rendered markup.
- Produces: A focused regression test that requires the approved width and release-notes height classes.

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('UpdateDialog', () => { ... })` block:

```tsx
  it('uses a larger responsive surface for release notes', () => {
    renderDialog({ latestVersion: '1.6.0', releaseNotes: 'New badge' });

    expect(screen.getByRole('dialog').className).toContain('max-w-2xl');
    expect(screen.getByText('New badge').className).toContain('max-h-[min(16rem,50vh)]');
  });
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
npm test -- src/renderer/components/UpdateDialog.test.tsx
```

Expected: the existing four tests pass, and the new test fails because the
dialog still contains `max-w-md` and the notes block still contains
`max-h-40`.

- [ ] **Step 3: Commit the regression test**

```powershell
rtk git add src/renderer/components/UpdateDialog.test.tsx
rtk git commit -m "test: cover larger update notes popup" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Implement the approved responsive sizing

**Files:**
- Modify: `src/renderer/components/UpdateDialog.tsx:25-45`

**Interfaces:**
- Consumes: The existing `UpdateDialogProps` and `UpdateState` rendering branches.
- Produces: The same dialog states and controls with a wider panel and taller viewport-aware release-notes area.

- [ ] **Step 1: Replace only the two sizing utilities**

Change the dialog panel class from:

```tsx
className="w-full max-w-md rounded-lg border border-border bg-card p-5 text-card-foreground shadow-xl"
```

to:

```tsx
className="w-full max-w-2xl rounded-lg border border-border bg-card p-5 text-card-foreground shadow-xl"
```

Change the release-notes class from:

```tsx
className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted p-3 text-xs text-muted-foreground"
```

to:

```tsx
className="mt-3 max-h-[min(16rem,50vh)] overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted p-3 text-xs text-muted-foreground"
```

Do not alter the conditional rendering, text, handlers, button labels, or
accessibility attributes.

- [ ] **Step 2: Run the focused tests to verify the implementation**

Run:

```powershell
npm test -- src/renderer/components/UpdateDialog.test.tsx
```

Expected: all five `UpdateDialog` tests pass.

- [ ] **Step 3: Commit the implementation**

```powershell
rtk git add src/renderer/components/UpdateDialog.tsx
rtk git commit -m "fix: enlarge update release-notes popup" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Run regression verification

**Files:**
- Read: `src/renderer/components/UpdateDialog.tsx`
- Read: `src/renderer/components/UpdateDialog.test.tsx`

**Interfaces:**
- Consumes: The committed component and focused regression test from Tasks 1
  and 2.
- Produces: Evidence that the complete existing test suite and diff checks
  remain clean.

- [ ] **Step 1: Run the complete test suite**

Run:

```powershell
npm test
```

Expected: Vitest exits successfully with all existing tests passing.

- [ ] **Step 2: Check the final diff for whitespace errors and scope**

Run:

```powershell
rtk git --no-pager diff --check HEAD~2..HEAD
rtk git --no-pager diff --stat HEAD~2..HEAD
```

Expected: `git diff --check` produces no output, and the stat lists only the
focused test and `UpdateDialog` implementation changes from this plan.
