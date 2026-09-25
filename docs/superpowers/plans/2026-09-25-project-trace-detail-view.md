# Project Trace Detail View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a conversation trace as an in-place subview of its project detail and return without losing the current project context.

**Architecture:** `App.tsx` continues to own the selected project and selected trace; opening a trace changes only the selected trace, not the active tab or selected project. `ProjectDetailPage` renders a focused trace subview while a trace is selected, using the existing `useAgentTrace` hook and `AgentTraceTree`; its Back action clears only the trace selection. The global **Traces agents** page remains the place for collection status, opt-in, and configuration.

**Tech Stack:** Electron 44, Node 24, TypeScript 7, React 19, Vitest, React Testing Library.

## Global Constraints

- La collecte de contenu est opt-in et l'export reste local.
- Le récepteur OTLP est lié uniquement à l'interface loopback.
- Le stockage limite les champs de contexte non sensibles aux arguments et résultats d'outil connus ; prompts, réponses, messages système, messages, schémas d'outils et attributs OTLP inconnus sont exclus. Les clés dynamiques propres à l'outil restent conservées à l'intérieur de ces arguments/résultats après masquage et troncature.
- Les champs autorisés sont parcourus pour expurger les secrets connus. La première version doit reconnaître au minimum les formats de jetons GitHub, les identifiants de clés AWS, les valeurs `Bearer`, les blocs de clés privées PEM et les paires clé/valeur dont la clé contient `token`, `secret`, `password`, `api_key` ou `authorization`. Une clé est reconnue qu'elle soit préfixée, suffixée ou entre guillemets (`GITHUB_TOKEN=`, `client_secret:`, `"password": "…"`), et les clés JSON sont normalisées sans `_`, `-` ni casse (`apiKey`). Le JSON encodé dans une chaîne est expurgé comme une structure. Un en-tête ou pied de clé privée sans sa borne correspondante rend le contenu omis. Les valeurs binaires sont omises, jamais encodées.
- Après expurgation, chaque champ d'argument ou de résultat est limité à 32 KiB UTF-8.
- Si l'expurgation échoue, si le contenu est illisible ou si son traitement est ambigu, le contenu complet est omis ; les métadonnées non sensibles sont conservées.
- Les traces détaillées expirent 30 jours après leur réception et peuvent être supprimées manuellement.
- Aucun texte de raisonnement interne, prompt complet ou réponse complète du modèle n'est persisté ou affiché. Quand la capture de contenu est activée pour exporter les arguments/résultats, prompts et réponses peuvent transiter sur loopback ; le décodeur les ignore et le store ne persiste que les payloads d'outils expurgés.
- Les appels frères sont ordonnés chronologiquement ; aucun lien parent-enfant ne doit être inventé à partir d'une proximité temporelle.
- Les sessions antérieures à l'activation ne sont pas garanties d'être récupérables ; les appels en cours ne sont pas affichés en temps réel.
- La base Copilot CLI reste en lecture seule et les tables de consommation existantes ne changent pas.
- Les sources prises en charge dans cette version sont Copilot Chat de VS Code et Copilot CLI ; toute autre source est rejetée explicitement.
- CI et les builds utilisent Node 24. Ne pas retirer `--ignore-scripts` des installations CI.
- Toutes les commandes shell sont préfixées par `rtk`. Chaque commit est un Conventional Commit et inclut `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`.
- Le worktree contient des changements préexistants hors périmètre dans `.claude\` et `.github\copilot-instructions.md`. Ne pas les modifier ni les ajouter aux commits de la fonctionnalité.

---

## File structure

**Create:**

- `src/renderer/components/ProjectTraceSubview.tsx` — focused trace-only view rendered inside a selected project's detail.
- `src/renderer/components/ProjectTraceSubview.test.tsx` — loading, error, availability, tree, and Back behavior for the subview.

**Modify:**

- `src/renderer/App.tsx`, `src/renderer/App.test.tsx` — keep project navigation active when a row opens a trace, pass the trace selection into project detail, and clear stale trace selection when another project is opened.
- `src/renderer/components/ProjectDetailPage.tsx`, `src/renderer/components/ProjectDetailPage.test.tsx` — render the trace subview while a selection is active and restore the existing project detail when Back is used.

## Task 1: Keep conversation trace drilldown inside project detail

**Files:**
- Create: `src/renderer/components/ProjectTraceSubview.tsx`
- Create: `src/renderer/components/ProjectTraceSubview.test.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`
- Modify: `src/renderer/components/ProjectDetailPage.tsx`
- Modify: `src/renderer/components/ProjectDetailPage.test.tsx`

**Interfaces:**
- Consumes: `AgentTraceSelection`, `AgentTraceSession`, `useAgentTrace(selection)`, and `AgentTraceTree(session)`.
- Produces:

```ts
export interface ProjectTraceSubviewProps {
  project: string;
  selection: AgentTraceSelection;
  onBack(): void;
}

