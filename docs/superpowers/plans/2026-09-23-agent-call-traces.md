# Traces d’appels des agents Copilot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collecter localement les traces OTel de Copilot Chat et Copilot CLI, puis afficher les appels LLM, outils, skills, commandes et résultats dans un arbre par conversation.

**Architecture:** Le processus main reçoit OTLP/HTTP sur `127.0.0.1:4318`, décode les spans, conserve uniquement les champs autorisés après expurgation et les écrit dans une base SQLite distincte de la base de consommation. Une page **Traces agents** contrôle l’opt-in et la configuration ; l’action **Voir la trace** d’une conversation ouvre les spans regroupés par source et session, en respectant les relations OTel et l’ordre temporel.

**Tech Stack:** Electron 44, Node 24, TypeScript 7, React 19, Vitest, better-sqlite3, `protobufjs` et `protobufjs-cli`; OTLP/HTTP Protobuf; aucun service distant.

## Global Constraints

- La collecte de contenu est opt-in et l'export reste local.
- Le récepteur OTLP est lié uniquement à l'interface loopback.
- Le stockage utilise une liste autorisée de champs d'outil ; prompts, réponses, messages système, schémas d'outils et attributs inconnus sont exclus.
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

- `src/main/agent-trace-proto\opentelemetry\proto\...` — fichiers `.proto` OpenTelemetry nécessaires au décodage des requêtes OTLP; conserver leurs avis de licence Apache 2.0.
- `src/main/agent-trace-proto.generated.js` et `src/main/agent-trace-proto.generated.d.ts` — module de décodage statique généré, utilisé par le bundle main sans lecture de fichiers `.proto` à l'exécution.
- `src/main/agent-trace-protocol.ts` / `.test.ts` — décodage et normalisation de `ExportTraceServiceRequest`, classification des sources et conversion des IDs/timestamps.
- `src/main/agent-trace-sanitizer.ts` / `.test.ts` — allowlist, masquage, troncature et échec fermé des payloads.
- `src/main/agent-trace-store.ts` / `.test.ts` — base SQLite locale des spans et préférences de collecte, purge TTL, lecture par conversation.
- `src/main/agent-trace-receiver.ts` / `.test.ts` — serveur OTLP/HTTP loopback, limites de requête et réponse Protobuf.
- `src/main/agent-trace-service.ts` / `.test.ts` — cycle de vie collecte/store, opt-in persistant, purge périodique et état d'erreur.
- `src/test-utils/agent-trace-fixtures.ts` — factories typées pour les spans décodés et expurgés utilisés par les tests main et renderer.
- `src/renderer/hooks/useAgentTrace.ts` / `.test.ts` — chargement et état IPC de la page de traces.
- `src/renderer/lib/agent-trace-tree.ts` / `.test.ts` — conversion des spans à plat en tours, racines et nœuds enfants sans parentage inféré.
- `src/renderer/components/AgentTraceTree.tsx` / `.test.tsx` — arbre accessible avec nœuds repliables, statuts, durées et détails expurgés.
- `src/renderer/components/AgentTracesPage.tsx` / `.test.tsx` — opt-in, état du récepteur, instructions de configuration, suppression et trace sélectionnée.

**Modify:**

- `package.json`, `package-lock.json` — dépendances `protobufjs` et `protobufjs-cli`, script de génération du décodeur.
- `src/shared/types.ts`, `src/shared/types.test.ts` — types de source, spans, sélection, session, statut de collecte et champ source de conversation.
- `src/main/db.ts`, `src/main/db.test.ts` — provenance de la conversation calculée depuis son ID préfixé `vscode:`.
- `src/main/ipc-handlers.ts`, `src/main/ipc-handlers.test.ts` — quatre handlers de trace utilisant le wrapper IPC `handle()` déjà présent.
- `src/main.ts` — initialisation du service dans `app.whenReady()` et fermeture asynchrone idempotente avant la sortie.
- `src/preload.ts`, `src/renderer/window.d.ts`, `src/renderer/test-utils/windowApi.ts` — API IPC typée et mocks par défaut.
- `src/renderer/components/Sidebar.tsx`, `.test.tsx` — entrée de navigation **Traces agents**.
- `src/renderer/App.tsx`, `.test.tsx` — routage de l'onglet et conservation de la conversation sélectionnée, y compris lorsque les données de consommation sont indisponibles.
- `src/renderer/components/ProjectDetailPage.tsx`, `.test.tsx` — callback d'ouverture de trace.
- `src/renderer/components/ConversationsTable.tsx`, `.test.tsx` — action **Voir la trace** par ligne et transmission source/session.

---

### Task 1: Définir les contrats et identifier la source d'une conversation

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/types.test.ts`
- Modify: `src/main/db.ts`
- Modify: `src/main/db.test.ts`
- Modify: `src/renderer/components/ConversationsTable.test.tsx`
- Modify: `src/renderer/components/ProjectDetailPage.test.tsx`
- Modify: `src/renderer/App.test.tsx`

**Interfaces:**
- Consumes: le `sessionId` déjà fourni par `ConversationSummary`.
- Produces: `AgentTraceSource`, `AgentTraceSelection`, `AgentTraceSpan`, `AgentTraceSession`, `AgentTraceCollectionStatus` et `ConversationSummary.source`.

- [ ] **Step 1: Écrire le test de provenance des conversations**

Dans `db.test.ts`, créer une base temporaire avec les deux tables minimales consommées par `getProjectDetail`. Insérer `cli-session-1` au 1 septembre et `vscode:vscode-session-1` au 2 septembre, toutes deux avec `repository = 'org/repo-a'`, puis insérer un événement d'usage lié à chacune. Vérifier la provenance et les IDs retournés :

```ts
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, summary TEXT, created_at TEXT
  );
  CREATE TABLE assistant_usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL, model TEXT NOT NULL, total_nano_aiu INTEGER,
    input_tokens INTEGER, output_tokens INTEGER, created_at TEXT
  );
  INSERT INTO sessions VALUES
    ('cli-session-1', 'C:/repo', 'org/repo-a', 'CLI', '2026-09-01 10:00:00'),
    ('vscode:vscode-session-1', 'C:/repo', 'org/repo-a', 'VS Code', '2026-09-02 10:00:00');
  INSERT INTO assistant_usage_events
    (session_id, model, total_nano_aiu, input_tokens, output_tokens, created_at)
    VALUES ('cli-session-1', 'gpt-5.4', 1000000000, 5, 5, '2026-09-01 10:00:00'),
           ('vscode:vscode-session-1', 'gpt-5.4', 1000000000, 5, 5, '2026-09-02 10:00:00');
`);

const result = getProjectDetail(db, { project: 'org/repo-a' });

expect(result.conversations.map(({ sessionId, source }) => ({ sessionId, source }))).toEqual([
  { sessionId: 'vscode:vscode-session-1', source: 'vscode' },
  { sessionId: 'cli-session-1', source: 'copilot-cli' },
]);
```

Fermer la base temporaire dans `afterEach(() => db.close())`.

Ajouter aussi les types sans valeurs `any` :

