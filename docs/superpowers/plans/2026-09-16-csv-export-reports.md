# CSV Export Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated CSV export page that previews a filtered Copilot usage report and writes aggregated and session-level CSV files from the merged SQLite data source.

**Architecture:** Keep export filters local to a new renderer page. Add a typed main-process report query that returns both preview aggregates and export rows, then serialize and write the two CSV files in the main process after an Electron Save As flow. Reuse the existing merged database, logger, IPC wrapper, card/table primitives, and filter-option loading without changing the filters on existing dashboard tabs.

**Tech Stack:** Electron 44, React 19, TypeScript 7, better-sqlite3, Vitest, Testing Library, Tailwind CSS v4, lucide-react.

## Global Constraints

- Export data comes from the existing read-only merged CLI + Copilot Chat SQLite database; never read prompts or responses.
- The export page has independent project, model, inclusive `YYYY-MM-DD` date filters and shortcuts for last seven days, current month, previous month, and all data.
- The default export range is all available data; no `from` or `to` constraint is applied until the user chooses a shortcut or custom date.
- Produce two files from one action: one row per `date × project × model` in the summary file and one row per session in the sessions file.
- CSV files are UTF-8 with BOM, use `;` as the delimiter, quote fields containing `;`, quotes, or line breaks, and use `.` for decimal values.
- `Unassigned` is the exported project label when both `sessions.repository` and `sessions.cwd` are null.
- Save-dialog cancellation is a normal `{ cancelled: true }` result; invalid filters and file-system failures are surfaced and logged.
- Existing output files require explicit confirmation before overwrite.
- Preserve synchronous return behavior for existing synchronous IPC handlers while adding async error logging for the new export handlers.
- Use only existing project scripts and dependencies; do not add a CSV package or a new test runner.
- Every commit must use a Conventional Commit subject and include:
  `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`.

---

## File Map

### Shared contracts

- Modify `src/shared/types.ts` — add preview, aggregate-row, session-row,
  request, and result interfaces used by main, preload, and renderer.

### Main-process report and CSV code

- Modify `src/main/db.ts` — add the filtered report extraction and aggregate
  calculations beside the existing usage queries.
- Modify `src/main/db.test.ts` — cover report rows, session rows, filters,
  percentages, and empty/unknown-project behavior.
- Create `src/main/csv.ts` — pure CSV serialization, numeric formatting,
  headers, and derived summary/session file names.
- Create `src/main/csv.test.ts` — test delimiter, BOM, quoting, number
  formatting, headers, and path derivation.
- Create `src/main/export-files.ts` — write the two serialized files to
  resolved paths and return row counts.
- Modify `src/main/ipc-handlers.ts` — register preview/export channels, show
  dialogs, confirm overwrites, and preserve async error logging.
- Modify `src/main/ipc-handlers.test.ts` — cover channels, cancellation,
  successful file creation, overwrite confirmation, and rejected async calls.
- Modify `src/preload.ts` — expose typed preview and export bridge methods.
- Modify `src/renderer/window.d.ts` — declare the new `window.api` methods.

### Renderer period and page

- Create `src/renderer/lib/export-periods.ts` — deterministic period
  shortcuts, date clamping, and date-range validation.
- Create `src/renderer/lib/export-periods.test.ts` — test all shortcut
  boundaries and invalid ranges.
- Create `src/renderer/hooks/useExportPreview.ts` — request one preview for
  the current valid filter set and log failures.
- Create `src/renderer/hooks/useExportPreview.test.ts` — cover loading,
  success, failure, and cancellation on filter changes.
- Create `src/renderer/components/ExportFilters.tsx` — render export-only
  project/model/date controls and period buttons.
- Create `src/renderer/components/ExportFilters.test.tsx` — verify controls,
  shortcut callbacks, and custom date changes.
- Create `src/renderer/components/ExportPage.tsx` — own local filter state,
  preview cards/tables, validation, export action, and success/error states.
- Create `src/renderer/components/ExportPage.test.tsx` — cover the page
  states and the exact IPC export request.
- Modify `src/renderer/components/Sidebar.tsx` — add the CSV export entry and
  `DashboardTab` value.
- Modify `src/renderer/components/Sidebar.test.tsx` — test the new entry and
  active state.
- Modify `src/renderer/App.tsx` — route the export tab without rendering the
  global dashboard `FilterBar`.
- Modify `src/renderer/App.test.tsx` — mock the new bridge methods and test
  navigation and export-page integration.

### Documentation

- Modify `README.md` — list the CSV export page and its two-file output.
- Modify `docs/DEVELOPMENT.md` — document the new IPC channels and report
  responsibilities.

---

