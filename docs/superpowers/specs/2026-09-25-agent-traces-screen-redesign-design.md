# Refonte de l’écran Traces agents et exploration des sessions

## Contexte et décisions validées

Cette conception affine l’onglet global **Traces agents** défini dans
`2026-09-23-agent-call-traces-design.md`. L’onglet global active la collecte
locale, guide la configuration des exporteurs, présente le stockage réel et
permet d’ouvrir la liste des sessions qui ont des traces.

Le menu et l’en-tête **Credits Dashboard** du shell restent inchangés. Aucun
fil d’Ariane n’est ajouté. Les coins arrondis de la maquette prévalent sur la
règle de rayon nul de `DESIGN.md`.

Décisions confirmées :

- Le compteur des sessions est réel et nécessite une lecture SQLite en lecture
  seule ainsi qu’un contrat IPC/preload minimal; aucune migration n’est requise.
- Le badge d’écoute est actualisé par un événement IPC émis lors des changements
  du statut du récepteur; il n’est pas simulé par un polling.
- L’identité d’une session de trace est le couple `(source, sessionId)`, comme
  `AgentTraceSelection`; le compteur ne déduplique pas sur `sessionId` seul.
- Le compteur est chargé à l’ouverture de l’aperçu et après une purge réussie,
  sans polling ni événement IPC par span.
- Cliquer sur le compteur ouvre une liste; sélectionner une ligne ouvre
  `AgentTraceTree` et un bouton permet de revenir à la liste.
- La liste offre une recherche texte et des filtres par source, période,
  catégorie et statut. Aucun filtre projet n’est ajouté, car le stockage des
  traces ne contient pas de champ projet.

## Objectifs

- Reprendre la composition en trois panneaux de la maquette : collecte locale,
  configuration des exporteurs et gestion du stockage.
- Rendre l’état du récepteur visible dans le bandeau et l’endpoint loopback
  copiable.
- Fournir des onglets de configuration VS Code et Copilot CLI avec copie du
  snippet actif.
- Afficher le nombre réel de sessions de trace, puis permettre de filtrer,
  parcourir et inspecter ces sessions.
- Expliquer les limites de confidentialité de `captureContent`.
- Afficher la rétention réelle de 30 jours et conserver la suppression manuelle
  confirmée.
- Garder la lecture des traces accessible depuis les détails de projet.

## Hors périmètre

- Modifier les paramètres VS Code ou Copilot CLI de l’utilisateur.
- Modifier le récepteur OTLP, l’ingestion, l’assainissement ou la durée de
  rétention.
- Ajouter une migration ou joindre les traces aux bases d’usage pour fabriquer
  un nom de projet.
- Ajouter un compteur « dernière capture » ou afficher des valeurs d’exemple.
- Ajouter du polling ou un événement par span pour actualiser le compteur.
- Ajouter un fil d’Ariane ou refondre le menu de l’application.

## Structure et contenu

### Bandeau d’état et titre

- Afficher **Traces agents & Télémétrie locale** et le sous-titre :

  > Inspectez les spans d’outils et d’agents capturés strictement en local.
  > L’application ne modifie jamais automatiquement vos configurations VS Code
  > ou Copilot CLI.

- Le badge animé vert **● Écoute active** n’apparaît que si le statut réel
  `listening` vaut `true`.
- Pendant le chargement, afficher un état de chargement. Si le statut est
  indisponible ou en erreur, ne pas le présenter comme désactivé.
- Si la collecte est activée mais le récepteur ne démarre pas, afficher un état
  d’attente/erreur distinct; si elle est désactivée, utiliser un badge neutre.
- Afficher l’endpoint réel fourni par le service ou le fallback
  `http://127.0.0.1:4318`, avec une action de copie rapide.

### Module 1 — Collecte locale OTLP

- Garder le toggle **Activer la collecte locale des traces agent**, relié aux
  actions existantes.
- Quand le récepteur écoute, afficher **Actif — En attente de spans OTLP**;
  cette mention décrit l’état d’écoute et ne prétend pas qu’aucune trace
  n’existe déjà.
- Rappeler que les données transitent par le loopback local et ne quittent pas
  la machine.
- Afficher le badge technique **OTLP/HTTP (protobuf)** avec sa puce verte.
- Afficher le port réel (fallback `4318`); le statut **Prêt** n’est montré que
  lorsque le récepteur écoute. Les états d’attente et d’erreur restent distincts.

### Module 2 — Configuration des exporteurs locaux

- Présenter deux onglets accessibles : **VS Code (settings.json)** et
  **Copilot CLI (Variables d’environnement)**. VS Code est sélectionné par
  défaut.
- Chaque onglet conserve ses clés, valeurs et protocole OTLP/HTTP Protobuf
  existants; un seul snippet est rendu à la fois.
- Le bouton de copie porte un libellé adapté au snippet actif, notamment
  **Copier le JSON** pour VS Code. Les états de succès et d’échec sont visibles
  près du contrôle concerné.
- Rappeler que les réglages VS Code se font dans les User Settings et nécessitent
  un **Reload Window**; afficher aussi l’aide Copilot CLI.
- Conserver l’avertissement `captureContent` : le contenu peut transiter
  localement avant filtrage, les traces persistées restent assainies via
  `AgentTraceTree` et le raisonnement masqué n’est jamais affiché.

### Module 3 — Stockage et purge

