# Traces d'appels des agents Copilot par conversation

## Objectif

Ajouter une visualisation structurée des appels effectués pendant une session
Copilot : appels au modèle, outils, commandes shell, skills, sous-agents et
autres actions exposées par la source. L'utilisateur doit pouvoir comprendre
ce que l'agent a appelé, dans quel ordre, avec quel résultat et, lorsque la
source le permet, comment les appels sont reliés.

Le « think » désigne ici l'activité d'appel au modèle et ses métadonnées. Le
texte de raisonnement interne du modèle n'est pas une donnée cible et ne doit
pas être capturé ou affiché.

## Contexte existant

Credits Tracker lit actuellement les sessions et événements de consommation
Copilot CLI depuis sa base SQLite, et analyse les fichiers de sessions Copilot
Chat de VS Code. La normalisation existante est volontairement limitée aux
colonnes de session et aux métriques de consommation (`assistant_usage_events`,
modèle, crédits, tokens et date). Le parseur VS Code ne produit qu'un événement
d'usage par requête terminée ; il ne construit pas de journal d'appels d'outils.

Ces données ne suffisent donc pas à reconstruire rétroactivement un arbre
d'activité. La fonctionnalité s'appuiera principalement sur les traces
OpenTelemetry (OTel) émises par les clients après activation. Les hooks Copilot
CLI pourront compléter la collecte si le prototype confirme une lacune OTel,
sans devenir la source structurelle de référence.

La documentation VS Code décrit des spans `invoke_agent`, `chat` et
`execute_tool`, des IDs de conversation et d'appel, ainsi que des attributs
pour les skills et outils. Les arguments et résultats sont disponibles en
capture de contenu, désactivée par défaut. La documentation indique aussi que
les sessions CLI lancées dans un terminal VS Code peuvent exporter leurs
propres traces, sous forme de traces racines indépendantes.

## Objectifs

- Collecter localement les traces des sessions Copilot Chat et Copilot CLI
  activées par l'utilisateur.
- Construire une vue par conversation qui représente les spans OTel sans
  inventer de liens parent-enfant absents de la source.
- Montrer les appels LLM, outils, skills, commandes shell, erreurs et
  sous-agents lorsque ces informations sont émises par la source.
- Afficher les arguments/commandes et résultats après filtrage, expurgation et
  troncature.
- Conserver les données de trace séparément des tables d'usage existantes.
- Purger automatiquement les détails après 30 jours et permettre leur
  suppression manuelle.
- Rendre explicites les traces partielles, les champs manquants et les sources
  non configurées.

## Hors périmètre

- Capturer ou stocker le raisonnement interne complet, les prompts, les
  réponses complètes du modèle, les messages système ou les définitions
  complètes des outils.
- Modifier les permissions, les arguments ou les résultats transmis aux
  agents.
- Envoyer des traces vers un service distant ou un backend d'observabilité
  externe.
- Garantir la reconstruction des sessions antérieures à l'activation OTel.
- Présenter une trace comme complète lorsque le client n'a pas exporté les
  spans ou leurs identifiants.
- Afficher en temps réel des appels encore en cours dans la première version.

## Expérience utilisateur

Un onglet dédié **Traces agents** fournit l'état de collecte, les instructions
de configuration et l'accès aux traces conservées. Une action **Voir la
trace** est disponible depuis chaque conversation du détail d'un projet.
Depuis ce contexte, elle ouvre une sous-vue de trace dans le détail du projet,
sans changer d'onglet principal ni désélectionner le projet. La sous-vue
conserve la sélection `{ source, sessionId }`, les filtres et le détail courant.

La sous-vue affiche l'arbre de spans et les états `not-collected`/`partial`
avec le composant `AgentTraceTree`. Un bouton **Retour au projet** ferme
uniquement la sous-vue et restaure le même détail projet sans nouvelle
navigation. L'onglet global **Traces agents** reste disponible dans la
navigation pour l'opt-in, les réglages locaux et la consultation générale.

### Navigation dans le détail projet