### Task 1: Add report contracts and database extraction

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/db.ts`
- Test: `src/main/db.test.ts`

**Interfaces:**
- Produces `ExportModelPreviewRow`, `ExportDailyPreviewRow`,
  `ExportPreview`, `ExportSummaryRow`, `ExportSessionRow`, `ExportReport`,
  `ExportRequest`, and `ExportResult` in `src/shared/types.ts`.
- Produces `getExportReport(db: Database.Database, filters: UsageFilters): ExportReport`
  in `src/main/db.ts`.
- Later tasks consume `ExportReport` for CSV serialization and
  `ExportPreview` for the renderer.

- [ ] **Step 1: Extend the shared types with exact export contracts**

Add these interfaces after `UsageResult` in `src/shared/types.ts`:

```ts
export interface ExportModelPreviewRow {
  model: string;
  aiuCredits: number;
  sharePercent: number;
}

export interface ExportDailyPreviewRow {
  date: string;
  aiuCredits: number;
  tokens: number;
  requests: number;
}

export interface ExportPreview {
  totals: UsageTotals;
  sessionCount: number;
  activeDays: number;
  byModel: ExportModelPreviewRow[];
  daily: ExportDailyPreviewRow[];
}

export interface ExportSummaryRow {
  date: string;
  project: string;
  model: string;
  aiuCredits: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  requests: number;
  dayTotalAiuCredits: number;
  modelTotalAiuCredits: number;
  modelSharePercent: number;
  projectTotalAiuCredits: number;
  projectSharePercent: number;
}

export interface ExportSessionRow {
  sessionId: string;
  createdAt: string;
  date: string;
  project: string;
  summary: string;
  models: string;
  aiuCredits: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  requests: number;
}

export interface ExportReport {
  preview: ExportPreview;
  summaryRows: ExportSummaryRow[];
  sessionRows: ExportSessionRow[];
}

export interface ExportRequest {
  filters: UsageFilters;
  suggestedName?: string;
}

export interface ExportResult {
  cancelled: boolean;
  summaryPath?: string;
  sessionsPath?: string;
  summaryRows?: number;
  sessionRows?: number;
}
```

- [ ] **Step 2: Write a failing database test for filtered aggregate and session rows**

Import `getExportReport` and add a `describe('getExportReport', ...)` block in
`src/main/db.test.ts`. Seed a schema that includes `summary`, add two events
for `s1` using two models, and add one event for a null-repository `s2`.
Assert the report shape with exact values:

```ts
it('groups daily/project/model rows and sessions using the selected filters', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT,
      repository TEXT,
      summary TEXT,
      created_at TEXT
    );
    CREATE TABLE assistant_usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      model TEXT NOT NULL,
      total_nano_aiu INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      created_at TEXT
    );
  `);
  db.prepare(`INSERT INTO sessions VALUES (?, ?, ?, ?, ?)`)
    .run('s1', 'C:/repo-a', 'org/repo-a', 'Mixed model work', '2026-09-01 10:00:00');
  db.prepare(`INSERT INTO sessions VALUES (?, ?, ?, ?, ?)`)
    .run('s2', null, null, null, '2026-09-03 10:00:00');
  const insertEvent = db.prepare(`
    INSERT INTO assistant_usage_events
      (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertEvent.run('s1', 'claude-sonnet-5', 3_000_000_000, 100, 20, '2026-09-01 10:00:05');
  insertEvent.run('s1', 'gpt-5.4', 1_000_000_000, 50, 10, '2026-09-01 10:05:00');
  insertEvent.run('s2', 'gpt-5.4', 2_000_000_000, 40, 5, '2026-09-03 11:00:00');

  const report = getExportReport(db, { from: '2026-09-01', to: '2026-09-03' });

  expect(report.preview.totals).toEqual({ aiuCredits: 6, tokens: 225, requests: 3 });
  expect(report.preview.sessionCount).toBe(2);
  expect(report.preview.activeDays).toBe(2);
  expect(report.preview.byModel).toEqual([
    { model: 'claude-sonnet-5', aiuCredits: 3, sharePercent: 50 },
    { model: 'gpt-5.4', aiuCredits: 3, sharePercent: 50 },
  ]);
  expect(report.sessionRows).toContainEqual(expect.objectContaining({
    sessionId: 's2',
    project: 'Unassigned',
    summary: '',
    models: 'gpt-5.4',
    aiuCredits: 2,
    inputTokens: 40,
    outputTokens: 5,
    tokens: 45,
    requests: 1,
  }));
  expect(report.summaryRows).toContainEqual(expect.objectContaining({
    date: '2026-09-01',
    project: 'org/repo-a',
    model: 'claude-sonnet-5',
    aiuCredits: 3,
    dayTotalAiuCredits: 4,
    modelSharePercent: 50,
    projectTotalAiuCredits: 4,
    projectSharePercent: expect.closeTo(66.66666666666667, 10),
  }));

  db.close();
});
```

Add a second failing test that applies `{ project: 'org/repo-a', model: 'gpt-5.4', from: '2026-09-02', to: '2026-09-03' }` and expects only the matching event on `2026-09-03`, plus a test that an inverted date range throws `Invalid export date range`.

- [ ] **Step 3: Run the focused test to verify it fails**

Run:

```powershell
npm test -- src\main\db.test.ts
```

Expected: FAIL because `getExportReport` and the export types do not exist.

- [ ] **Step 4: Implement `getExportReport` in `src/main/db.ts`**

Add the return types to the import list and implement the function after
`getProjectDetail`. Reuse `buildWhereClause(filters)` and the same
`assistant_usage_events e JOIN sessions s ON s.id = e.session_id` source used
by `getUsage`.

The implementation must:

1. throw `Error('Invalid export date range')` when both dates exist and
   `from > to`;
2. query grouped rows by `date(e.created_at)`, project
   `COALESCE(s.repository, s.cwd, 'Unassigned')`, and `e.model`;
3. use `COALESCE(SUM(COALESCE(e.input_tokens, 0)), 0)` and the equivalent
   output-token expression;
4. convert `total_nano_aiu` sums to credits by dividing by `1e9`;
5. compute period, day, model, and project totals from grouped rows using
   `Map`s, then add the percentage fields with a zero-denominator guard;
6. aggregate daily preview rows and model preview rows in deterministic
   date/model order;
7. query session rows using the same filtered event set, group by session id,
   sum input/output/credits, count events, and sort distinct models with
   `Array.from(new Set(...)).sort().join(', ')`;
8. return empty arrays and zero totals when no event matches.

Use `Number.isFinite` only for defensive percentage normalization; do not
silently drop rows or replace query errors with empty data.

- [ ] **Step 5: Run the focused database tests to verify they pass**

Run:

```powershell
npm test -- src\main\db.test.ts
```

Expected: PASS, including all existing database tests and the new report
tests.

- [ ] **Step 6: Commit the report contracts and query**

```powershell
rtk git add src\shared\types.ts src\main\db.ts src\main\db.test.ts
rtk git commit -m "feat: add export report data extraction" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Add pure CSV serialization and file path helpers