- Afficher deux mini-cartes :
  - **Sessions avec traces** : nombre réel de couples distincts
    `(source, session_id)` présents dans le stockage local. La carte est un
    bouton ouvrant la liste décrite ci-dessous.
  - **Politique de rétention** : **30 jours (auto-purge)**.
- Supprimer entièrement la métrique **Dernière capture**.
- Garder le bouton rouge **Supprimer les traces stockées**, sa confirmation
  irréversible et la note **Irréversible. Efface le cache local sans affecter
  vos IDEs.**

### Sous-écran — Liste des sessions de trace

- Le clic sur **Sessions avec traces** remplace l’aperçu par une vue de liste
  intégrée à l’écran Traces agents; **Retour aux traces** ramène à l’aperçu.
- Regrouper les spans par `(source, session_id)`. Chaque ligne expose seulement
  des métadonnées de synthèse : source, ID de session et nombre total de spans
  stockés pour cette session, indépendamment des filtres.
- Fournir :
  - une recherche texte sur l’ID de session, l’outil, le skill ou le modèle;
  - un filtre source (VS Code / Copilot CLI);
  - une période basée sur `started_at`;
  - des filtres catégorie et statut.
- La recherche texte correspond à l’ID de session ou à un champ recherché dans
  un span. La source filtre le couple; la catégorie, le statut, la période et
  les champs de recherche issus des spans doivent correspondre simultanément à
  au moins un même span de la session.
- Trier par activité de span la plus récente et paginer les résultats par
  50 sessions. Un changement de filtre réinitialise la page; un retour du détail
  conserve les filtres et la page courants.
- Ne pas afficher de filtre projet : aucun projet n’est persisté avec les spans.
- Le clic sur une ligne charge la session avec l’API de détail existante et
  rend `AgentTraceTree`; **Retour aux sessions** revient à la liste.

## Données et architecture

- Le statut de collecte et l’endpoint continuent de provenir de `useAgentTrace`.
- À l’initialisation, l’interface lit le statut existant; le service émet ensuite
  un événement IPC typé à chaque changement de statut du récepteur. Le hook
  s’abonne au montage et retire l’abonnement au démontage.
- Ajouter au service de traces et à l’API preload/IPC une opération en lecture
  seule pour compter les couples distincts `(source, session_id)`. Un comptage
  réussi à zéro affiche `0`; une erreur affiche **Indisponible** et ne devient
  jamais un zéro de succès.
- Ajouter une opération de liste paginée qui accepte les filtres validés et
  renvoie uniquement les résumés de sessions, jamais les payloads de spans.
  Les filtres sont appliqués côté main avec des requêtes paramétrées sur les
  données déjà assainies.
- La liste appelle `getAgentTraceSession` uniquement après sélection d’une ligne;
  les spans sont alors rendus par `AgentTraceTree`.
- Les opérations de comptage et de liste journalisent puis propagent les erreurs
  afin que l’interface puisse les signaler explicitement.
- Aucun schéma de table n’est modifié; la purge automatique de 30 jours reste
  celle du service existant.
- Le compteur est actualisé à l’ouverture/au retour vers l’aperçu et après une
  purge réussie. Il n’y a ni polling ni rafraîchissement à chaque ingestion.
  L’événement IPC porte uniquement les changements d’état du récepteur.
- L’effacement utilise `clearTraceData`; la copie utilise
  `navigator.clipboard.writeText`; aucune configuration d’IDE n’est modifiée.

## Style, erreurs et accessibilité

- Réutiliser `Card`, `Badge` et les états Tailwind existants : surfaces navy,
  accents cyan, indicateurs verts et actions destructives rouges.
- Garder les coins arrondis de la maquette. Empiler les trois panneaux et les
  filtres sur les fenêtres étroites.
- Tous les libellés de l’interface sont en français; les identifiants et snippets
  techniques restent inchangés.
- Le bouton KPI, les filtres, la pagination, le détail et les retours sont
  utilisables au clavier et ont des noms accessibles.
- Distinguer chargement, erreur, aucun résultat pour les filtres et liste vide.
  L’échec du compteur affiche **Indisponible**, jamais `0`.
- Les erreurs de collecte, de lecture de liste, de session et de purge restent
  visibles via des messages accessibles de type `role="alert"` avec une action
  de nouvelle tentative lorsque c’est pertinent.
- Les onglets exporteurs gardent leurs relations ARIA et la navigation clavier;
  les actions de copie exposent **Copié** et **Échec de la copie**.

## Vérification

Les tests couvrent :

- les états du bandeau et du module de collecte, l’endpoint copiable et le port
  réellement prêt, ainsi que les mises à jour d’état par événement IPC;
- les onglets exporteurs, leurs snippets inchangés, les retours de copie et
  l’avertissement `captureContent`;
- le comptage par couples `(source, session_id)`, y compris deux sources qui
  partagent le même `session_id`;
- le regroupement, la recherche, les filtres source/période/catégorie/statut,
  le tri et la pagination de la liste;
- le contrat store/service/IPC/preload et l’absence de payload de span dans les
  résumés;
- les états compteur/liste (chargement, zéro, erreur, retry, aucun résultat),
  le drill-down vers `AgentTraceTree`, le retour avec filtres conservés et le
  rafraîchissement après purge;
- la confirmation, l’annulation et l’exécution de la suppression;
- la conservation de `ProjectTraceSubview` et l’absence d’arbre sur l’aperçu
  global.
