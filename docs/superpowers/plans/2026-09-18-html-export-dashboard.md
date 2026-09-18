# Export HTML du tableau de bord — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les deux fichiers CSV de l'export par un rapport HTML autonome, statique et hors ligne qui reprend le tableau de bord de consommation.

**Architecture:** Un générateur pur `renderHtmlReport` construit un document HTML complet à partir d'un `ExportReport`, avec CSS et SVG inline. Le processus main conserve la boîte de sauvegarde et la publication atomique, mais écrit un seul chemin `.html`; le renderer appelle ce flux via `exportHtml`/`export-html`. Les agrégations projet et tokens entrée/sortie sont calculées dans le générateur à partir des lignes déjà chargées, sans nouvelle requête SQLite.

**Tech Stack:** Electron 44, TypeScript, React 19, Vitest, Node `fs/promises`, SVG et CSS inline sans dépendance externe.

## Global Constraints

- L'export réussi produit exactement un fichier `.html`; aucune sortie `*-summary.csv` ou `*-sessions.csv` ne subsiste dans l'interface.
- Le rapport est un instantané statique autonome : aucun `<script>`, CDN, police distante, image externe ou ressource réseau.
- Le rapport utilise `ExportReport` et ses `preview`, `summaryRows` et `sessionRows`; aucune requête SQLite supplémentaire n'est ajoutée.
- Toute valeur textuelle issue des projets, modèles ou résumés est échappée avant insertion HTML/SVG; les nombres non finis sont ramenés à une valeur sûre.
- La publication est atomique et restaure le fichier existant lorsqu'une étape de publication échoue.
- Les filtres de période, projet et modèle, l'aperçu, l'annulation, la confirmation d'écrasement et les messages d'erreur restent fonctionnels.
- Le document exporté porte `lang="fr"`, possède un thème sombre responsive, des règles d'impression et des états explicites pour les données vides.
- Les contrats IPC/preload/renderer utilisent `exportHtml`, le canal `export-html` et `htmlPath`; `summaryPath` et `sessionsPath` sont supprimés.
- Les libellés et messages de l'interface d'export restent en anglais afin de rester cohérents avec l'application actuelle; le document exporté garde `lang="fr"`.
- Chaque commit créé pendant l'exécution inclut le trailer `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`.

---

## File structure

**Create:**

- `src/main/html-report.ts` — génération pure du document HTML, agrégations d'affichage, échappement, formatage et graphiques SVG.
- `src/main/html-report.test.ts` — tests du document complet, des données vides, de l'échappement et de l'absence de ressources externes.

**Modify:**

- `src/main/export-files.ts` — normalisation du chemin `.html` et publication atomique d'un fichier unique.
- `src/main/export-files.test.ts` — tests du writer HTML et de la restauration atomique.
- `src/main/ipc-handlers.ts` — remplacement du canal `export-csv` par `export-html`.
- `src/main/ipc-handlers.test.ts` — assertions de dialogue, écriture, annulation et erreurs pour le rapport HTML.
- `src/shared/types.ts` — résultat d'export avec `htmlPath`.
- `src/preload.ts` — exposition de `exportHtml`.
- `src/renderer/window.d.ts` — contrat TypeScript de `Window['api']`.
- `src/renderer/test-utils/windowApi.ts` — mock par défaut `exportHtml`.
- `src/renderer/components/ExportPage.tsx` — libellés, appel IPC et messages HTML.
- `src/renderer/components/ExportPage.test.tsx` — tests du nouveau flux UI.
- `src/renderer/App.test.tsx` — mock global du nouveau contrat.

**Delete:**

- `src/main/csv.ts` — sérialisation et chemins spécifiques aux CSV devenus inutiles.
- `src/main/csv.test.ts` — tests de la sortie CSV supprimée.

---

### Task 1: Creating the standalone HTML report renderer

**Files:**
- Create: `src/main/html-report.ts`
- Create: `src/main/html-report.test.ts`

**Interfaces:**
- Consumes: `ExportReport` and `UsageFilters` from `src/shared/types.ts`.
- Produces: `renderHtmlReport(report: ExportReport, options: HtmlReportOptions): string`, where `HtmlReportOptions` is `{ filters: UsageFilters; generatedAt?: Date }`.

- [ ] **Step 1: Write failing renderer tests for the complete report**

Create a small deterministic `ExportReport` fixture with two dates, two models, two projects, input/output tokens, one session summary containing HTML-sensitive text, and a fixed generation date. Start the assertions with the stable semantic section IDs the renderer will expose:

```ts
const html = renderHtmlReport(REPORT, {
  filters: {
    from: '2026-09-01',
    to: '2026-09-16',
    project: 'org/repo-a',
    model: 'gpt-5.4',
  },
  generatedAt: new Date('2026-09-18T07:05:00.000Z'),
});

expect(html).toContain('<!doctype html>');
expect(html).toContain('<html lang="fr">');
expect(html).toContain('id="daily-consumption"');
expect(html).toContain('id="model-breakdown"');
expect(html).toContain('id="project-consumption"');
expect(html).toContain('id="token-ratio"');
expect(html).toContain('id="execution-details"');
expect(html).toContain('<svg');
expect(html).toContain('org/repo-a');
expect(html).toContain('gpt-5.4');
expect(html).toContain('Export report');
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `rtk npm test -- src/main/html-report.test.ts`

Expected: FAIL because `src/main/html-report.ts` and `renderHtmlReport` do not exist yet.

- [ ] **Step 3: Define the renderer contract and safe formatting helpers**

Implement the public contract and keep all rendering helpers private to `html-report.ts`:

```ts
export interface HtmlReportOptions {
  filters: UsageFilters;
  generatedAt?: Date;
}

export function renderHtmlReport(
  report: ExportReport,
  options: HtmlReportOptions,
): string;
```

Add `escapeHtml(value: string): string` for `&`, `<`, `>`, `"`, and `'`; `safeNumber(value: number): number` returning `0` for `NaN`/infinite values; and stable `formatCredits`, `formatTokens`, `formatPercent`, and `formatDate` helpers. Use the supplied `generatedAt` in tests and `new Date()` only when it is omitted.

- [ ] **Step 4: Implement report aggregations without database access**

Build private arrays from `summaryRows`/`sessionRows`:

```ts
interface ProjectReportRow {
  project: string;
  aiuCredits: number;
  sharePercent: number;
}

interface ModelReportRow {
  model: string;
  aiuCredits: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  requests: number;
  sharePercent: number;
}
```

Aggregate each project and model across all summary rows, calculate shares against total AIU credits only when the denominator is positive, and keep zero values for empty/zero-denominator reports. Use `report.preview.daily` for the daily chart, `report.preview.totals`/counts for KPI cards, and `report.sessionRows` for the detailed table.

- [ ] **Step 5: Render the self-contained dashboard**

Return a complete document with inline `<style>` and no script tags. Include:

1. header metadata for selected period/project/model and generated timestamp;
2. KPI cards for AIU credits, tokens, requests, sessions and active days;
3. `id="daily-consumption"` with an accessible SVG line/area chart whose points use numeric coordinates only;
4. `id="model-breakdown"` with an SVG donut, escaped legend labels and percentages;
5. `id="project-consumption"` with escaped project labels and proportional CSS bars;
6. `id="token-ratio"` with input/output bars per model and zero-safe percentages;
7. `id="execution-details"` with an escaped session table including summary text;
8. explicit `No usage for this selection.`/`No data available` messages instead of invalid SVG geometry when a section has no data.

Add responsive cards, horizontal table overflow, readable dark colors and `@media print` rules. Use `white-space: pre-wrap` for summary cells so escaped newlines remain readable.

- [ ] **Step 6: Add security and empty-data tests**

Extend `html-report.test.ts` with assertions that a value such as `<img src=x onerror="bad">&` appears only as escaped text, that the raw payload is absent, and that empty/zero reports contain no `NaN`, `Infinity`, `undefined`, `<script`, `http://`, or `https://`. Assert the empty-state labels and `lang="fr"` in the empty case.

- [ ] **Step 7: Run the renderer tests and commit**

Run: `rtk npm test -- src/main/html-report.test.ts`

Expected: PASS for the complete, escaped, empty and zero-denominator report cases.

Commit:

```bash
rtk git add src/main/html-report.ts src/main/html-report.test.ts
rtk git commit -m "feat: render standalone HTML usage reports" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Replacing the CSV transport with one atomic HTML file

**Files:**
- Modify: `src/main/export-files.ts`
- Modify: `src/main/export-files.test.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/main/ipc-handlers.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/preload.ts`
- Delete: `src/main/csv.ts`
- Delete: `src/main/csv.test.ts`

**Interfaces:**
- Consumes: `renderHtmlReport`/`HtmlReportOptions` from Task 1 and the existing `ExportReport`.
- Produces: `getExportFilePath(selectedPath: string): string`, `writeExportFile(destinationPath: string, contents: string): Promise<void>`, and `ExportResult { cancelled: boolean; htmlPath?: string; summaryRows?: number; sessionRows?: number }`.

- [ ] **Step 1: Rewrite transport tests to describe the HTML contract**

In `export-files.test.ts`, replace the report fixture with a simple HTML string and add path expectations:

```ts
expect(getExportFilePath('C:\\reports\\usage.html')).toBe('C:\\reports\\usage.html');
expect(getExportFilePath('C:\\reports\\usage.csv')).toBe('C:\\reports\\usage.html');
expect(getExportFilePath('C:\\reports\\usage')).toBe('C:\\reports\\usage.html');
```

Keep an atomic-failure test that pre-populates the destination, makes the publish rename fail, expects `writeExportFile` to reject, verifies the original contents, and verifies no `.staged`/`.backup` file remains.

Use the existing `fsPromises.rename` spy pattern with a failure on the publish rename:

```ts
fs.writeFileSync(destinationPath, 'original', 'utf8');
const originalRename = fsPromises.rename.bind(fsPromises);
let renameCallCount = 0;
vi.spyOn(fsPromises, 'rename').mockImplementation(async (from, to) => {
  renameCallCount += 1;
  if (renameCallCount === 2) {
    throw new Error('publish failed');
  }
  await originalRename(from, to);
});

await expect(writeExportFile(destinationPath, '<!doctype html>new')).rejects.toThrow('publish failed');
expect(fs.readFileSync(destinationPath, 'utf8')).toBe('original');
expect(fs.readdirSync(exportRoot)).toEqual(['usage.html']);
```

- [ ] **Step 2: Rewrite IPC tests for the new channel and dialog**

Update `ipc-handlers.test.ts` to expect `export-html`, `htmlPath`, one existing destination, and the HTML filter:

```ts
expect(dialog.showSaveDialog).toHaveBeenCalledWith({
  title: 'Export Copilot usage',
  defaultPath: 'copilot-usage.html',
  filters: [{ name: 'HTML files', extensions: ['html'] }],
});
```

Cover save cancellation, successful overwrite confirmation with an HTML document containing `<!doctype html>`, declined overwrite preserving the old file, and a writer rejection logged with a message containing `export-html`. Assert that no second CSV path or CSV sibling is created.

- [ ] **Step 3: Run the rewritten main tests to verify the old implementation fails**

Run: `rtk npm test -- src/main/export-files.test.ts src/main/ipc-handlers.test.ts`

Expected: FAIL because the repository still registers `export-csv`, exposes two CSV paths, and imports the CSV helpers.

- [ ] **Step 4: Refactor the atomic writer to one destination**

In `src/main/export-files.ts`, retain the existing temporary-token, backup, rollback and combined-error behavior but expose:

```ts
export function getExportFilePath(selectedPath: string): string;

export async function writeExportFile(
  destinationPath: string,
  contents: string,
): Promise<void>;
```

Normalize any selected extension to `.html`, write one staged file, move an existing destination to one backup, publish the staged file, and clean temporary files. On failure remove a published replacement, restore the backup, and rethrow the original error or the existing combined rollback error.

- [ ] **Step 5: Replace the main IPC handler and shared result type**

Change `ExportResult` in `src/shared/types.ts` to:

```ts
export interface ExportResult {
  cancelled: boolean;
  htmlPath?: string;
  summaryRows?: number;
  sessionRows?: number;
}
```

In `registerIpcHandlers`, replace `handle('export-csv', ...)` with `handle('export-html', ...)`. Use `request?.suggestedName ?? 'copilot-usage.html'`, normalize `save.filePath` with `getExportFilePath`, check only that path, use the warning message `Overwrite the existing HTML report?`, generate with:

```ts
const html = renderHtmlReport(report, {
  filters: request?.filters ?? {},
});
await writeExportFile(htmlPath, html);
```

Return `{ cancelled: false, htmlPath, summaryRows: report.summaryRows.length, sessionRows: report.sessionRows.length }`. Keep the existing cancelled result before any write.

- [ ] **Step 6: Remove the CSV serializer and wire the preload**

Delete `csv.ts` and `csv.test.ts` after all imports are removed. In `src/preload.ts`, expose:

```ts
exportHtml: (request: ExportRequest): Promise<ExportResult> =>
  ipcRenderer.invoke('export-html', request),