**Files:**
- Create: `src/main/csv.ts`
- Test: `src/main/csv.test.ts`

**Interfaces:**
- Produces `SUMMARY_HEADERS`, `SESSION_HEADERS`,
  `serializeCsv(headers, rows)`, `summaryRowsToCsv(rows)`,
  `sessionRowsToCsv(rows)`, and
  `getExportFilePaths(selectedPath)`.
- Consumes `ExportSummaryRow` and `ExportSessionRow` from Task 1.
- Task 3 consumes the serializer and path functions without knowing CSV
  formatting internals.

- [ ] **Step 1: Write failing serializer and path tests**

Create `src/main/csv.test.ts` with exact cases for the delimiter, BOM,
quoting, numbers, headers, and suffixes:

```ts
import { describe, expect, it } from 'vitest';
import {
  getExportFilePaths,
  serializeCsv,
  summaryRowsToCsv,
} from './csv';

describe('serializeCsv', () => {
  it('writes BOM, semicolon-separated values, CRLF rows, and escaped fields', () => {
    expect(serializeCsv(['name', 'value'], [['A;B', 'say "hi"\nnow']]))
      .toBe('\uFEFFname;value\r\n"A;B";"say ""hi""\nnow"\r\n');
  });
});

describe('summaryRowsToCsv', () => {
  it('maps report fields to the documented headers and stable numeric values', () => {
    const csv = summaryRowsToCsv([{
      date: '2026-09-01',
      project: 'org/repo-a',
      model: 'gpt-5.4',
      aiuCredits: 1.25,
      inputTokens: 10,
      outputTokens: 5,
      tokens: 15,
      requests: 1,
      dayTotalAiuCredits: 1.25,
      modelTotalAiuCredits: 1.25,
      modelSharePercent: 100,
      projectTotalAiuCredits: 1.25,
      projectSharePercent: 100,
    }]);

    expect(csv).toContain(
      'date;project;model;aiu_credits;input_tokens;output_tokens;tokens;requests;day_total_aiu_credits;model_total_aiu_credits;model_share_percent;project_total_aiu_credits;project_share_percent',
    );
    expect(csv).toContain('2026-09-01;org/repo-a;gpt-5.4;1.25;10;5;15;1;1.25;1.25;100.00;1.25;100.00');
  });
});

describe('getExportFilePaths', () => {
  it('strips one CSV extension and adds the two report suffixes', () => {
    expect(getExportFilePaths('C:\\reports\\usage.csv')).toEqual({
      summaryPath: 'C:\\reports\\usage-summary.csv',
      sessionsPath: 'C:\\reports\\usage-sessions.csv',
    });
  });
});
```

- [ ] **Step 2: Run the focused CSV test to verify it fails**

Run:

```powershell
npm test -- src\main\csv.test.ts
```

Expected: FAIL because `src/main/csv.ts` has not been created.

- [ ] **Step 3: Implement the pure CSV module**

Implement these exact exports in `src/main/csv.ts`:

```ts
export const SUMMARY_HEADERS: readonly string[] = [
  'date', 'project', 'model', 'aiu_credits', 'input_tokens',
  'output_tokens', 'tokens', 'requests', 'day_total_aiu_credits',
  'model_total_aiu_credits', 'model_share_percent',
  'project_total_aiu_credits', 'project_share_percent',
];

export const SESSION_HEADERS: readonly string[] = [
  'session_id', 'created_at', 'date', 'project', 'summary', 'models',
  'aiu_credits', 'input_tokens', 'output_tokens', 'tokens', 'requests',
];

export function serializeCsv(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): string;

export function summaryRowsToCsv(rows: readonly ExportSummaryRow[]): string;

export function sessionRowsToCsv(rows: readonly ExportSessionRow[]): string;

export function getExportFilePaths(selectedPath: string): {
  summaryPath: string;
  sessionsPath: string;
};
```

Use `;`, `\r\n`, and a leading `\uFEFF`. Convert nullish values to an empty
field, escape every `"` as `""`, and quote a field when it contains `;`, `"`,
`\r`, or `\n`. Format fractional numbers with at most nine decimal places,
remove trailing zeroes and the trailing decimal point, and format percentage
values with two decimal places before serializing them. Use `path.extname` and
`path.dirname` so Windows paths retain their directory.

- [ ] **Step 4: Run the focused CSV tests to verify they pass**

Run:

```powershell
npm test -- src\main\csv.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the pure CSV module**

```powershell
rtk git add src\main\csv.ts src\main\csv.test.ts
rtk git commit -m "feat: add CSV report serialization" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Expose preview and file export through the main process

**Files:**
- Create: `src/main/export-files.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/main/ipc-handlers.test.ts`
- Modify: `src/preload.ts`
- Modify: `src/renderer/window.d.ts`

**Interfaces:**
- Produces `writeExportFiles(paths: ExportFilePaths, report: ExportReport): Promise<{ summaryRows: number; sessionRows: number }>` in `src/main/export-files.ts`.
- Registers `get-export-preview` and `export-csv` IPC channels.
- Exposes `window.api.getExportPreview(filters)` and
  `window.api.exportCsv(request)`.
- Consumes `getExportReport` from Task 1 and CSV functions from Task 2.

- [ ] **Step 1: Write failing file-writer and IPC tests**

Add `dialog` to the Electron mock in `src/main/ipc-handlers.test.ts`:

```ts
dialog: {
  showSaveDialog: vi.fn(),
  showMessageBox: vi.fn(),
},
```

Import `dialog` alongside `app` and `ipcMain`, then add tests that call the
registered handlers from the mocked handler map:

```ts
it('registers and returns an empty export preview', async () => {
  registerIpcHandlers('/fake/path.db');
  const handlers = (ipcMain as unknown as {
    __handlers: Map<string, (...args: unknown[]) => unknown>;
  }).__handlers;

  await expect(handlers.get('get-export-preview')!({}, {})).resolves.toEqual({
    totals: { aiuCredits: 0, tokens: 0, requests: 0 },
    sessionCount: 0,
    activeDays: 0,
    byModel: [],
    daily: [],
  });
});

it('returns cancelled without writing when the save dialog is cancelled', async () => {
  (dialog.showSaveDialog as Mock).mockResolvedValueOnce({ canceled: true, filePath: '' });
  registerIpcHandlers('/fake/path.db');
  const handlers = (ipcMain as unknown as {
    __handlers: Map<string, (...args: unknown[]) => unknown>;
  }).__handlers;

  await expect(handlers.get('export-csv')!({}, { filters: {} })).resolves.toEqual({
    cancelled: true,
  });
});
```

Use a unique `os.tmpdir()` base path for the success case, mock
`showSaveDialog` to return it, await the handler, and assert both files exist,
contain the BOM and the expected headers, and are removed in a `finally`
block. Mock `showMessageBox` to return `{ response: 0 }` for overwrite
confirmation and add a second call that returns `{ response: 1 }` and expects
`{ cancelled: true }`. Mock `writeExportFiles` to reject with
`new Error('write failed')` and assert the export handler preserves the
rejection while `logError` receives the channel name.

- [ ] **Step 2: Run the focused IPC tests to verify they fail**

Run:

```powershell
npm test -- src\main\ipc-handlers.test.ts
```

Expected: FAIL because the new channels, dialog mock usage, and file writer
do not exist.

- [ ] **Step 3: Implement the file writer**

Create `src/main/export-files.ts`:

```ts
import fs from 'node:fs/promises';
import type { ExportReport } from '../shared/types';
import { sessionRowsToCsv, summaryRowsToCsv } from './csv';

export interface ExportFilePaths {
  summaryPath: string;
  sessionsPath: string;
}

export async function writeExportFiles(
  paths: ExportFilePaths,
  report: ExportReport,
): Promise<{ summaryRows: number; sessionRows: number }> {
  await fs.writeFile(paths.summaryPath, summaryRowsToCsv(report.summaryRows), 'utf8');
  await fs.writeFile(paths.sessionsPath, sessionRowsToCsv(report.sessionRows), 'utf8');
  return {
    summaryRows: report.summaryRows.length,
    sessionRows: report.sessionRows.length,
  };
}
```