```ts
export type AgentTraceSource = 'vscode' | 'copilot-cli';
export type AgentTraceCategory = 'agent' | 'llm' | 'tool' | 'skill' | 'shell' | 'hook' | 'other';
export type AgentTraceContentState =
  | 'unavailable'
  | 'stored'
  | 'redacted'
  | 'truncated'
  | 'redacted-truncated'
  | 'omitted';

export interface AgentTraceSelection {
  source: AgentTraceSource;
  sessionId: string;
}

export interface AgentTraceSpan {
  source: AgentTraceSource;
  sessionId: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  category: AgentTraceCategory;
  toolName: string | null;
  skillName: string | null;
  model: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: 'unset' | 'ok' | 'error';
  errorType: string | null;
  toolCallId: string | null;
  argumentsJson: string | null;
  resultText: string | null;
  contentState: AgentTraceContentState;
}

export interface AgentTraceSession {
  source: AgentTraceSource;
  sessionId: string;
  availability: 'available' | 'partial' | 'not-collected';
  spans: AgentTraceSpan[];
}

export interface AgentTraceCollectionStatus {
  enabled: boolean;
  listening: boolean;
  endpoint: string | null;
  errorMessage: string | null;
}
```

Add `source: AgentTraceSource` to `ConversationSummary`. Update its `satisfies` fixture and the existing conversation fixtures in the three renderer tests listed above so the type contract stays accurate.

- [ ] **Step 2: Exécuter le test DB ciblé**

Run: `rtk npm test -- src/main/db.test.ts src/shared/types.test.ts`

Expected: FAIL because `getProjectDetail` does not yet return `source` and the shared type does not yet define trace contracts.

- [ ] **Step 3: Ajouter le champ source dans la requête de détail projet**

Dans `getProjectDetail`, ajouter la provenance à la seule requête qui construit `ConversationSummary` :

```sql
CASE
  WHEN s.id LIKE 'vscode:%' THEN 'vscode'
  ELSE 'copilot-cli'
END AS source
```

Ne pas modifier la table `sessions`, `buildMergedDatabase` ni les requêtes de consommation. Ajouter un test `src/shared/types.test.ts` qui vérifie les valeurs autorisées `vscode` et `copilot-cli`.

- [ ] **Step 4: Vérifier les tests et committer**

Run: `rtk npm test -- src/main/db.test.ts src/shared/types.test.ts src/renderer/components/ConversationsTable.test.tsx src/renderer/components/ProjectDetailPage.test.tsx src/renderer/App.test.tsx`

Expected: PASS, les conversations gardent leurs totaux et exposent une source déterministe.

Commit:

```powershell
rtk git add -- 'src\shared\types.ts' 'src\shared\types.test.ts' 'src\main\db.ts' 'src\main\db.test.ts' 'src\renderer\components\ConversationsTable.test.tsx' 'src\renderer\components\ProjectDetailPage.test.tsx' 'src\renderer\App.test.tsx'
rtk git commit -m "feat: identify source on conversation rows" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Décoder les requêtes OTel/Protobuf

**Files:**
- Create: `src/main/agent-trace-proto\opentelemetry\proto\collector\trace\v1\trace_service.proto`
- Create: `src/main/agent-trace-proto\opentelemetry\proto\trace\v1\trace.proto`
- Create: `src/main/agent-trace-proto\opentelemetry\proto\resource\v1\resource.proto`
- Create: `src/main/agent-trace-proto\opentelemetry\proto\common\v1\common.proto`
- Create: `src/main/agent-trace-proto.generated.js`
- Create: `src/main/agent-trace-proto.generated.d.ts`
- Create: `src/main/agent-trace-protocol.ts`
- Create: `src/main/agent-trace-protocol.test.ts`
- Create: `src/test-utils/agent-trace-fixtures.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: les contrats `AgentTraceSource` et `AgentTraceCategory` de Task 1.
- Produces:

```ts
export interface DecodedAgentTraceSpan {
  source: AgentTraceSource | null;
  conversationId: string | null;
  sessionId: string | null;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  category: AgentTraceCategory;
  toolName: string | null;
  skillName: string | null;
  model: string | null;
  startedAtNs: string;
  endedAtNs: string;
  status: 'unset' | 'ok' | 'error';
  errorType: string | null;
  toolCallId: string | null;
  argumentsValue: unknown;
  result: unknown;
}

export function decodeOtlpTraceRequest(body: Uint8Array): DecodedAgentTraceSpan[];
```

- [ ] **Step 1: Ajouter le décodeur Protobuf et les schémas OTel versionnés**

Ajouter les dépendances sans retirer aucun script d'installation existant :

```powershell
rtk npm install --save --ignore-scripts protobufjs
rtk npm install --save-dev --ignore-scripts protobufjs-cli
```

Copier les quatre schémas de trace depuis `open-telemetry/opentelemetry-proto` en vérifiant ces blob SHAs : `trace_service.proto` `efbbedbe4545a6f809e8cdbd699379cbc16e1a1f`, `trace.proto` `235b54e8e78b55f0bb4f3f1f43fc89bdda28b04c`, `resource.proto` `118bfed175d5b673391c40fb84923249bd43c429` et `common.proto` `85bd3f2c00ac9a6fe8f9c8d63412870aaee17995`. Conserver les en-têtes Apache 2.0.

Ajouter le script reproductible suivant à `package.json` :

```json
{
  "scripts": {
    "generate:agent-trace-proto": "pbjs -t static-module -w es6 -p src/main/agent-trace-proto -o src/main/agent-trace-proto.generated.js src/main/agent-trace-proto/opentelemetry/proto/collector/trace/v1/trace_service.proto && pbts -o src/main/agent-trace-proto.generated.d.ts src/main/agent-trace-proto.generated.js"
  }
}
```

Exécuter `rtk npm run generate:agent-trace-proto` et conserver les sorties générées dans le dépôt.

Les `.proto` restent des sources de génération ; le binaire de l'application importe le module statique compilé et ne lit aucun schéma depuis le système de fichiers au runtime.

Avant l'implémentation du receiver, effectuer le petit test de faisabilité prévu par le design dans des profils/projets temporaires sans secrets : vérifier sur une trace VS Code et une trace Copilot CLI que le client expose l'ID de conversation, `chat`, `execute_tool`, les IDs parent/span et, avec capture opt-in, arguments/résultats. Les fichiers d'export temporaires utilisés pour cette vérification sont supprimés juste après. Si un client manque un champ nécessaire, arrêter avant la livraison et compléter le plan avec l'adaptateur hook autorisé par le design ; ne pas annoncer cette source comme complète.

- [ ] **Step 2: Écrire les tests du décodeur avant son implémentation**

Importer `protobuf` depuis `protobufjs` et `path` depuis `node:path`. Définir `OTLP_FIXTURE` avec une ressource `copilot-chat`, un span racine `invoke_agent`, un span `chat`, un outil enfant, un appel de skill et un outil non-parenté du même trace. La fixture ajoute `service.name`, `gen_ai.conversation.id`, `gen_ai.tool.name`, `gen_ai.tool.call.id`, `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result`, `github.copilot.tool.parameters.skill_name`, `gen_ai.input.messages` et un timestamp fixe en nanosecondes. Charger le schéma racine `trace_service.proto` en remappant ses imports vers le dossier `src/main/agent-trace-proto`, puis encoder le corps et vérifier l'extraction des IDs, attributs et hiérarchie sans copier `gen_ai.input.messages` dans le résultat :

