# Refonte de l’écran Traces agents

## Contexte

Cette conception affine l’onglet global **Traces agents** défini dans
`2026-09-23-agent-call-traces-design.md`. L’onglet global sert à activer la
collecte locale, configurer les exporteurs et gérer la conservation. La lecture
d’un arbre de spans reste dans la sous-vue du détail de projet.

La capture jointe définit la structure et l’apparence souhaitées. Le menu
existant de l’application suffit à la navigation : aucun fil d’Ariane ne sera
ajouté à la page. En cas de divergence, la géométrie arrondie visible dans la
capture prévaut sur la règle de rayon nul de `DESIGN.md`.

## Objectifs

- Reprendre la composition en trois panneaux de la capture, avec une hiérarchie
  visuelle sombre, des accents cyan/verts et des actions clairement différenciées.
- Présenter l’état réel de la collecte locale et son endpoint loopback.
- Fournir un onglet de configuration VS Code et un onglet Copilot CLI, avec
  copie du snippet correspondant.
- Expliquer les limites de confidentialité de `captureContent`.
- Afficher la rétention de 30 jours et conserver la suppression manuelle.
- Retirer la sélection de conversation et son arbre de cet onglet global, sans
  changer l’accès à la sous-vue depuis le détail d’un projet.

## Hors périmètre

- Ajouter une API, un canal IPC ou une requête SQLite pour agréger les mesures
  de stockage.
- Afficher des valeurs d’exemple comme si elles étaient des métriques réelles.
- Modifier les paramètres VS Code ou Copilot CLI de l’utilisateur.
- Modifier le récepteur, le stockage, l’expurgation ou le composant d’arbre.
- Ajouter un fil d’Ariane ou refondre le menu de l’application.

## Structure et contenu

La page conserve l’en-tête général **Credits Dashboard** fourni par le shell
de l’application, puis affiche le titre **Traces agents & Télémétrie locale**,
une description en français et les trois panneaux suivants.

### Collecte locale

- Interrupteur **Activer la collecte locale des traces agent**, branché sur
  l’action existante d’activation/désactivation.
- Badge d’état reflétant `enabled` et `listening`, y compris les états de
  chargement, d’attente du récepteur et d’erreur.
- Endpoint réel, avec action de copie.
- Rappel que l’écoute est limitée à loopback, ainsi que les informations de
  protocole et de port prises en charge par le récepteur existant.

### Configuration des exporteurs locaux

- Deux onglets accessibles : **VS Code (settings.json)** et **Copilot CLI
  (variables d’env)**. VS Code est sélectionné par défaut.
- Chaque onglet présente son texte d’aide et le snippet existant, sans changer
  les clés ni les valeurs de configuration.
- Bouton de copie du snippet actif, avec confirmation temporaire et message
  visible en cas d’échec.
- Pour VS Code, rappeler que ces paramètres doivent être ajoutés aux User
  settings et qu’un rechargement de la fenêtre est requis.
- Conserver l’avertissement sur `captureContent` : le contenu peut transiter
  localement avant filtrage, les traces persistées restent assainies et le
  raisonnement masqué n’est jamais affiché.

### Traces stockées et gestion de l’espace

- Afficher la politique réelle de rétention : 30 jours avec purge automatique.
- Garder les emplacements de volume actuel et de dernière capture, mais afficher
  `—` et **Indisponible** dans chacun; ne pas fabriquer de mesures.
- Conserver le bouton destructif de suppression et sa confirmation irréversible.
- Garder une note indiquant que l’effacement vise le stockage local des traces,
  sans modifier les réglages des IDE.

La carte **Selected conversation** disparaît de cet onglet. `AgentTraceTree` et
la sous-vue **ProjectTraceSubview** restent inchangés et accessibles depuis le
détail du projet.

## Style et responsive

- Réutiliser les composants `Card`, `Badge` et les états Tailwind déjà présents.
- Reprendre les surfaces navy, les accents cyan, les indicateurs verts et le
  traitement rouge des actions destructives de la capture et de `DESIGN.md`.
- Garder les coins arrondis de la capture malgré la règle de rayon nul du
  document de style.
- Utiliser une composition à deux colonnes pour les zones qui s’y prêtent sur
  grand écran; empiler les panneaux et les métriques sur les fenêtres étroites.
- Les libellés sont en français; les snippets et identifiants techniques restent
  inchangés.

## Données et interactions

- L’état de collecte et l’endpoint viennent de `useAgentTrace` et du statut
  déjà exposé par l’application; la page n’a plus besoin d’une sélection de
  conversation.
- Le bouton de suppression utilise l’action `clearTraceData` existante.
- La copie réutilise `navigator.clipboard.writeText`, comme dans `LogsPage`.
  Les erreurs sont journalisées et affichées à l’utilisateur.
- Aucun nouveau contrat IPC, aucune migration et aucune modification backend.
- L’état de rétention reste aligné sur la purge automatique déjà appliquée par
  le service de traces.

## Gestion des erreurs et accessibilité

- Ne pas présenter l’état « désactivé » comme certain pendant le chargement du
  statut.
- Les erreurs de collecte et de suppression restent visibles avec un message
  accessible de type `role="alert"`.
- Les onglets exposent leur état sélectionné et leurs relations ARIA; le
  changement d’onglet fonctionne au clavier.
- Les actions de copie exposent les états **Copié** et **Échec de la copie**.
- Les actions de suppression restent désactivables pendant l’opération.

## Vérification

Les tests ciblés du composant couvrent :

- l’affichage des états de collecte (chargement, désactivé, écoute active,
  attente et erreur) et de l’endpoint;
- le changement d’onglet et le snippet associé, ainsi que la réussite et
  l’échec de copie;
- les valeurs indisponibles pour le volume et la dernière capture, et la
  politique de rétention réelle de 30 jours;
- la confirmation, l’annulation et l’exécution de la suppression;
- l’absence de l’arbre de conversation dans l’onglet global, sans régression de
  l’accès à la trace dans le détail du projet.