Do not catch and replace write errors. The caller must receive the rejection.

- [ ] **Step 4: Add the IPC handlers and async rejection logging**

Import `dialog` from Electron, `fs` from `node:fs`, `getExportReport`, the
export types, `getExportFilePaths`, and `writeExportFiles` in
`src/main/ipc-handlers.ts`.

Preserve the current synchronous return behavior of `handle`, but attach
logging to promise results:

```ts
const result = (listener as (...inner: unknown[]) => unknown)(...args);
if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
  return Promise.resolve(result).then(
    (value) => {
      logSlowCall(channel, startedAt);
      return value;
    },
    (error) => {
      logError('ipc', `${channel} failed after ${Date.now() - startedAt}ms`, error);
      throw error;
    },
  );
}
logSlowCall(channel, startedAt);
return result;
```

Extract the existing slow-call warning into `logSlowCall(channel, startedAt)`
so both synchronous and asynchronous paths use the same threshold and
`UNTRACED_CHANNELS` check. Keep the existing synchronous `catch` unchanged.

Register:

```ts
handle('get-export-preview', (_event: unknown, filters: UsageFilters) => {
  return getExportReport(currentDb(), filters ?? {}).preview;
});

handle('export-csv', async (_event: unknown, request: ExportRequest) => {
  const report = getExportReport(currentDb(), request?.filters ?? {});
  const save = await dialog.showSaveDialog({
    title: 'Export Copilot usage',
    defaultPath: request?.suggestedName ?? 'copilot-usage.csv',
    filters: [{ name: 'CSV files', extensions: ['csv'] }],
  });
  if (save.canceled || !save.filePath) {
    return { cancelled: true } satisfies ExportResult;
  }

  const paths = getExportFilePaths(save.filePath);
  const existing = [paths.summaryPath, paths.sessionsPath].filter((filePath) => fs.existsSync(filePath));
  if (existing.length > 0) {
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Overwrite', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Files already exist',
      message: 'Overwrite the existing CSV files?',
      detail: existing.join('\n'),
    });
    if (confirmation.response !== 0) {
      return { cancelled: true } satisfies ExportResult;
    }
  }

  const counts = await writeExportFiles(paths, report);
  return {
    cancelled: false,
    ...paths,
    ...counts,
  } satisfies ExportResult;
});
```

The handler validates filters through `getExportReport` before opening the
dialog, and every write failure propagates to the enhanced async error path.

- [ ] **Step 5: Expose the typed bridge**

In `src/preload.ts`, import `ExportRequest`, `ExportResult`, and `ExportPreview`
and add:

```ts
getExportPreview: (filters: UsageFilters): Promise<ExportPreview> =>
  ipcRenderer.invoke('get-export-preview', filters),
exportCsv: (request: ExportRequest): Promise<ExportResult> =>
  ipcRenderer.invoke('export-csv', request),
```

Add the same signatures to `Window.api` in
`src/renderer/window.d.ts`.

- [ ] **Step 6: Run the focused IPC and main tests**

Run:

```powershell
npm test -- src\main\ipc-handlers.test.ts src\main\db.test.ts src\main\csv.test.ts
```

Expected: PASS, including the async rejection assertion and all existing
handlers.

- [ ] **Step 7: Commit the main-process export pipeline**

```powershell
rtk git add src\main\export-files.ts src\main\ipc-handlers.ts src\main\ipc-handlers.test.ts src\preload.ts src\renderer\window.d.ts
rtk git commit -m "feat: expose CSV report export through IPC" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Add deterministic period helpers and the preview hook

**Files:**
- Create: `src/renderer/lib/export-periods.ts`
- Test: `src/renderer/lib/export-periods.test.ts`
- Create: `src/renderer/hooks/useExportPreview.ts`
- Test: `src/renderer/hooks/useExportPreview.test.ts`

**Interfaces:**
- Produces `ExportPeriodPreset`,
  `getPresetFilters(preset, today, bounds)`,
  `validateExportFilters(filters)`, and
  `useExportPreview(filters, reloadToken?)`.
- Consumes `FilterOptions`, `UsageFilters`, and `ExportPreview`.
- Task 5 uses these functions without implementing date arithmetic in JSX.

- [ ] **Step 1: Write failing period-helper tests**

Create tests with a fixed `today = new Date(2026, 8, 16)` and bounds
`{ minDate: '2026-08-01', maxDate: '2026-09-16' }`:

```ts
it('returns the inclusive previous six days for last seven days', () => {
  expect(getPresetFilters('last-7-days', today, bounds))
    .toEqual({ from: '2026-09-10', to: '2026-09-16' });
});