```ts
const traceId = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const rootSpanId = Buffer.from('1111222233334444', 'hex');
const chatSpanId = Buffer.from('2222333344445555', 'hex');
const toolSpanId = Buffer.from('5555666677778888', 'hex');
const unlinkedSpanId = Buffer.from('6666777788889999', 'hex');
const skillSpanId = Buffer.from('777788889999aaaa', 'hex');
const start = '1780000000000000000';
const end = '1780000000100000000';
const OTLP_FIXTURE = {
  resourceSpans: [{
    resource: {
      attributes: [{ key: 'service.name', value: { stringValue: 'copilot-chat' } }],
    },
    scopeSpans: [{
      spans: [
        {
          traceId,
          spanId: rootSpanId,
          name: 'invoke_agent copilot',
          startTimeUnixNano: start,
          endTimeUnixNano: end,
          attributes: [
            { key: 'gen_ai.agent.name', value: { stringValue: 'copilot' } },
            { key: 'gen_ai.conversation.id', value: { stringValue: 'conversation-1' } },
            { key: 'gen_ai.input.messages', value: { stringValue: 'synthetic prompt' } },
          ],
          status: { code: 1 },
        },
        {
          traceId,
          spanId: chatSpanId,
          parentSpanId: rootSpanId,
          name: 'chat gpt-5.4',
          startTimeUnixNano: start,
          endTimeUnixNano: end,
          attributes: [{ key: 'gen_ai.request.model', value: { stringValue: 'gpt-5.4' } }],
        },
        {
          traceId,
          spanId: toolSpanId,
          parentSpanId: chatSpanId,
          name: 'execute_tool runCommand',
          startTimeUnixNano: start,
          endTimeUnixNano: end,
          attributes: [
            { key: 'gen_ai.tool.name', value: { stringValue: 'runCommand' } },
            { key: 'gen_ai.tool.call.id', value: { stringValue: 'call-1' } },
            { key: 'gen_ai.tool.call.arguments', value: { stringValue: '{"command":"echo trace-probe"}' } },
            { key: 'gen_ai.tool.call.result', value: { stringValue: 'trace-probe' } },
          ],
          status: { code: 1 },
        },
        {
          traceId,
          spanId: unlinkedSpanId,
          name: 'execute_tool unlinkedProbe',
          startTimeUnixNano: start,
          endTimeUnixNano: end,
          attributes: [{ key: 'gen_ai.tool.name', value: { stringValue: 'unlinkedProbe' } }],
          status: { code: 1 },
        },
        {
          traceId,
          spanId: skillSpanId,
          parentSpanId: rootSpanId,
          name: 'execute_tool loadSkill',
          startTimeUnixNano: start,
          endTimeUnixNano: end,
          attributes: [
            { key: 'gen_ai.tool.name', value: { stringValue: 'loadSkill' } },
            { key: 'gen_ai.tool.call.id', value: { stringValue: 'call-skill' } },
            { key: 'github.copilot.tool.parameters.skill_name', value: { stringValue: 'trace-probe' } },
          ],
          status: { code: 1 },
        },
      ],
    }],
  }],
};

const protoRoot = path.resolve(process.cwd(), 'src', 'main', 'agent-trace-proto');
const root = new protobuf.Root();
root.resolvePath = (_origin, target) => path.resolve(protoRoot, target);
root.loadSync(path.join(
  protoRoot,
  'opentelemetry',
  'proto',
  'collector',
  'trace',
  'v1',
  'trace_service.proto',
));
const requestType = root.lookupType(
  'opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest',
);
const payload = requestType.encode(requestType.fromObject(OTLP_FIXTURE)).finish();
const decoded = decodeOtlpTraceRequest(payload);

expect(decoded).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      traceId: '00112233445566778899aabbccddeeff',
      spanId: '1111222233334444',
      parentSpanId: null,
      name: 'invoke_agent copilot',
      source: 'vscode',
      conversationId: 'conversation-1',
      sessionId: 'vscode:conversation-1',
    }),
    expect.objectContaining({
      spanId: '5555666677778888',
      parentSpanId: '2222333344445555',
      name: 'execute_tool runCommand',
      toolCallId: 'call-1',
    }),
    expect.objectContaining({
      spanId: '777788889999aaaa',
      category: 'skill',
      skillName: 'trace-probe',
      toolCallId: 'call-skill',
    }),
  ]),
);
expect(decoded).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      spanId: '6666777788889999',
      source: 'vscode',
      sessionId: 'vscode:conversation-1',
      parentSpanId: null,
    }),
  ]),
);
expect(JSON.stringify(decoded)).not.toContain('synthetic prompt');
```

Ajouter un quatrième span `execute_tool` partageant le `traceId` mais sans `parentSpanId` ni `gen_ai.conversation.id` local ; vérifier qu'il reçoit la source/session de la racine tout en gardant `parentSpanId: null`. Ajouter aussi un cas timestamp dont la valeur en nanosecondes dépasse `Number.MAX_SAFE_INTEGER`, et des cas pour un corps Protobuf invalide, un ID de trace/span de taille invalide et une source non prise en charge.


- [ ] **Step 3: Créer les factories de spans synthétiques**

Créer `src/test-utils/agent-trace-fixtures.ts` avec `makeAgentTraceSpan(overrides)` et `makeDecodedAgentTraceSpan(overrides)`. Chaque factory retourne tous les champs obligatoires des interfaces Task 1 et Task 2, puis applique les overrides avec une fusion superficielle. Les valeurs par défaut sont les IDs `00112233445566778899aabbccddeeff` et `1111222233334444`, la session `vscode:conversation-1`, des timestamps fixes et des contenus inoffensifs.

- [ ] **Step 4: Vérifier l'échec attendu**

Run: `rtk npm test -- src/main/agent-trace-protocol.test.ts`

Expected: FAIL parce que `decodeOtlpTraceRequest` n'existe pas.

- [ ] **Step 5: Implémenter le décodage et la normalisation pure**

Utiliser le type généré `ExportTraceServiceRequest` pour décoder le `Uint8Array`. Parcourir `resource_spans`, `scope_spans` et `spans`; convertir les IDs binaires en hexadécimal minuscule; décoder les attributs `AnyValue` sans `any`; garder `start_time_unix_nano` et `end_time_unix_nano` en chaînes jusque-là.

Convertir les nanosecondes avec `BigInt(value) / 1_000_000n` avant de créer un `Date`, puis calculer la durée avec `BigInt` pour éviter les pertes de précision. Grouper les spans du même `trace_id` avant d'affecter source/session : `service.name === 'copilot-chat'` classe la racine comme VS Code et `service.name === 'github-copilot'` comme Copilot CLI. Lire `gen_ai.conversation.id` depuis la racine et appliquer l'ID de l'application avec le préfixe `vscode:` pour VS Code seulement. Propager source/session à tout span du même `trace_id`, mais conserver le `parentSpanId` exactement comme fourni ; l'association à la conversation n'invente pas une relation parent-enfant. Un span non racine sans parent restera une racine non reliée marquée `partial` dans la vue. Si source ou conversation ne peut pas être déterminée, retourner `null` pour le champ manquant afin que le receiver puisse rejeter ces spans avec un résultat partiel explicite.

Pour chaque Resource/Span, parcourir la liste `KeyValue` puis décoder `AnyValue` uniquement pour les clés autorisées ci-dessous ; ignorer avant conversion tous les messages prompt/réponse, instructions système, schémas et attributs inconnus :

```ts
const RESOURCE_ATTRIBUTE_ALLOWLIST = new Set(['service.name']);
const SPAN_ATTRIBUTE_ALLOWLIST = new Set([
  'gen_ai.agent.name',
  'gen_ai.conversation.id',
  'gen_ai.operation.name',
  'gen_ai.request.model',
  'gen_ai.response.model',
  'gen_ai.tool.name',
  'gen_ai.tool.call.id',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
  'gen_ai.error.type',
  'github.copilot.agent.type',
  'github.copilot.tool.parameters.command',
  'github.copilot.tool.parameters.file_path',
  'github.copilot.tool.parameters.skill_name',
]);
```