- Cliquer **Voir la trace** conserve l'onglet principal `projects` et le
  `selectedProject` courant ; l'application ne route pas vers l'onglet global.
- La sélection `{ source, sessionId }` est conservée pendant la sous-vue afin
  d'afficher la conversation correcte même si deux sources partagent un même
  identifiant brut.
- **Retour au projet** efface uniquement la sélection de trace. Les filtres,
  la page de détail et le tableau des conversations restent ceux qui étaient
  affichés avant l'ouverture de la trace.
- La sous-vue réutilise les états de chargement, d'erreur,
  `not-collected` et `partial` existants. Elle n'ajoute pas de second contrôle
  d'opt-in ni de copie des instructions ; ces actions restent dans l'onglet
  global **Traces agents**.

Le détail de session présente un arbre de spans, avec les appels frères
ordonnés chronologiquement et leurs durées. Les appels parallèles restent des
branches distinctes et leur chevauchement temporel est visible.

Chaque nœud peut afficher :

- le type d'opération : appel LLM, outil, skill, shell, sous-agent ou autre ;
- le modèle ou le nom de l'outil/skill ;
- l'heure, la durée et le statut (succès, échec ou état fourni par la source) ;
- les tokens et métadonnées disponibles pour les appels LLM ;
- des détails repliés contenant uniquement les arguments/commandes et
  résultats filtrés.

Les nœuds LLM ne montrent pas les messages de prompt ou de réponse. Les
arguments et résultats sont masqués par défaut dans l'interface et signalés
lorsqu'ils ont été expurgés, tronqués ou omis par sécurité.

Les traces sont consultables après l'export des spans. L'application peut
rafraîchir les données après réception de spans terminés, mais ne promet pas
d'afficher un span encore en cours d'exécution.

## Classification des événements

La normalisation s'appuie d'abord sur les conventions OTel et les attributs
Copilot fournis par la source :

| Catégorie affichée | Source indicative |
| --- | --- |
| Agent / sous-agent | `invoke_agent` |
| Appel LLM (« think » au sens activité) | `chat` |
| Appel d'outil | `execute_tool`, `gen_ai.tool.name` |
| Skill | `github.copilot.tool.parameters.skill_name` |
| Shell | outil shell et attribut de commande, si fourni |
| MCP | type d'outil et nom d'outil MCP, si fournis (`gen_ai.tool.type` = `mcp` ou `github.copilot.tool.parameters.mcp_tool_name`) |
| Autre | opération ou outil non reconnu |
| Hook | `execute_hook`, lorsqu'il fait partie de la trace collectée |

Les appels LLM peuvent inclure un nombre de tokens de raisonnement si la source
le fournit. Cette métrique n'est pas le contenu du raisonnement. Le type
d'erreur est lu dans `gen_ai.error.type`, puis dans `error.type` émis par
Copilot Chat.

## Architecture et flux de données

### Collecte locale

1. L'utilisateur active explicitement la collecte des traces.
2. L'application démarre un récepteur OTLP HTTP lié uniquement à l'interface
   loopback. Elle fournit une configuration ou des instructions copiables pour
   VS Code et Copilot CLI ; elle ne modifie pas leurs réglages externes sans
   consentement distinct. Le récepteur n'accepte que OTLP/HTTP Protobuf : les
   instructions règlent donc `github.copilot.chat.otel.protocol` et
   `OTEL_EXPORTER_OTLP_PROTOCOL` sur `http/protobuf`, car les deux clients
   exportent en JSON par défaut. Les réglages `github.copilot.chat.otel.*` ne
   sont lus que dans les User settings de VS Code (portée application) et
   nécessitent un rechargement de VS Code.
3. Les clients exportent leurs traces vers ce récepteur. La configuration de
   contenu est nécessaire pour recevoir les arguments/résultats, mais peut
   également faire transiter des prompts/réponses complets. Un export refusé
   avant décodage (format JSON, corps de plus de 8 MiB) est journalisé sans
   valeur de payload et signalé dans l'état de collecte jusqu'au prochain
   export entièrement accepté.