it('clamps the current month and previous month to available bounds', () => {
  expect(getPresetFilters('this-month', today, bounds))
    .toEqual({ from: '2026-09-01', to: '2026-09-16' });
  expect(getPresetFilters('previous-month', today, bounds))
    .toEqual({ from: '2026-08-01', to: '2026-08-31' });
});

it('returns no dates for all data and reports inverted ranges', () => {
  expect(getPresetFilters('all', today, bounds)).toEqual({});
  expect(validateExportFilters({ from: '2026-09-02', to: '2026-09-01' }))
    .toBe('Start date must be on or before end date.');
  expect(validateExportFilters({ from: '2026-09-01', to: '2026-09-01' })).toBeNull();
});
```

- [ ] **Step 2: Run the period tests to verify they fail**

Run:

```powershell
npm test -- src\renderer\lib\export-periods.test.ts
```

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement date helpers**

Use local calendar dates, not UTC string conversion. Define:

```ts
export type ExportPeriodPreset =
  | 'all'
  | 'last-7-days'
  | 'this-month'
  | 'previous-month';

export function getPresetFilters(
  preset: ExportPeriodPreset,
  today: Date,
  bounds: Pick<FilterOptions, 'minDate' | 'maxDate'>,
): Pick<UsageFilters, 'from' | 'to'>;

export function validateExportFilters(filters: UsageFilters): string | null;
```

Format dates as local `YYYY-MM-DD`, compute last-seven-days as today minus six
calendar days, compute month boundaries with `new Date(year, month, day)`, and
clamp non-empty ranges to `minDate`/`maxDate`. Return `{}` for `all`.

- [ ] **Step 4: Add failing hook tests**

Mock `window.api.getExportPreview` and use `renderHook` to assert the hook
starts loading, resolves the exact preview, logs a rejected request, and does
not commit a stale response after the filter changes:

```ts
it('requests a preview for the current filters and exposes the result', async () => {
  const preview: ExportPreview = {
    totals: { aiuCredits: 4, tokens: 100, requests: 2 },
    sessionCount: 1,
    activeDays: 1,
    byModel: [{ model: 'gpt-5.4', aiuCredits: 4, sharePercent: 100 }],
    daily: [{ date: '2026-09-01', aiuCredits: 4, tokens: 100, requests: 2 }],
  };
  window.api.getExportPreview = vi.fn().mockResolvedValue(preview);

  const { result } = renderHook(() => useExportPreview({ model: 'gpt-5.4' }));

  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.data).toEqual(preview));
  expect(window.api.getExportPreview).toHaveBeenCalledWith({ model: 'gpt-5.4' });
});
```

- [ ] **Step 5: Run the hook test to verify it fails**

Run:

```powershell
npm test -- src\renderer\hooks\useExportPreview.test.ts
```

Expected: FAIL because `useExportPreview` does not exist.

- [ ] **Step 6: Implement `useExportPreview`**

Use the same cancellation pattern as `useUsageData`, but make one request per
filter dependency change and do not install a polling interval:

```ts
export interface UseExportPreviewResult {
  data: ExportPreview | null;
  loading: boolean;
  error: Error | null;
}

export function useExportPreview(filters: UsageFilters, reloadToken?: number): UseExportPreviewResult;
```

Call `validateExportFilters(filters)` before requesting. For an invalid range,
set `loading` to false, clear the current preview/error, and do not call the
bridge. For valid filters, call `window.api.getExportPreview(filters)`, keep
the previous successful preview while a new request is loading, clear errors
on success, and call
`logError('useExportPreview', 'getExportPreview failed', err)` on failure.
Include `reloadToken` in the effect dependencies so the page can retry the
same filter set. Ignore results after the effect cleanup.

- [ ] **Step 7: Run the period and hook tests**

Run:

```powershell
npm test -- src\renderer\lib\export-periods.test.ts src\renderer\hooks\useExportPreview.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit period and preview logic**

```powershell
rtk git add src\renderer\lib\export-periods.ts src\renderer\lib\export-periods.test.ts src\renderer\hooks\useExportPreview.ts src\renderer\hooks\useExportPreview.test.ts
rtk git commit -m "feat: add export period filters and preview hook" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Build the export filters and report preview page

**Files:**
- Create: `src/renderer/components/ExportFilters.tsx`
- Test: `src/renderer/components/ExportFilters.test.tsx`
- Create: `src/renderer/components/ExportPage.tsx`
- Test: `src/renderer/components/ExportPage.test.tsx`

**Interfaces:**
- Produces `ExportFilters` with props
  `{ options, filters, preset, onFiltersChange, onPresetChange }`.
- Produces `ExportPage` with props `{ options: FilterOptions }`.
- Consumes `getPresetFilters`, `validateExportFilters`, and
  `useExportPreview` from Task 4 plus `window.api.exportCsv` from Task 3.

- [ ] **Step 1: Write failing filter-component tests**

Render `ExportFilters` with one project, one model, all dates, and callbacks.
Assert IDs/labels `export-project-filter`, `export-model-filter`,
`export-from`, and `export-to`. Click `Last 7 days` and assert
`onPresetChange('last-7-days')`; edit the date and assert the corresponding
full filter callback preserves the other selected fields.

- [ ] **Step 2: Run the filter test to verify it fails**

Run:

```powershell
npm test -- src\renderer\components\ExportFilters.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement `ExportFilters`**