Classer `invoke_agent` en agent, `chat` en appel LLM, `execute_hook` en hook et `execute_tool` en outil ; si `github.copilot.tool.parameters.skill_name` est présent, classer le nœud en skill, sinon si `github.copilot.tool.parameters.command` est présent, le classer en shell. Lire seulement les clés de l'allowlist lorsqu'elles sont présentes. Une relation introuvable ou une source inconnue reste absente/partielle ; ne jamais en déduire une à partir des heures.

- [ ] **Step 6: Valider le format et committer**

Run: `rtk npm test -- src/main/agent-trace-protocol.test.ts`

Expected: PASS pour la requête binaire valide, les IDs et dates exacts, les spans provenant de plusieurs `ResourceSpans`, les sources mixées d'une même trace et les erreurs de décodage.

Commit:

```powershell
rtk git add -- 'package.json' 'package-lock.json' 'src\main\agent-trace-proto' 'src\main\agent-trace-proto.generated.js' 'src\main\agent-trace-proto.generated.d.ts' 'src\main\agent-trace-protocol.ts' 'src\main\agent-trace-protocol.test.ts' 'src\test-utils\agent-trace-fixtures.ts'
rtk git commit -m "feat: decode Copilot OpenTelemetry spans" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Expurger les contenus avant stockage

**Files:**
- Create: `src/main/agent-trace-sanitizer.ts`
- Create: `src/main/agent-trace-sanitizer.test.ts`

**Interfaces:**
- Consumes: `DecodedAgentTraceSpan` de Task 2.
- Produces: `sanitizeAgentTraceSpan(span: DecodedAgentTraceSpan): AgentTraceSpan | null`; seul le résultat non-null de cette fonction peut être passé au store. Le résultat est `null` si la source ou la session ne peut pas être reliée à une conversation.

- [ ] **Step 1: Ajouter des tests de masquage, de conservation des clés d'outil et d'échec fermé**

Les tests utilisent uniquement des valeurs synthétiques. Couvrir au minimum GitHub tokens (`gh[pousr]_...`, `github_pat_...`), IDs de clés AWS (`AKIA...`, `ASIA...`), `Bearer`, blocs PEM privés et valeurs dont le nom de clé contient `token`, `secret`, `password`, `api_key` ou `authorization`.

```ts
const safe = sanitizeAgentTraceSpan(makeDecodedAgentTraceSpan({
  argumentsValue: { command: 'echo ghp_TEST_TOKEN_1234567890' },
  result: 'Authorization: Bearer TEST_SECRET_VALUE',
}));

if (!safe) throw new Error('The fixture must contain a supported source and conversation ID');
expect(safe.argumentsJson).toContain('[REDACTED]');
expect(safe.resultText).toContain('[REDACTED]');
expect(JSON.stringify(safe)).not.toContain('TEST_TOKEN_1234567890');
expect(safe.resultText).not.toContain('******');
expect(safe.contentState).toBe('redacted');

const bearerResult = sanitizeAgentTraceSpan(makeDecodedAgentTraceSpan({
  result: 'Authorization: Bearer TEST_SECRET_VALUE',
}));
if (!bearerResult) throw new Error('The fixture must contain a supported source and conversation ID');
expect(bearerResult.resultText).toContain('[REDACTED]');
expect(bearerResult.resultText).not.toContain('TEST_SECRET_VALUE');
```

`makeDecodedAgentTraceSpan` est la factory créée dans `src/test-utils/agent-trace-fixtures.ts`; elle renseigne source, conversation, IDs, catégorie, timestamps, statut et valeurs vides par défaut. Les overrides du test ne contiennent que les arguments et résultats synthétiques.

Tester également l'UTF-8 multi-octet jusqu'à 32 KiB après masquage, la troncature visible, une valeur binaire ou illisible qui omet le contenu et conserve les métadonnées, la conservation d'une clé d'outil synthétique non sensible, et le filtrage des messages, schémas et attributs non autorisés.

- [ ] **Step 2: Vérifier l'échec des tests de sécurité**

Run: `rtk npm test -- src/main/agent-trace-sanitizer.test.ts`

Expected: FAIL parce que le sanitizer n'existe pas.

- [ ] **Step 3: Implémenter les règles de sécurité**

Créer une fonction pure qui conserve les clés d'outil dynamiques à l'intérieur des objets d'arguments/résultats autorisés, mais qui exclut explicitement les champs `prompt`, `response`, `system`, `message`, `messages`, `schema` et `attributes` ainsi que les attributs OTLP non requis. Expurger les motifs de secrets avant de calculer `Buffer.byteLength`; couper chaque valeur qui dépasse 32 KiB UTF-8 et marquer `contentState` `truncated` ou `redacted-truncated`. Si un type n'est pas sérialisable, si le parsing échoue ou si le sanitizer lève une erreur, retourner les métadonnées avec `argumentsJson: null`, `resultText: null` et `contentState: 'omitted'`.

Ne jamais joindre la valeur source dans une exception ou dans un message de log.

- [ ] **Step 4: Rejouer les tests et committer**

Run: `rtk npm test -- src/main/agent-trace-sanitizer.test.ts`

Expected: PASS pour tous les motifs de secret, les limites de taille, les valeurs Unicode, les champs absents et l'échec fermé.

Commit:

```powershell
rtk git add -- 'src\main\agent-trace-sanitizer.ts' 'src\main\agent-trace-sanitizer.test.ts'
rtk git commit -m "feat: redact agent trace payloads" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Persister les spans expurgés et appliquer la rétention

**Files:**
- Create: `src/main/agent-trace-store.ts`
- Create: `src/main/agent-trace-store.test.ts`

**Interfaces:**
- Consumes: `AgentTraceSpan` et `AgentTraceSelection` de Task 1; seuls des spans expurgés de Task 3.
- Produces: `openAgentTraceStore(path): AgentTraceStore` avec `insertSpans`, `getSession`, `getCollectionEnabled`, `setCollectionEnabled`, `pruneExpired`, `clear` et `close`.

- [ ] **Step 1: Écrire des tests SQLite isolés**

Créer `const store = openAgentTraceStore(':memory:')` dans le setup du test. Vérifier l'insertion de deux spans pour une session, la récupération ordonnée, le statut `not-collected` pour une sélection sans span, et l'idempotence après réception répétée du même `(source, traceId, spanId)`.

```ts
const rootSpan = makeAgentTraceSpan({ spanId: 'root-span', category: 'agent' });
const toolSpan = makeAgentTraceSpan({
  spanId: 'tool-span',
  parentSpanId: 'root-span',
  name: 'execute_tool runCommand',
  category: 'shell',
});

store.insertSpans([rootSpan, toolSpan, rootSpan]);

const session = store.getSession({ source: 'vscode', sessionId: 'vscode:conversation-1' });

expect(session.availability).toBe('available');
expect(session.spans).toHaveLength(2);
expect(session.spans.map((span) => span.spanId)).toEqual(['root-span', 'tool-span']);
```

Ajouter un test avec horloge fixe : un span reçu il y a 31 jours est supprimé, un span reçu il y a 29 jours est conservé. Tester la préférence de collecte désactivée par défaut, sa persistance après réouverture et `clear()` qui supprime les spans sans réinitialiser les logs applicatifs.

