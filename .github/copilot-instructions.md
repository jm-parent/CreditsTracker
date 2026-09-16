# Instructions pour Copilot sur ce dépôt

## Commits et versioning (important)

Ce dépôt utilise **semantic-release** avec les **Conventional Commits** pour
automatiser le versioning et la publication des releases GitHub. Tout commit
poussé sur `master` doit respecter ce format pour déclencher (ou non) une
release :

- `fix: ...` → release **patch** (1.0.0 → 1.0.1)
- `feat: ...` → release **minor** (1.0.0 → 1.1.0)
- `feat!: ...` ou un corps de commit contenant `BREAKING CHANGE:` → release
  **major** (1.0.0 → 2.0.0)
- `chore:`, `docs:`, `refactor:`, `test:`, `ci:`, `style:` → ne déclenchent
  **pas** de release

Toujours utiliser ces préfixes de type Conventional Commits sur les commits
poussés sur `master`, sinon le workflow Release ne publiera rien (ou pas la
bonne version).

## Pipelines CI/CD (`.github/workflows/`)

- `ci.yml` : lance `npm test` sur chaque push/PR.
- `release.yml` : sur chaque push sur `master` (ou déclenchement manuel via
  l'onglet Actions), fait tourner semantic-release qui bump la version,
  génère `CHANGELOG.md`, build les artefacts Squirrel Windows
  (`npm run make`), tague le commit et publie une GitHub Release avec
  `Setup.exe`, le `.nupkg` et `RELEASES`.
- Config semantic-release : `.releaserc.json`.
- Les deux workflows tournent sur `windows-latest` avec **Node 24** (doit
  matcher la version utilisée en local, car `better-sqlite3` embarque des
  binaires précompilés spécifiques à chaque version de Node).
- L'installation des dépendances utilise `npm ci --ignore-scripts` : ceci
  évite un bug connu où `node-gyp` tente (inutilement) de recompiler
  `better-sqlite3` et échoue à détecter Visual Studio sur les runners
  GitHub-hébergés. `better-sqlite3` fournit déjà des binaires précompilés
  pour toutes les plateformes (`node_modules/better-sqlite3/prebuilds/`), et
  Electron télécharge son binaire à la demande (au premier `require`), donc
  `--ignore-scripts` est sans danger ici. **Ne pas retirer ce flag** sans
  revalider que l'installation et `npm run make` fonctionnent toujours dans
  les deux workflows.
- Les URLs `git+ssh://` (dépendances git transitives comme `electron/node-gyp`)
  sont réécrites en `https://` via `git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"`
  avant `npm ci`, car les runners GitHub Actions n'ont pas de clé SSH.

## Tester une release en local sans rien publier

    npm run release:dry-run

## Push GitHub depuis les sessions Copilot

Quand un `git push` vers `jm-parent/CreditsTracker` échoue avec un `403`
pour `jeanmarie-parent_exakisc`, ne pas enregistrer de token dans l'URL du
remote ou la configuration Git. Même après `gh auth switch`, Git Credential
Manager peut continuer a choisir cet identifiant non autorise.

Le `GH_TOKEN` d'environnement a priorite sur le compte gere par GitHub CLI :
le supprimer **avant** toute commande `gh`, sinon `gh auth switch` peut
echouer ou continuer a utiliser le mauvais compte.

```powershell
$env:GH_TOKEN = $null
rtk gh auth switch --hostname github.com --user jm-parent
rtk gh auth status --hostname github.com
rtk gh api repos/jm-parent/CreditsTracker/git/ref/heads/master --jq .object.sha
```

Comparer le SHA affiche avec le commit de base attendu avant de poursuivre.
S'il differe, s'arreter et demander confirmation. Apres accord, recuperer le
`master` courant, rebaser la branche, relancer les tests, puis pousser sans
jamais utiliser de push force.

Pour recuperer `master` sans persister le token, l'utiliser uniquement en
en-tete HTTP Basic temporaire :

```powershell
$token = rtk gh auth token --hostname github.com
$bytes = [Text.Encoding]::UTF8.GetBytes("x-access-token:$token")
$authorization = [Convert]::ToBase64String($bytes)
rtk git -c "http.extraheader=AUTHORIZATION: Basic $authorization" fetch origin master
$fetchExit = $LASTEXITCODE
Remove-Variable token, bytes, authorization
if ($fetchExit -ne 0) { exit $fetchExit }
rtk git rebase origin/master
npm test
```

Pour pousser une branche de PR, utiliser la branche courante comme source.
Ne pas pousser `HEAD:master` sauf demande explicite de mise a jour directe de
`master` :

```powershell
$env:GH_TOKEN = $null
$token = rtk gh auth token --hostname github.com
$bytes = [Text.Encoding]::UTF8.GetBytes("x-access-token:$token")
$authorization = [Convert]::ToBase64String($bytes)
rtk git -c "http.extraheader=AUTHORIZATION: Basic $authorization" push -u origin HEAD
$pushExit = $LASTEXITCODE
Remove-Variable token, bytes, authorization
exit $pushExit
```

Si le compte `jm-parent` est absent, si `gh auth token` echoue, ou si le push
est refuse, s'arreter et demander a l'utilisateur de reauthentifier ce compte.

Si la creation de PR via l'outil integre echoue avec un `403 Unauthorized`
(`Enterprise Managed User`), garder `GH_TOKEN` vide et utiliser GitHub CLI
avec le compte `jm-parent`, en ciblant explicitement `master` :

```powershell
$env:GH_TOKEN = $null
rtk gh pr create --repo jm-parent/CreditsTracker --base master `
  --head <branche> --title "<titre>" --body "<description>"
```

## Autres commandes utiles

    npm start            # app en mode dev
    npm test              # suite de tests vitest
    npm run make           # build les artefacts Squirrel Windows (out/make/squirrel.windows/x64/*)