Render:

```tsx
interface ExportFiltersProps {
  options: FilterOptions;
  filters: UsageFilters;
  preset: ExportPeriodPreset;
  onFiltersChange: (filters: UsageFilters) => void;
  onPresetChange: (preset: ExportPeriodPreset) => void;
}
```

Use controlled `select` and `input type="date"` elements. The project and
model options must include an empty all option and use the existing
`options.projects`/`options.models`. Set the date inputs' `min` and `max`
attributes from `options.minDate` and `options.maxDate` when those bounds are
available. Shortcut buttons call only `onPresetChange`; date edits call
`onFiltersChange` and clear the active preset in `ExportPage`.

- [ ] **Step 4: Write failing export-page tests**

Mock `window.api.getExportPreview` with:

```ts
const preview: ExportPreview = {
  totals: { aiuCredits: 6, tokens: 225, requests: 3 },
  sessionCount: 2,
  activeDays: 2,
  byModel: [
    { model: 'claude-sonnet-5', aiuCredits: 3, sharePercent: 50 },
    { model: 'gpt-5.4', aiuCredits: 3, sharePercent: 50 },
  ],
  daily: [
    { date: '2026-09-01', aiuCredits: 4, tokens: 180, requests: 2 },
    { date: '2026-09-03', aiuCredits: 2, tokens: 45, requests: 1 },
  ],
};
```

Assert the cards, `50.00%`, both dates, and the export button. Mock
`window.api.exportCsv` to resolve:

```ts
{
  cancelled: false,
  summaryPath: 'C:\\reports\\usage-summary.csv',
  sessionsPath: 'C:\\reports\\usage-sessions.csv',
  summaryRows: 2,
  sessionRows: 2,
}
```

Click the button and assert it calls:

```ts
expect(window.api.exportCsv).toHaveBeenCalledWith({
  filters: {},
  suggestedName: 'copilot-usage.csv',
});
```

Also test the empty preview message, an invalid custom date range disabling
the button without calling `getExportPreview`, a rejected export showing an
error, and a cancelled export not showing a success message.

- [ ] **Step 5: Run the page test to verify it fails**

Run:

```powershell
npm test -- src\renderer\components\ExportPage.test.tsx
```

Expected: FAIL because `ExportPage` does not exist.

- [ ] **Step 6: Implement `ExportPage`**

Initialize `filters` to `{}`, `preset` to `'all'`, and `reloadToken` to `0`.
Call `useExportPreview(filters, reloadToken)`. On a preset change,
derive `{ from, to }` with `getPresetFilters`, preserve project/model
filters, and set the new preset. On custom date changes, preserve project/model,
apply the date change, and set the preset to `'all'` when the range no longer
matches a shortcut.

Render a page wrapper with:

- heading `CSV export`;
- `ExportFilters`;
- a validation paragraph with `role="alert"` when
  `validateExportFilters(filters)` returns a message;
- four cards labelled `AIU credits`, `Tokens`, `Requests`, and `Sessions`;
- model table columns `Model`, `AIU credits`, `% of period`;
- daily table columns `Date`, `AIU credits`, `Tokens`, `Requests`;
- loading skeleton while the first preview is pending;
- `No usage for this selection.` when the preview is empty;
- preview failure notice with a retry button that increments `reloadToken`;
- `Export 2 CSV files` button disabled for invalid, loading, error, or empty
  preview states.

On export, call `window.api.exportCsv({ filters, suggestedName: 'copilot-usage.csv' })`.
Set a success message containing both returned paths and row counts. For a
rejected promise call `logError('ExportPage', 'CSV export failed', error)` and
show an error alert. Treat `cancelled: true` as no-op feedback.

Use `formatTokens` for preview display, but pass raw numeric values only
through the IPC request; do not use display strings in CSV data.

- [ ] **Step 7: Run the renderer page tests**

Run:

```powershell
npm test -- src\renderer\components\ExportFilters.test.tsx src\renderer\components\ExportPage.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit the export page**

```powershell
rtk git add src\renderer\components\ExportFilters.tsx src\renderer\components\ExportFilters.test.tsx src\renderer\components\ExportPage.tsx src\renderer\components\ExportPage.test.tsx
rtk git commit -m "feat: add CSV export report page" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 6: Wire navigation and app-level behavior