4. Le récepteur transforme les attributs en un modèle interne à liste
   autorisée, supprime les champs non requis, masque les secrets connus et
   tronque les valeurs longues avant de les persister.
5. Les spans expurgés sont enregistrés dans une base locale dédiée sous les
   données utilisateur de l'application. La base Copilot CLI reste en lecture
   seule et les tables de consommation existantes ne changent pas.
6. L'interface charge les spans pour la conversation sélectionnée et bâtit
   l'arbre à partir des identifiants OTel.

Le récepteur ne transmet pas les traces à un collecteur distant. Il ne stocke
ni le corps OTLP brut ni les métriques OTel non nécessaires à l'arbre. Il
refuse toute requête dont l'en-tête `Host` n'est pas `127.0.0.1` ou
`localhost` (avec son port d'écoute) ainsi que toute requête portant un
en-tête `Origin`, afin qu'une page web ne puisse pas injecter de spans par
rebinding DNS. Les appels d'outils issus des hooks CLI ne sont ajoutés qu'en
complément d'une lacune confirmée. Si une même invocation est identifiée dans
OTel et dans un hook, OTel reste l'enregistrement canonique et le hook ne crée
pas un doublon.

### Modèle normalisé

Chaque span stocké comprend au minimum :

- la source (`vscode` ou `copilot-cli`) et l'identifiant de conversation
  fourni par cette source ;
- `trace_id`, `span_id` et `parent_span_id` ;
- le nom/opération du span, le nom d'outil et le nom de skill lorsqu'ils sont
  disponibles ;
- les heures de début/fin, le statut et le type d'erreur ;
- les arguments/résultats expurgés dans des champs distincts et bornés ;
- un état de contenu indiquant s'il est présent, tronqué, expurgé ou omis ;
- l'heure de réception du span et les attributs de source nécessaires à
  l'affichage.

Une contrainte d'unicité sur la source, le `trace_id` et le `span_id` rend
l'ingestion idempotente. Les IDs de conversation et de session sont conservés
avec leur espace de noms fournisseur ; les associations aux `sessionId`
existants ne sont faites qu'après validation de leur correspondance.

### Construction de l'arbre

Les spans sont d'abord groupés par source et identifiant de conversation. Une
conversation peut contenir plusieurs `trace_id` (par exemple, une racine
`invoke_agent` par interaction) ; chacune devient un tour distinct, ordonné par
heure de début. À l'intérieur de chaque trace, les spans sont reliés en premier
lieu par `parent_span_id`. Les appels frères sont triés par heure de début, et
leur durée permet de visualiser les chevauchements. Un
`gen_ai.tool.call.id` ou un autre identifiant explicite peut préciser le lien
entre une requête modèle et son exécution d'outil.

Lorsqu'un span du même `trace_id` ne porte pas lui-même l'identifiant de
conversation, il peut hériter du contexte source/session de la racine de cette
trace. Cet héritage ne crée pas de parent : tout span non-agent sans
`parent_span_id`, ou dont le parent est absent, reste une racine non reliée et
marque la session comme partielle.

La racine d'une trace est le span agent sans `parent_span_id` ; un sous-agent
dont le parent n'est pas encore reçu ne définit jamais la conversation de la
trace. Les exporteurs envoient les spans par lots et la racine `invoke_agent`
se termine en dernier : les spans reçus avant leur racine sont donc gardés en
mémoire, déjà expurgés, au plus 30 secondes et dans des bornes de nombre
(2 000 spans) et de taille (16 MiB). Le récepteur répond alors `200` sans span
rejeté. À l'arrivée de la racine, ils héritent de son contexte, que le
récepteur mémorise pour les spans plus tardifs de la même trace. À expiration
ou dépassement des bornes, un span garde le contexte explicite porté par sa
propre ascendance attestée (`gen_ai.conversation.id`, ou
`copilot_chat.parent_chat_session_id` pour un sous-agent) ; sans contexte
explicite, il est abandonné et la couverture partielle est signalée dans
l'application. Désactiver la collecte ou fermer l'application applique cette
même règle ; supprimer les traces oublie aussi les spans en attente.

Des traces provenant de sources différentes ne sont pas regroupées simplement
parce qu'elles se sont produites dans le même dépôt ou à une heure proche.
Elles ne peuvent être réunies sous une même session qu'après validation d'un
identifiant de correspondance explicite.

Certains exporteurs peuvent ne pas exposer un lien sémantique direct entre un
span `chat` et un span `execute_tool`. Dans ce cas, l'interface respecte
l'arbre OTel disponible et montre l'appel comme branche chronologique sous le
parent attesté. Elle ne déduit pas un parent à partir du seul nom de l'outil
ou d'une proximité temporelle.

Les hooks CLI (`preToolUse`, `postToolUse` et `postToolUseFailure`) peuvent
fournir les arguments, le résultat ou l'erreur d'une invocation. Comme ces
événements ne garantissent pas nécessairement les IDs OTel nécessaires au
parentage, ils restent des observations complémentaires jusqu'à validation
d'une corrélation exacte.

## Confidentialité et conservation

- La collecte de contenu est opt-in et l'export reste local.
- Le stockage limite les champs de contexte non sensibles aux arguments et
  résultats d'outil connus ; prompts, réponses, messages système, messages,
  schémas d'outils et attributs OTLP inconnus sont exclus. Les clés
  dynamiques propres à l'outil restent conservées à l'intérieur de ces
  arguments/résultats après masquage et troncature.
- Les champs autorisés sont parcourus pour expurger les secrets connus. La
  première version doit reconnaître au minimum les formats de jetons GitHub,
  les identifiants de clés AWS, les valeurs `Bearer`, les blocs de clés
  privées PEM et les paires clé/valeur dont la clé contient `token`, `secret`,
  `password`, `api_key` ou `authorization`. Une clé est reconnue qu'elle soit
  préfixée, suffixée ou entre guillemets (`GITHUB_TOKEN=`, `client_secret:`,
  `"password": "…"`), et les clés JSON sont normalisées sans `_`, `-` ni casse
  (`apiKey`). Le JSON encodé dans une chaîne est expurgé comme une structure.
  Un en-tête ou pied de clé privée sans sa borne correspondante rend le
  contenu omis. Les valeurs binaires sont omises, jamais encodées.
- Après expurgation, chaque champ d'argument ou de résultat est limité à
  32 KiB UTF-8. Un contenu plus long est tronqué et marqué comme tel.
  Le masquage n'est pas considéré comme une garantie de détection de toute
  donnée sensible.
- Si l'expurgation échoue, si le contenu est illisible ou si son traitement
  est ambigu, le contenu complet est omis. Les métadonnées non sensibles
  (outil, durée, statut) sont conservées et l'interface indique que le contenu
  a été masqué.
- Les traces détaillées expirent 30 jours après leur réception. L'utilisateur
  peut supprimer les données avant cette échéance.
- Désactiver l'export empêche la réception de nouvelles traces ; cela ne
  transforme pas une trace absente en trace vide ou complète.

L'activation de la capture côté client peut faire transiter des données
supplémentaires (prompts et réponses) jusqu'au récepteur local avant leur
suppression. L'interface d'activation doit avertir l'utilisateur de ce fait.

## Erreurs et couverture partielle

- Si la source n'est pas configurée ou n'émet pas de spans, l'interface
  affiche **Non disponible** avec la source manquante ; elle ne présente pas
  une session vide comme une session sans appels.
- Si seuls certains spans sont reçus, si un parent est absent ou si le contenu
  est désactivé, la trace est signalée comme partielle et les limites sont
  visibles dans le détail.
- Un span sans parent exploitable reste visible dans la chronologie de la
  trace, sans parent inventé.
- Une erreur de parsing ou de stockage est journalisée avec le contexte de la
  source, sans inclure les arguments ou résultats bruts dans les logs.
- Une erreur du récepteur ne bloque pas le tableau de bord de consommation.
- Une collision de port ou une configuration non-loopback empêche l'activation
  du récepteur et produit un message explicite.

## Prototype de faisabilité

Avant de déclarer une couverture complète, un prototype doit vérifier au moins
une interaction synthétique dans chaque source visée. Il doit établir :

- si les deux clients peuvent envoyer leurs spans à l'endpoint local ;
- si l'identifiant OTel de conversation peut être relié à la session affichée
  par Credits Tracker ;
- quels types de tool, skills et commandes sont présents dans les spans ;
- si les IDs de parent et de tool call suffisent à relier les événements sans
  heuristique ;
- quels attributs sont exportés lorsque la capture de contenu est activée ;
- que seuls les champs expurgés arrivent dans le stockage persistant.

Si une source ne fournit pas un champ ou un lien, la version initiale doit
afficher la lacune et utiliser les hooks uniquement pour les données
complémentaires qu'ils peuvent fournir avec fiabilité.

## Tests

### Ingestion et modèle de données

- Lecture de fixtures OTel synthétiques pour VS Code et Copilot CLI.
- Normalisation des spans d'agent, d'appel LLM, d'outil, de skill, de shell,
  de sous-agent, de hook et de catégorie inconnue.
- Groupement par source, conversation et trace ; parentage par `span_id` et
  `parent_span_id`.
- Associations par identifiant d'appel explicite, ainsi que comportement
  lorsque ces IDs ou le parent manquent.
- Appels frères parallèles, ordre chronologique stable, spans d'échec,
  spans incomplets et spans reçus plusieurs fois.
- Enfants exportés avant leur racine dans des requêtes distinctes, racine
  reçue avant des spans tardifs, expiration et bornes de l'attente en mémoire.
- Persistance idempotente dans le stockage local, sans écriture dans la base
  source du CLI.

### Confidentialité et cycle de vie

- Expurgation des formats connus de clés, tokens, mots de passe et en-têtes
  d'autorisation.
- Exclusion des prompts, réponses, messages système et attributs hors liste
  autorisée.
- Échec fermé pour une valeur invalide, ambiguë ou impossible à expurger ;
  conservation des métadonnées non sensibles seulement.
- Troncature explicite des contenus dépassant la limite configurée.
- Purge des traces âgées de plus de 30 jours et suppression manuelle.
- Vérification que le récepteur refuse un bind ou une destination non locale,
  un en-tête `Host` non loopback, une requête portant `Origin`, et qu'il
  signale les exports JSON (415) ou trop volumineux (413).

### Interface

- Affichage d'un arbre, d'appels parallèles, des statuts et des durées.
- Détails repliés pour arguments et résultats expurgés.
- Traces non configurées, partielles, sans parent, en erreur et sans contenu.
- Indication de masquage/troncature et absence de texte de prompt/réponse.
- Hiérarchie exposée par des listes imbriquées natives et noms accessibles
  distincts pour chaque action **Voir la trace** et chaque bouton de détail.

## Critères d'acceptation

- Une session nouvellement tracée depuis chaque source prise en charge peut
  être ouverte depuis sa conversation et rendue en arbre avec chronologie des
  branches parallèles.
- Les appels LLM, outils et skills disponibles sont identifiés par leurs
  attributs source, et les erreurs/durées sont visibles lorsqu'elles sont
  émises.
- Les liens parent-enfant ne sont affichés que lorsqu'ils sont supportés par
  la trace ; les cas manquants sont présentés chronologiquement comme partiels.
- Les commandes, arguments et résultats sont expurgés et bornés ; une
  expurgation incertaine omet le contenu.
- Aucun prompt, réponse complète ou raisonnement interne n'est persisté.
- Les traces sont conservées localement pendant au plus 30 jours, supprimables
  manuellement et jamais exportées vers un service distant.
- Les tableaux et totaux de consommation existants restent inchangés.

## Références

- [Monitor agent usage with OpenTelemetry (VS Code)](https://code.visualstudio.com/docs/agents/guides/monitoring-agents)
- [GitHub Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)
- [OpenTelemetry for agent monitoring](https://docs.github.com/en/copilot/concepts/enterprise/opentelemetry)