- [ ] **Step 2: Vérifier l'échec initial**

Run: `rtk npm test -- src/main/agent-trace-store.test.ts`

Expected: FAIL parce que le store n'existe pas.

- [ ] **Step 3: Créer une base locale indépendante**

Créer le dossier du store avec `fs.mkdirSync(path.dirname(dbPath), { recursive: true })`, ouvrir `better-sqlite3` sur le chemin fourni par l'appelant et créer uniquement :

```sql
CREATE TABLE IF NOT EXISTS agent_trace_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_trace_spans (
  source TEXT NOT NULL,
  session_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  started_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  span_json TEXT NOT NULL,
  PRIMARY KEY (source, trace_id, span_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_trace_session
  ON agent_trace_spans (source, session_id, started_at);
```

`span_json` contient uniquement le `AgentTraceSpan` déjà expurgé. Écrire les spans en transaction, préserver l'unicité composite et interdire toute connexion en écriture à la base Copilot CLI.

- [ ] **Step 4: Ajouter lecture, réglage de collecte et purge**

`getSession` doit regrouper toutes les racines `trace_id` d'une même paire source/session, trier les spans par début, retourner `not-collected` avec une liste vide en l'absence de données, et signaler `partial` quand une référence parent est absente, qu'un span non-agent n'a pas de parent, qu'un span est incomplet ou qu'un appel d'outil n'a pas les payloads demandés. Un tool span dont le `traceId` est connu mais le parent absent reste dans la session sous forme de racine non reliée ; ne pas inventer de parent. `pruneExpired(now)` supprime les lignes dont `received_at` précède `now - 30 jours`; appeler cette fonction au démarrage et à chaque lecture. Le timer périodique de 24 heures est démarré et arrêté par le service de Task 6, pas par le store. `clear()` supprime seulement `agent_trace_spans`.

- [ ] **Step 5: Rejouer les tests et committer**

Run: `rtk npm test -- src/main/agent-trace-store.test.ts`

Expected: PASS pour persistance, identifiants dupliqués, regroupement multi-trace, état vide, préférence opt-in, purge TTL et suppression manuelle.

Commit:

```powershell
rtk git add -- 'src\main\agent-trace-store.ts' 'src\main\agent-trace-store.test.ts'
rtk git commit -m "feat: persist sanitized agent traces locally" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Recevoir OTLP uniquement sur loopback

**Files:**
- Create: `src/main/agent-trace-receiver.ts`
- Create: `src/main/agent-trace-receiver.test.ts`

**Interfaces:**
- Consumes: `decodeOtlpTraceRequest`, `sanitizeAgentTraceSpan` et `AgentTraceStore`.
- Produces: `startAgentTraceReceiver({ store, port? }): Promise<{ endpoint: string; close(): Promise<void> }>`; en production le bind est toujours `127.0.0.1:4318`, tandis que les tests peuvent injecter `port: 0`.

- [ ] **Step 1: Écrire les tests HTTP sur un port de test**

Démarrer le store de test avec `openAgentTraceStore(':memory:')`, activer explicitement `store.setCollectionEnabled(true)` pour refléter le fait que le service de Task 6 est l’unique porte opt-in qui démarre/arrête le receiver, encoder un `payload` à partir de la fixture `OTLP_FIXTURE` de Task 2, puis démarrer le serveur sur un port éphémère et envoyer un `POST /v1/traces` :

```ts
const receiver = await startAgentTraceReceiver({ store, port: 0 });
const response = await fetch(`${receiver.endpoint}/v1/traces`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-protobuf' },
  body: payload,
});

expect(response.status).toBe(200);
expect(store.getSession({ source: 'vscode', sessionId: 'vscode:conversation-1' }).spans)
  .toHaveLength(2);
```

Couvrir aussi méthode incorrecte (`405`), chemin incorrect (`404`), type de contenu incorrect (`415`), corps Protobuf mal formé (`400`), corps de plus de 8 MiB (`413`), port déjà occupé, et fermeture du serveur.

- [ ] **Step 2: Vérifier l'échec initial**

Run: `rtk npm test -- src/main/agent-trace-receiver.test.ts`

Expected: FAIL parce que le récepteur n'existe pas.

- [ ] **Step 3: Implémenter le serveur OTLP/HTTP**

Utiliser `node:http`. N'écouter que sur `127.0.0.1`; l'adresse et le port ne viennent jamais d'une URL renderer. N'accepter que `POST /v1/traces` en `application/x-protobuf`, avec un corps borné à 8 MiB. Le receiver ne relit jamais la préférence opt-in persistée : il suppose que Task 6 l’a démarré uniquement pendant l’opt-in explicite. Décoder le batch, propager un état typé de résolution de source (`supported` / `unsupported` / `missing`) depuis la racine de trace sélectionnée, sanitizer chaque span accepté et écrire le lot expurgé dans une transaction. Les spans d’une source non supportée et les spans sans source/session déterminée ne sont pas stockés ; les compter dans `ExportTraceServiceResponse.partial_success.rejected_spans` avec des raisons génériques distinctes, sans jamais conserver ou journaliser le nom brut d’un service inconnu. Répondre `200` avec un `ExportTraceServiceResponse` vide lorsque tous les spans sont acceptés.

Refuser les requêtes non prises en charge avec un statut HTTP explicite. Les erreurs de décodage/stockage sont journalisées avec route, statut et contexte seulement ; aucune valeur de payload n'est enregistrée. `close()` doit être idempotent et attendre la fermeture de la socket.

- [ ] **Step 4: Exécuter les tests de réception et committer**

Run: `rtk npm test -- src/main/agent-trace-receiver.test.ts`

Expected: PASS pour le POST valide, les erreurs de protocole, la limite de taille, le bind loopback, le conflit de port et l'arrêt.

Commit:

```powershell
rtk git add -- 'src\main\agent-trace-receiver.ts' 'src\main\agent-trace-receiver.test.ts'
rtk git commit -m "feat: receive OTLP spans on loopback" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 6: Gérer l'opt-in, le cycle de vie main et les canaux IPC

**Files:**
- Create: `src/main/agent-trace-service.ts`
- Create: `src/main/agent-trace-service.test.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/main/ipc-handlers.test.ts`
- Modify: `src/main.ts`
- Modify: `src/preload.ts`
- Modify: `src/renderer/window.d.ts`
- Modify: `src/renderer/test-utils/windowApi.ts`

**Interfaces:**
- Consumes: `AgentTraceStore` et `startAgentTraceReceiver` des Tasks 4–5.
- Produces:

```ts
export interface AgentTraceServiceDependencies {
  storeFactory(path: string): AgentTraceStore;
  receiverFactory: typeof startAgentTraceReceiver;
}

class AgentTraceService {
  initialize(): Promise<void>;
  getStatus(): AgentTraceCollectionStatus;
  setEnabled(enabled: boolean): Promise<AgentTraceCollectionStatus>;
  getSession(selection: AgentTraceSelection): AgentTraceSession;
  clear(): void;
  shutdown(): Promise<void>;
}

export function createAgentTraceService(
  userDataPath: string,
  dependencies?: Partial<AgentTraceServiceDependencies>,
): AgentTraceService;

function registerAgentTraceIpcHandlers(service: AgentTraceService): void;
```

- [ ] **Step 1: Tester le cycle de vie du service**

