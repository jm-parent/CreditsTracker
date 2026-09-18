# Export HTML du tableau de bord de consommation

## Objectif

Remplacer la sortie d'export CSV par un rapport HTML unique, autonome et
consultable hors ligne. Le rapport doit reprendre le tableau de bord fourni en
référence visuelle, tout en conservant les filtres et le flux de sauvegarde
actuels de l'application.

## Périmètre

L'export produira exactement un fichier `.html`. Il n'y aura plus de fichiers
`*-summary.csv` ou `*-sessions.csv` générés par l'interface. Le rapport sera un
instantané statique : aucun script, CDN, police distante ou autre ressource
externe ne sera nécessaire.

Les filtres de période, projet et modèle, l'aperçu avant export, la boîte de
dialogue de sauvegarde, l'annulation et la confirmation d'écrasement restent
disponibles. Le fichier ne sera pas ouvert automatiquement après sa création,
comme dans le flux actuel.

## Architecture

Le processus renderer appellera un nouveau `exportHtml` via le preload et le
canal IPC `export-html`. Le processus main :

1. construit le même `ExportReport` que l'aperçu ;
2. ouvre une boîte de sauvegarde dont le nom par défaut est
   `copilot-usage.html` et dont le filtre est `HTML files (*.html)` ;
3. confirme l'écrasement si le chemin choisi existe ;
4. génère le document HTML complet ;
5. publie ce document avec la stratégie atomique existante : écriture dans un
   fichier temporaire, déplacement de l'ancien fichier vers une sauvegarde,
   publication du temporaire, puis nettoyage ; en cas d'erreur, restauration de
   l'ancien fichier.

Un module dédié de génération HTML sera séparé de la logique IPC et de
l'écriture sur disque. Il recevra un `ExportReport` et retournera une chaîne
HTML. Toutes les valeurs provenant des projets, modèles, résumés et autres
données de la base seront échappées avant insertion dans le balisage ou les
attributs SVG.

Les types et noms de résultats refléteront le fichier unique : `htmlPath`
remplacera `summaryPath` et `sessionsPath`. Le résultat conservera les nombres
de lignes agrégées et de sessions pour le message de succès.

## Contenu du rapport

Le document utilisera `lang="fr"` et contiendra un CSS inline avec un thème
sombre, une mise en page responsive et des règles d'impression :

- en-tête avec titre, période filtrée, projet/modèle sélectionnés et date de
  génération ;
- cartes KPI pour crédits AIU, tokens, requêtes, sessions et jours actifs ;
- évolution quotidienne des crédits sous forme de graphique SVG ;
- répartition des crédits par modèle sous forme d'anneau SVG et de légende ;
- consommation par projet sous forme de barres horizontales ;
- ratio tokens d'entrée/sortie par modèle ;
- tableau détaillé des sessions avec date, projet, modèle(s), crédits, tokens
  d'entrée, tokens de sortie, total, requêtes et résumé.

Les données déjà présentes dans `ExportReport` seront réutilisées. Les
regroupements par projet et les ratios entrée/sortie seront calculés à partir
des `summaryRows` et `sessionRows`, sans nouvelle requête SQLite. Les
graphiques seront rendus par le générateur sous forme de SVG et ne dépendront
pas de Recharts ou d'un script au moment de l'ouverture du fichier.

Les données vides afficheront un état explicite plutôt qu'un graphique
incomplet. Les valeurs numériques utiliseront un format stable et lisible,
avec des unités et des pourcentages cohérents avec l'aperçu.

## Robustesse et sécurité

La publication conservera les garanties de l'export actuel : un échec lors de
la publication ou du nettoyage sera remonté à l'appelant, et l'ancien fichier
sera restauré quand cela est possible. Les erreurs renderer seront journalisées
avec le contexte `HTML export failed` et présentées avec un message utilisateur
en anglais, cohérent avec l'interface existante.

Le générateur ne fera confiance à aucune donnée textuelle issue de la base :
les caractères HTML et les guillemets seront encodés. Les valeurs numériques
seront validées au moment du formatage afin qu'une valeur non finie ne puisse
produire du balisage invalide. Aucun contenu externe ne sera téléchargé ou
exécuté depuis le rapport.

## Validation

Les tests couvriront :

- la génération d'un document complet contenant les KPI, sections, SVG,
  tableaux et données attendus ;
- l'échappement des valeurs contenant des caractères HTML, des guillemets et
  des retours à la ligne ;
- les états sans données et les valeurs zéro ou les dénominateurs nuls ;
- l'écriture d'un fichier HTML et la restauration d'un fichier existant si la
  seconde étape de publication échoue ;
- l'enregistrement et l'exécution du canal IPC `export-html`, son filtre de
  sauvegarde et son résultat d'annulation/succès ;
- l'interface `ExportPage` : libellés HTML, nom `.html`, succès, annulation,
  erreur d'export et conservation des filtres.

Les critères d'acceptation sont : aucune sortie CSV depuis l'interface
d'export, un seul fichier HTML autonome pour chaque export réussi, ouverture
hors ligne dans un navigateur moderne, affichage des sections du tableau de
bord avec les données filtrées, et absence de régression sur l'aperçu ou les
filtres existants.
