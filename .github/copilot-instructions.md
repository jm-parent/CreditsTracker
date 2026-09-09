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
  génère `CHANGELOG.md`, build le zip Windows (`npm run make`), tague le
  commit et publie une GitHub Release avec le zip attaché.
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

Utiliser le compte `jm-parent` deja enregistre dans GitHub CLI, puis verifier
que la branche cible est toujours au commit de base attendu :

```powershell
$env:GH_TOKEN = $null
gh auth switch --hostname github.com --user jm-parent
gh api repos/jm-parent/CreditsTracker/git/ref/heads/master --jq .object.sha
```

Comparer le SHA affiche avec le commit de base attendu avant de poursuivre.
S'il differe, s'arreter : ne jamais utiliser de push force.

Pour pousser sans persister le token, l'utiliser uniquement en memoire dans un
en-tete HTTP Basic temporaire :

```powershell
$token = gh auth token --hostname github.com
$bytes = [Text.Encoding]::UTF8.GetBytes("x-access-token:$token")
$authorization = [Convert]::ToBase64String($bytes)
rtk git -c "http.extraheader=AUTHORIZATION: Basic $authorization" push origin HEAD:master
$pushExit = $LASTEXITCODE
Remove-Variable token, bytes, authorization
exit $pushExit
```

Si le compte `jm-parent` est absent, si `gh auth token` echoue, ou si le push
est refuse, s'arreter et demander a l'utilisateur de reauthentifier ce compte.

## Autres commandes utiles

    npm start            # app en mode dev
    npm test              # suite de tests vitest
    npm run make           # build le zip Windows (out/make/zip/win32/x64/*.zip)