Injecter des factories de store/récepteur dans `AgentTraceService`. Vérifier que l'état par défaut est désactivé et aucun serveur ne démarre ; `setEnabled(true)` démarre le serveur puis persiste le réglage ; l'échec de `listen()` laisse la collecte désactivée et donne un état d'erreur explicite ; `setEnabled(false)` ferme le serveur ; `shutdown()` arrête le timer de purge et est idempotent.

- [ ] **Step 2: Vérifier l'échec des tests du service**

Run: `rtk npm test -- src/main/agent-trace-service.test.ts`

Expected: FAIL parce que `AgentTraceService` n'existe pas.

- [ ] **Step 3: Implémenter le service**

Initialiser le store avec `app.getPath('userData')` fourni par `main.ts`; purger les entrées expirées au démarrage et toutes les 24 heures pendant l'exécution via un timer possédé par `AgentTraceService` et arrêté dans `shutdown()`. `AgentTraceService` est l’unique porte opt-in : si le réglage opt-in persistant est activé, il démarre le récepteur de Task 5, et `setEnabled(false)`/`shutdown()` l’arrêtent. Le receiver de Task 5 ne revérifie pas cette préférence. Si son bind échoue, conserver la collecte désactivée, exposer `errorMessage` sans données brutes et journaliser l'erreur. Si des spans sont rejetés pour source non supportée ou faute de source/session, conserver un état de couverture partielle visible dans `errorMessage`, sans convertir les spans rejetés en session. Au prochain export intégralement accepté et stocké, le receiver doit notifier le service avec `null` pour effacer uniquement ce message de couverture partielle ; ne jamais émettre ce signal pour une requête malformée, un échec de stockage, une route/méthode/content-type non supporté, ou un dépassement de limite de corps, et ne jamais masquer une erreur de cycle de vie indépendante.

`setEnabled(true)` doit démarrer le récepteur avant d'écrire la préférence ; en cas d'échec, la préférence reste `false`. `setEnabled(false)` ferme le serveur puis enregistre `false`. `getSession` retourne explicitement `not-collected` plutôt qu'une session complète vide. `clear()` retire uniquement les spans.

- [ ] **Step 4: Ajouter les handlers IPC au wrapper existant**

Ajouter dans `ipc-handlers.ts` les canaux :

```ts
export function registerAgentTraceIpcHandlers(traceService: AgentTraceService): void {
  handle('get-agent-trace-collection-status', () => traceService.getStatus());
  handle('set-agent-trace-collection-enabled', (_event: unknown, enabled: boolean) =>
    traceService.setEnabled(enabled));
  handle('get-agent-trace-session', (_event: unknown, selection: AgentTraceSelection) =>
    traceService.getSession(selection));
  handle('clear-agent-trace-data', () => traceService.clear());
}
```

Exporter `registerAgentTraceIpcHandlers` depuis `ipc-handlers.ts`, après le wrapper privé `handle()`, afin de réutiliser le journal des erreurs/durées. Appeler cette fonction après la tentative d'enregistrement des handlers de consommation, y compris si la base de consommation est indisponible. Valider `enabled` et les champs de `selection` dans le processus main avant l'appel du service.

- [ ] **Step 5: Brancher le service au démarrage et à l'arrêt Electron**

Dans `main.ts`, appeler `createAgentTraceService(app.getPath('userData'))` et enregistrer les handlers de trace indépendamment du `registerIpcHandlers` de consommation. Une erreur d'initialisation du store ou du récepteur doit être journalisée et affichée par l'état de trace sans empêcher `createWindow()` ou le tableau de bord.

Ajouter une fermeture idempotente sur `before-quit` : empêcher une seule fois la sortie, attendre `service.shutdown()` (récepteur puis store), journaliser une erreur de fermeture et reprendre `app.quit()` sans boucle.

- [ ] **Step 6: Exposer l'API TypeScript**

Dans `preload.ts` et `window.d.ts`, exposer exactement :

```ts
getAgentTraceCollectionStatus(): Promise<AgentTraceCollectionStatus>;
setAgentTraceCollectionEnabled(enabled: boolean): Promise<AgentTraceCollectionStatus>;
getAgentTraceSession(selection: AgentTraceSelection): Promise<AgentTraceSession>;
clearAgentTraceData(): Promise<void>;
```

Dans `createWindowApi`, fournir des valeurs initiales déterministes : statut `{ enabled: false, listening: false, endpoint: null, errorMessage: null }`, session `not-collected`, activation désactivée et suppression résolue.

Ajouter les tests de handlers : status, opt-in, lecture session, suppression et rejet IPC avec log `ipc` si le service échoue. Vérifier que les canaux de consommation existants restent inchangés.

- [ ] **Step 7: Exécuter les tests main et committer**

Run: `rtk npm test -- src/main/agent-trace-service.test.ts src/main/ipc-handlers.test.ts`

Expected: PASS pour initialisation désactivée, démarrage/arrêt, erreur explicite, purge timer, handlers IPC et disponibilité indépendante de la base d'usage.

Commit:

```powershell
rtk git add -- 'src\main\agent-trace-service.ts' 'src\main\agent-trace-service.test.ts' 'src\main\ipc-handlers.ts' 'src\main\ipc-handlers.test.ts' 'src\main.ts' 'src\preload.ts' 'src\renderer\window.d.ts' 'src\renderer\test-utils\windowApi.ts'
rtk git commit -m "feat: manage local agent trace collection" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 7: Construire et afficher l'arbre de spans

**Files:**
- Create: `src/renderer/lib/agent-trace-tree.ts`
- Create: `src/renderer/lib/agent-trace-tree.test.ts`
- Create: `src/renderer/hooks/useAgentTrace.ts`
- Create: `src/renderer/hooks/useAgentTrace.test.ts`
- Create: `src/renderer/components/AgentTraceTree.tsx`
- Create: `src/renderer/components/AgentTraceTree.test.tsx`

**Interfaces:**
- Consumes: `AgentTraceSelection`, `AgentTraceSession`, `AgentTraceSpan` et les méthodes `Window['api']` de Task 6.
- Produces:

```ts
export interface AgentTraceNode {
  span: AgentTraceSpan;
  children: AgentTraceNode[];
  unparented: boolean;
}

export interface AgentTraceTurn {
  traceId: string;
  roots: AgentTraceNode[];
}

export function buildAgentTraceTree(spans: AgentTraceSpan[]): AgentTraceTurn[];

export interface UseAgentTraceResult {
  collectionStatus: AgentTraceCollectionStatus | null;
  session: AgentTraceSession | null;
  statusLoading: boolean;
  sessionLoading: boolean;
  error: Error | null;
  setCollectionEnabled(enabled: boolean): Promise<void>;
  clearTraceData(): Promise<void>;
}