```

Update the existing writer mock in `ipc-handlers.test.ts` from `writeExportFiles` to `writeExportFile` and keep the actual implementation available for the successful-file assertions.

- [ ] **Step 7: Run the main transport tests and commit**

Run: `rtk npm test -- src/main/export-files.test.ts src/main/ipc-handlers.test.ts`

Expected: PASS for path normalization, atomic rollback, HTML dialog behavior, IPC result shape and error logging.

Commit:

```bash
rtk git add src/main/export-files.ts src/main/export-files.test.ts src/main/ipc-handlers.ts src/main/ipc-handlers.test.ts src/shared/types.ts src/preload.ts
rtk git rm src/main/csv.ts src/main/csv.test.ts
rtk git commit -m "feat: replace CSV export transport with HTML" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Updating the renderer export experience

**Files:**
- Modify: `src/renderer/components/ExportPage.tsx`
- Modify: `src/renderer/components/ExportPage.test.tsx`
- Modify: `src/renderer/window.d.ts`
- Modify: `src/renderer/test-utils/windowApi.ts`
- Modify: `src/renderer/App.test.tsx`

**Interfaces:**
- Consumes: `Window['api'].exportHtml(request: ExportRequest): Promise<ExportResult>` from Task 2.
- Produces: unchanged filter/preview behavior with HTML-specific labels and status/error messages.

- [ ] **Step 1: Update renderer mocks, type declaration and expectations**

Replace every `exportCsv` mock with `exportHtml`, update `Window['api']` accordingly, and make the default mock return `{ cancelled: true }`. Change the success fixture to return:

```ts
{
  cancelled: false,
  htmlPath: 'C:\\reports\\usage.html',
  summaryRows: 2,
  sessionRows: 2,
}
```

Update role queries and expectations to use the exact button label `Export HTML report`, `copilot-usage.html`, `htmlPath`, and the error text `Could not export the HTML report. Please try again.`.

- [ ] **Step 2: Run the renderer tests to verify the old UI fails**

Run: `rtk npm test -- src/renderer/components/ExportPage.test.tsx src/renderer/App.test.tsx`

Expected: FAIL because `ExportPage` still calls `window.api.exportCsv` and renders CSV labels.

- [ ] **Step 3: Switch the ExportPage call and copy**

Change `handleExport` to:

```ts
const result = await window.api.exportHtml({
  filters,
  suggestedName: 'copilot-usage.html',
});
```

Keep cancellation silent, set success text from `result.htmlPath` and both row counts, log `logError('ExportPage', 'HTML export failed', err)`, and show the HTML-specific error. Change the heading to `HTML export`, the action label to `Export HTML report`, and the busy label to `Exporting…`; do not alter filter normalization, preview loading, empty-state disabling, or retry behavior.

- [ ] **Step 4: Run the focused renderer suite and commit**

Run: `rtk npm test -- src/renderer/components/ExportPage.test.tsx src/renderer/App.test.tsx`

Expected: PASS for success, empty preview, invalid ranges, preview retry, export error, cancellation and filter preservation.

Commit:

```bash
rtk git add src/renderer/components/ExportPage.tsx src/renderer/components/ExportPage.test.tsx src/renderer/window.d.ts src/renderer/test-utils/windowApi.ts src/renderer/App.test.tsx
rtk git commit -m "feat: expose HTML export in the renderer" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Running integration validation and removing stale references

**Files:**
- None (verification only). If a check exposes a contract mismatch, fix it in the task that introduced that contract; do not change unrelated dashboard behavior.

**Interfaces:**
- Consumes: the complete HTML export flow from Tasks 1–3.
- Produces: a verified branch with no production CSV export references and passing tests/type checks.

- [ ] **Step 1: Search production code for stale CSV contracts**

Run:

```bash
rtk graft build
rtk graft grep "export-csv|exportCsv|summaryPath|sessionsPath|CSV export|CSV files|copilot-usage.csv"
```

Expected: no matches in `src/`; references in historical design/plan documents are not production behavior. If `graft build` updates machine-specific helper files, leave those local generated changes unstaged.

- [ ] **Step 2: Run the complete test suite**

Run: `rtk npm test`

Expected: all Vitest tests pass, including the new HTML renderer, atomic writer, IPC and renderer tests.

- [ ] **Step 3: Run the TypeScript check and diff hygiene checks**

Run:

```bash
rtk npx tsc --noEmit
rtk git diff --check
rtk git status --short
```

Expected: TypeScript exits successfully, `git diff --check` reports no whitespace errors, and only intended source/spec/plan changes or known local graft-generated files are present.

- [ ] **Step 4: Verify the committed implementation**

Run: `rtk git log --oneline -4`

Expected: the three implementation commits appear in order after the committed design specification, each using a Conventional Commit prefix and the required co-author trailer.