**Files:**
- Modify: `src/renderer/components/Sidebar.tsx`
- Modify: `src/renderer/components/Sidebar.test.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

**Interfaces:**
- `DashboardTab` gains `'export'`.
- `Sidebar` emits `'export'` through its existing `onTabChange`.
- `App` renders `<ExportPage options={options} />` for the export tab and does
  not render the global `FilterBar` there.

- [ ] **Step 1: Write failing navigation and integration tests**

Update `src/renderer/components/Sidebar.test.tsx` to expect the CSV export
button and its icon/active class behavior. In `src/renderer/App.test.tsx`,
add `getExportPreview` and `exportCsv` mocks to the `window.api` fixture, then
add:

```ts
it('opens the independent CSV export page from the sidebar', async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText('3.00');

  await user.click(screen.getByRole('button', { name: 'CSV export' }));

  expect(await screen.findByRole('heading', { name: 'CSV export' })).toBeInTheDocument();
  expect(document.querySelector('#project-filter')).toBeNull();
  expect(window.api.getExportPreview).toHaveBeenCalledWith({});
});
```

Add a second test that opens project detail, switches to CSV export, and
asserts the project detail heading disappears. This confirms the existing
overlay-clearing behavior covers the new tab.

- [ ] **Step 2: Run the app and sidebar tests to verify they fail**

Run:

```powershell
npm test -- src\renderer\components\Sidebar.test.tsx src\renderer\App.test.tsx
```

Expected: FAIL because the new tab, route, and bridge mocks are not wired.

- [ ] **Step 3: Add the sidebar entry**

In `Sidebar.tsx`:

```ts
export type DashboardTab =
  | 'daily'
  | 'monthly'
  | 'projects'
  | 'models'
  | 'raw'
  | 'export'
  | 'logs';
```

Import `Download` from `lucide-react` and add
`{ id: 'export', label: 'CSV export', icon: Download }` to `ENTRIES` before
`Logs`. Keep the existing active-state and `aria-current` behavior.

- [ ] **Step 4: Route the page in `App.tsx`**

Import `ExportPage`. Add an early non-logs branch before the raw-data branch:

```tsx
{activeTab === 'export' ? (
  <ExportPage options={options} />
) : activeTab === 'raw' && !selectedProject ? (
  <RawDataPage onBack={() => setActiveTab('daily')} />
) : (
  // existing filtered dashboard tabs
)}
```

Ensure the global `FilterBar` is rendered only for daily/monthly/projects/
models, not raw or export. Leave `handleTabChange` clearing
`selectedProject` and `selectedDate`, and keep `Sidebar` rendered during the
existing loading/empty/logs flows.

- [ ] **Step 5: Update renderer fixtures and run focused tests**

Add these mocks to the `window.api` fixture in `App.test.tsx`:

```ts
getExportPreview: vi.fn().mockResolvedValue({
  totals: { aiuCredits: 0, tokens: 0, requests: 0 },
  sessionCount: 0,
  activeDays: 0,
  byModel: [],
  daily: [],
}),
exportCsv: vi.fn().mockResolvedValue({ cancelled: true }),
```

Run:

```powershell
npm test -- src\renderer\components\Sidebar.test.tsx src\renderer\App.test.tsx src\renderer\components\ExportPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit navigation wiring**

```powershell
rtk git add src\renderer\components\Sidebar.tsx src\renderer\components\Sidebar.test.tsx src\renderer\App.tsx src\renderer\App.test.tsx
rtk git commit -m "feat: add CSV export navigation" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 7: Update documentation and perform final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/DEVELOPMENT.md`

**Interfaces:**
- Documentation reflects the seven dashboard navigation entries, two CSV
  outputs, filter shortcuts, privacy boundary, and new IPC channels.
- No production API or UI behavior changes beyond the prior tasks.

- [ ] **Step 1: Update the README feature list**

Add a **CSV export** bullet that states the page supports independent project,
model, and date filters and writes `*-summary.csv` and `*-sessions.csv`.
Update the sidebar count wording from six tabs to seven tabs if present, and
state that summaries may be included but prompts/responses are never
exported.

- [ ] **Step 2: Update the developer guide**

Add `ExportPage`, `ExportFilters`, `useExportPreview`, `csv.ts`, and
`export-files.ts` to the project layout. Add `get-export-preview` and
`export-csv` rows to the IPC table. Document that report extraction happens
against the merged in-memory database and file writes happen in the main
process after a Save As dialog.

- [ ] **Step 3: Run the full existing test suite**

Run:

```powershell
npm test
```

Expected: PASS for every existing and new Vitest test.

- [ ] **Step 4: Check the final diff and repository status**

Run:

```powershell
rtk git diff --check
rtk git status --short
rtk git log -8 --oneline --decorate
```

Expected: no whitespace errors, only the intended committed changes, and all
feature commits use Conventional Commit subjects with the Copilot co-author
trailer.

- [ ] **Step 5: Commit the documentation**

```powershell
rtk git add README.md docs\DEVELOPMENT.md
rtk git commit -m "docs: document CSV export reports" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

- [ ] **Step 6: Run the full suite once after the documentation commit**

Run:

```powershell
npm test
```

Expected: PASS with no source or test regressions.