export function useAgentTrace(selection: AgentTraceSelection | null): UseAgentTraceResult;
export interface AgentTraceTreeProps {
  session: AgentTraceSession;
}
```

- [ ] **Step 1: Tester la construction pure de l'arbre**

Créer des spans synthétiques avec `makeAgentTraceSpan` depuis `src/test-utils/agent-trace-fixtures.ts` : un `traceId` pour plusieurs spans frères, un tool enfant avec `parentSpanId`, un tool non-agent sans parent, un parent référencé mais manquant et un cycle invalide. Ajouter aussi un test de régression où un span `llm` partage un `toolCallId` avec chacun des types d'action approuvés (`tool`, `skill`, `shell`, `hook`, `other`). Vérifier les tours triés par heure, les enfants attachés uniquement au parent attesté, l'ordre stable des frères et le marquage `unparented` pour les racines déconnectées.

```ts
const root = makeAgentTraceSpan({ spanId: 'root', category: 'agent' });
const siblingEarlier = makeAgentTraceSpan({
  spanId: 'sibling-earlier',
  parentSpanId: 'root',
  startedAt: '2026-09-23T10:00:00.100Z',
});
const toolLater = makeAgentTraceSpan({
  spanId: 'tool-later',
  parentSpanId: 'root',
  name: 'execute_tool runCommand',
  category: 'shell',
  startedAt: '2026-09-23T10:00:00.200Z',
});
const unlinkedTool = makeAgentTraceSpan({
  spanId: 'unlinked-tool',
  category: 'shell',
  parentSpanId: null,
});
const orphan = makeAgentTraceSpan({ spanId: 'orphan', parentSpanId: 'missing-parent' });
const turns = buildAgentTraceTree([toolLater, root, siblingEarlier, orphan, unlinkedTool]);

expect(turns).toHaveLength(1);
expect(turns[0].roots.map((node) => node.span.spanId))
  .toEqual(expect.arrayContaining(['root', 'orphan', 'unlinked-tool']));
expect(turns[0].roots[0].children.map((node) => node.span.spanId))
  .toEqual(['sibling-earlier', 'tool-later']);
expect(turns[0].roots[1].unparented).toBe(true);
expect(
  turns[0].roots.find((node) => node.span.spanId === 'unlinked-tool')?.unparented,
).toBe(true);
```

Un deuxième test ajoute `makeAgentTraceSpan({ traceId: 'trace-2', spanId: 'root-2' })` et vérifie que deux traces racines d'un `sessionId` restent deux tours distincts et que le tri est déterministe à timestamp égal.

- [ ] **Step 2: Vérifier l'échec du tree builder**

Run: `rtk npm test -- src/renderer/lib/agent-trace-tree.test.ts`

Expected: FAIL parce que `buildAgentTraceTree` n'existe pas.

- [ ] **Step 3: Implémenter le regroupement sans fabriquer de parent**

Indexer les spans par `(traceId, spanId)`, regrouper par `traceId`, puis attacher chaque nœud seulement si `parentSpanId` référence un span du même tour. Si la source fournit le même `toolCallId` entre un span `llm` et un span d'action de catégorie `tool`, `skill`, `shell`, `hook` ou `other`, conserver explicitement ce lien approuvé ; sinon conserver uniquement la relation parent OTel. Un span non-agent sans `parentSpanId`, une référence parent manquante ou un cycle est une racine `unparented`; il conserve sa source/session si son `traceId` appartient à la conversation et force l'état `partial`. Trier les enfants sur `startedAt`, avec `spanId` comme bris d'égalité ; ne jamais inventer une relation.

- [ ] **Step 4: Tester les états du hook IPC**

Dans `useAgentTrace.test.ts`, vérifier l'état initial, le chargement d'une sélection, l'annulation d'une réponse après démontage/changement de session, `not-collected`, le cas `partial`, l'erreur de lecture, l'activation/désactivation de collecte avec mise à jour du statut, puis un scénario différé où `clearTraceData()` démarre un rechargement pour la sélection A, la sélection passe à B pendant que la réponse A reste en attente, et la réponse A tardive n'écrase jamais la session B affichée.

Implémenter `useAgentTrace(selection)` sans polling continu : charger une fois au changement de sélection, garder le statut de collecte indépendant du détail de trace, utiliser le même garde de génération/annulation de requête pour les chargements normaux et les rechargements post-clear afin qu'aucun résultat ou aucune erreur périmés ne puissent modifier la session, l'erreur ou `sessionLoading` après un changement de sélection ou un démontage, et journaliser les erreurs par `logError('useAgentTrace', ...)`.

- [ ] **Step 5: Rendre l'arbre accessible et préserver la confidentialité**

Construire `AgentTraceTree` à partir de `buildAgentTraceTree`. Chaque nœud montre catégorie, nom, modèle/skill, horodatage, durée et statut ; les arguments/résultats sont repliés par défaut. Un bouton de nœud expose `aria-expanded`. Afficher un indicateur de durée/offset afin que les appels parallèles se chevauchant restent visibles.

Rendre seulement `argumentsJson` et `resultText` fournis par le store ; React échappe le contenu, et les marqueurs `redacted`, `truncated` et `omitted` restent visibles. Les spans LLM n'affichent ni prompts, ni réponses, ni raisonnement interne.

- [ ] **Step 6: Tester le composant et committer**

Run: `rtk npm test -- src/renderer/lib/agent-trace-tree.test.ts src/renderer/hooks/useAgentTrace.test.ts src/renderer/components/AgentTraceTree.test.tsx`

Expected: PASS pour plusieurs tours, parallélisme, parent manquant, statut d'erreur, contenu replié, expansion accessible et états partiels.

Commit:

```powershell
rtk git add -- 'src\renderer\lib\agent-trace-tree.ts' 'src\renderer\lib\agent-trace-tree.test.ts' 'src\renderer\hooks\useAgentTrace.ts' 'src\renderer\hooks\useAgentTrace.test.ts' 'src\renderer\components\AgentTraceTree.tsx' 'src\renderer\components\AgentTraceTree.test.tsx'
rtk git commit -m "feat: render agent trace span trees" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 8: Ajouter l'onglet opt-in et ouvrir une trace depuis une conversation

**Files:**
- Create: `src/renderer/components/AgentTracesPage.tsx`
- Create: `src/renderer/components/AgentTracesPage.test.tsx`
- Modify: `src/renderer/components/Sidebar.tsx`
- Modify: `src/renderer/components/Sidebar.test.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`
- Modify: `src/renderer/components/ProjectDetailPage.tsx`
- Modify: `src/renderer/components/ProjectDetailPage.test.tsx`
- Modify: `src/renderer/components/ConversationsTable.tsx`
- Modify: `src/renderer/components/ConversationsTable.test.tsx`

**Interfaces:**
- Consumes: `AgentTraceSelection`, `ConversationSummary.source`, `useAgentTrace` et `AgentTraceTree`.
- Produces:

```ts
export interface AgentTracesPageProps {
  selection: AgentTraceSelection | null;
}

export interface ConversationsTableProps {
  conversations: ConversationSummary[];
  updateContextKey: string;
  onViewTrace(selection: AgentTraceSelection): void;
}
```

- [ ] **Step 1: Tester l'action explicite par conversation**

Dans `ConversationsTable.test.tsx`, importer `vi` depuis Vitest, puis créer `onViewTrace = vi.fn()`, `user = userEvent.setup()` et une conversation `ConversationSummary` avec `sessionId: 'vscode:vscode-session-1'`, `source: 'vscode'` et `summary: 'VS Code work'`. Rendre le tableau avec `conversations`, `updateContextKey="all"` et `onViewTrace`, récupérer cette ligne puis cliquer son bouton **Voir la trace** :

```ts
const onViewTrace = vi.fn();
const user = userEvent.setup();
const conversations: ConversationSummary[] = [{
  sessionId: 'vscode:vscode-session-1',
  source: 'vscode',
  createdAt: '2026-09-23 10:00:00',
  summary: 'VS Code work',
  models: 'gpt-5.4',
  aiuCredits: 1,
  tokens: 10,
  requests: 1,
}];
render(
  <ConversationsTable
    conversations={conversations}
    updateContextKey="all"
    onViewTrace={onViewTrace}
  />,
);
const vscodeRow = screen.getByText('VS Code work').closest('tr') as HTMLElement;
await user.click(within(vscodeRow).getByRole('button', { name: 'Voir la trace' }));

expect(onViewTrace).toHaveBeenCalledWith({
  source: 'vscode',
  sessionId: 'vscode:vscode-session-1',
});
```