interface ProjectDetailPageProps {
  project: string;
  filters: UsageFilters;
  options: FilterOptions;
  onFiltersChange(filters: UsageFilters): void;
  onBack(): void;
  onViewTrace(selection: AgentTraceSelection): void;
  traceSelection: AgentTraceSelection | null;
  onBackFromTrace(): void;
}
```

- [ ] **Step 1: Write failing tests for the trace subview and in-place navigation**

In `ProjectTraceSubview.test.tsx`, configure `createWindowApi()` to return a collection status and an `AgentTraceSession` containing a `makeAgentTraceSpan()` fixture. Render the subview with `{ source: 'vscode', sessionId: 'vscode:conversation-1' }`. Verify it shows the project context, `AgentTraceTree`, and a button named **Retour au projet**; click the button and verify `onBack` is called.

In `App.test.tsx`, open a project detail with a VS Code conversation and click that row's **Voir la trace** button. Verify all of the following before clicking Back:

```ts
expect(screen.getByRole('button', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
expect(screen.getByRole('button', { name: 'Retour au projet' })).toBeInTheDocument();
expect(screen.queryByRole('heading', { name: 'Traces agents' })).not.toBeInTheDocument();
expect(window.api.getAgentTraceSession).toHaveBeenCalledWith({
  source: 'vscode',
  sessionId: 'vscode:conversation-1',
});
```

Then click **Retour au projet** and verify the same project heading, filter values, summary, and conversation row are visible again. Add a case for a CLI conversation to verify `{ source: 'copilot-cli', sessionId }` is passed unchanged.

In `ProjectDetailPage.test.tsx`, render with a non-null `traceSelection`; verify the subview replaces the project contents, and clicking **Retour au projet** calls `onBackFromTrace`.

- [ ] **Step 2: Run the new tests and verify they fail for the old navigation**

Run: `rtk npm test -- src/renderer/components/ProjectTraceSubview.test.tsx src/renderer/components/ProjectDetailPage.test.tsx src/renderer/App.test.tsx`

Expected: FAIL because the subview component and `traceSelection` props do not exist, and **Voir la trace** currently navigates to the global `agent-traces` tab instead of retaining the `projects` tab and selected project.

- [ ] **Step 3: Implement the focused subview**

Create `ProjectTraceSubview` with the exact interface above. It calls `useAgentTrace(selection)`, displays a **Retour au projet** button, shows loading/error text from the hook/status, and renders `AgentTraceTree` when a session is available. It does not duplicate the global page's opt-in toggle, configuration snippets, or delete controls; those remain in the global **Traces agents** page.

- [ ] **Step 4: Keep App and project state while displaying the subview**

Change `handleViewTrace(selection)` in `App.tsx` so it stores `selectedTrace` without changing `activeTab`, `selectedProject`, or filters. Pass `selectedTrace` and an `onBackFromTrace` callback to `ProjectDetailPage`. In `ProjectDetailPage`, render `ProjectTraceSubview` when `traceSelection` is non-null; otherwise render the existing project details. Back calls only `onBackFromTrace`, which clears `selectedTrace`. When a different project is selected, clear any old trace selection before setting that project.

Keep `useProjectDetail(project, filters)` mounted while switching between the detail and trace subview so returning does not trigger a new project navigation or lose the existing data state. Keep the top-level **Traces agents** tab and its collection/configuration behavior unchanged.

- [ ] **Step 5: Run focused and full tests, then commit**

Run the focused tests:

```powershell
rtk npm test -- src/renderer/components/ProjectTraceSubview.test.tsx src/renderer/components/ProjectDetailPage.test.tsx src/renderer/App.test.tsx
```

Expected: all tests pass for same-project state preservation, both trace sources, Back behavior, and the unchanged global trace tab.

Run: `rtk npm test`

Expected: the complete Vitest suite passes.

Commit:

```powershell
rtk git add -- 'docs\superpowers\plans\2026-09-25-project-trace-detail-view.md' 'src\renderer\components\ProjectTraceSubview.tsx' 'src\renderer\components\ProjectTraceSubview.test.tsx' 'src\renderer\App.tsx' 'src\renderer\App.test.tsx' 'src\renderer\components\ProjectDetailPage.tsx' 'src\renderer\components\ProjectDetailPage.test.tsx'
rtk git commit -m "feat: keep trace drilldown in project detail" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```