Vérifier aussi que le bouton d'une conversation Copilot CLI transmet `source: 'copilot-cli'` sans modifier l'affichage des crédits ou les deltas.

- [ ] **Step 2: Tester la navigation et l'accès sans base d'usage**

Dans `App.test.tsx`, sélectionner une conversation dans un détail projet, puis cliquer **Voir la trace** ; vérifier l'onglet et la sélection transmis à `AgentTracesPage`. Ajouter un autre test où `getUsage` et `getFilterOptions` échouent : l'onglet **Traces agents** reste accessible et affiche l'état de collecte.

Dans `Sidebar.test.tsx`, vérifier le nouvel item actif, son libellé et le `DashboardTab` correspondant.

- [ ] **Step 3: Implémenter la page et l'opt-in**

Dans `AgentTracesPage`, afficher le statut désactivé au premier lancement, l'action d'activation, l'état `listening` ou l'erreur de port, l'endpoint loopback et des instructions copiables pour configurer l'export VS Code et Copilot CLI. Les snippets utilisent l'endpoint `http://127.0.0.1:4318` et avertissent que `captureContent` peut faire transiter localement prompts/réponses avant filtrage.

La page montre la trace sélectionnée avec `AgentTraceTree`, les états `not-collected`/`partial`, une action de suppression manuelle avec confirmation, et la rétention de 30 jours. Afficher ces snippets de configuration explicites dans des blocs sélectionnables :

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "otlp-http",
  "github.copilot.chat.otel.otlpEndpoint": "http://127.0.0.1:4318",
  "github.copilot.chat.otel.captureContent": true
}
```

Pour Copilot CLI, afficher les variables `COPILOT_OTEL_ENABLED=true`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` et `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`. L'onglet ne modifie aucun réglage VS Code/CLI automatiquement. Les libellés suivent les noms approuvés **Traces agents** et **Voir la trace**.

- [ ] **Step 4: Brancher Sidebar, App et détail projet**

Ajouter `'agent-traces'` à `DashboardTab` et un bouton de navigation dans le groupe **Data & tools**. Ajouter dans `App.tsx` une sélection `{ source, sessionId }`, passée à `AgentTracesPage`; le callback du détail projet sélectionne la conversation puis navigue vers le nouvel onglet.

Rendre la branche `agent-traces` avant l'état global `dataUnavailable`, comme les pages indépendantes déjà accessibles quand la base de consommation est absente. Relier `ProjectDetailPage` à `ConversationsTable` avec `onViewTrace` et ajouter une action par ligne sans rendre toute la ligne cliquable.

- [ ] **Step 5: Vérifier les tests UI et committer**

Run: `rtk npm test -- src/renderer/components/AgentTracesPage.test.tsx src/renderer/components/Sidebar.test.tsx src/renderer/components/ConversationsTable.test.tsx src/renderer/components/ProjectDetailPage.test.tsx src/renderer/App.test.tsx`

Expected: PASS pour opt-in, instructions locales, erreur de port, sélection d'une conversation, navigation, suppression, états partiels et disponibilité sans données de consommation.

Commit:

```powershell
rtk git add -- 'src\renderer\components\AgentTracesPage.tsx' 'src\renderer\components\AgentTracesPage.test.tsx' 'src\renderer\components\Sidebar.tsx' 'src\renderer\components\Sidebar.test.tsx' 'src\renderer\App.tsx' 'src\renderer\App.test.tsx' 'src\renderer\components\ProjectDetailPage.tsx' 'src\renderer\components\ProjectDetailPage.test.tsx' 'src\renderer\components\ConversationsTable.tsx' 'src\renderer\components\ConversationsTable.test.tsx'
rtk git commit -m "feat: add per-conversation agent trace view" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 9: Valider les deux sources, les garanties de confidentialité et le build

**Files:**
- Aucun fichier applicatif supplémentaire ; corriger toute régression dans la tâche qui l'a introduite.

**Interfaces:**
- Consumes: ingestion, store, service, IPC et interface des Tasks 1–8.
- Produces: fonctionnalité vérifiée sur des interactions de test VS Code et Copilot CLI.

- [ ] **Step 1: Vérifier les cas automatiques de bout en bout**

Lancer ensemble les tests de protocole, sanitizer, store, récepteur, service, IPC et renderer :

```powershell
rtk npm test -- src/main/agent-trace-protocol.test.ts src/main/agent-trace-sanitizer.test.ts src/main/agent-trace-store.test.ts src/main/agent-trace-receiver.test.ts src/main/agent-trace-service.test.ts src/main/ipc-handlers.test.ts src/renderer/lib/agent-trace-tree.test.ts src/renderer/components/AgentTraceTree.test.tsx src/renderer/components/AgentTracesPage.test.tsx
```

Expected: PASS sans fixture contenant de donnée réelle ; les tests de payloads utilisent uniquement des secrets synthétiques.

- [ ] **Step 2: Exécuter une session synthétique dans VS Code puis Copilot CLI**

Dans un workspace temporaire sans secret, activer OTel localement avec `captureContent` après avoir lu l'avertissement de la page **Traces agents**. Configurer les deux clients sur `http://127.0.0.1:4318`, effectuer un appel shell inoffensif `echo trace-probe`, et ouvrir sa conversation dans Credits Tracker.

Vérifier pour chaque source le service/ID de conversation, les IDs de trace/span, l'appel LLM, l'outil shell, son statut/durée et, si la source l'émet, le skill et l'ID d'appel. Utiliser les spans OTel et leurs parents ; noter explicitement les champs absents comme partiels. Ne jamais utiliser une vraie conversation ou un vrai dépôt contenant des secrets pour ce test.

- [ ] **Step 3: Vérifier les données persistées et les comportements de sécurité**

Depuis l'interface, inspecter l'arbre, ouvrir un détail expurgé, puis vérifier la fixture de test correspondante dans le store pour confirmer que les prompts/réponses ne sont pas présents. Vérifier qu'une valeur secrète synthétique apparaît uniquement comme `[REDACTED]`, qu'un contenu incertain est omis et que le statut le signale.

Désactiver la collecte, redémarrer l'application et confirmer qu'aucun listener n'est actif. Exécuter le test à horloge fixe de purge 30 jours et le test de suppression manuelle ; ne pas déclencher de suppression récursive ni toucher aux fichiers sources Copilot.

- [ ] **Step 4: Exécuter la suite complète, le type-check et le package**

Run:

```powershell
rtk npm test
rtk npx tsc --noEmit
rtk npm run make
rtk git diff --check
rtk git status --short
```

Expected: tous les tests passent, TypeScript n'émet aucune erreur, le package Windows Squirrel se construit, `git diff --check` reste propre et aucun changement préexistant hors périmètre n'est staged ou modifié.

- [ ] **Step 5: Vérifier les commits de fonctionnalité**

Run: `rtk git --no-pager log --oneline -10`

Expected: les commits des Tasks 1–8 sont présents avec préfixes Conventional Commits et le trailer requis ; aucun commit ne contient les modifications préexistantes de `.claude\` ou `.github\copilot-instructions.md`.
