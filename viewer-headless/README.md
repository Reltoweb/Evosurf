# EvoSurf Headless Viewer

Worker Linux/Docker base sur Playwright + Chromium headless. Il reutilise le moteur commun `electron/viewer-core`, donc les visites Windows et headless partagent la meme logique de device, referrer, scroll et clic.

## Variables

- `EVOSURF_BASE_URL`: URL du site, par exemple `https://www.evosurf.fr` ou `http://127.0.0.1:8000`.
- `ACCESS_KEY`: cle d'acces du compte visionneur.
- `SESSION_ID`: identifiant unique de l'instance, par exemple `vps-1-viewer-1`.
- `APP_VERSION`: version remontee cote serveur, par defaut celle du package.
- `VIEWER_RUNTIME`: `headless` en lancement direct, `docker` dans l'image Docker.
- `VIEWER_PLATFORM`: plateforme remontee aux stats, par exemple `linux` ou `win32`.
- `UPDATE_CHECK_ENABLED`: active le check de mise a jour GitHub, `true` par defaut.
- `UPDATE_EXIT_ON_AVAILABLE`: met le worker en pause si une version existe. Utile avec systemd + `ExecStartPre`.
- `UPDATE_CHECK_INTERVAL_MS`: intervalle de check pendant l'execution. `3600000` = 1 heure.
- `EVOSURF_RELEASE_REPOSITORY`: depot GitHub public qui heberge les releases, par defaut `Reltoweb/Evosurf`.
- `HEADLESS`: `true` par defaut. Mettre `false` pour debug avec fenetre.
- `POLL_DELAY_MS`: attente quand aucune visite n'est disponible.
- `NAVIGATION_TIMEOUT_MS`: timeout de navigation Chromium.

## Test sans Docker

Depuis PowerShell :

```powershell
cd C:\laragon\www\evosurfv3\viewer-headless
npm install
npm run smoke:local
$env:EVOSURF_BASE_URL = "https://www.evosurf.fr"
$env:ACCESS_KEY = "TA_CLE_ACCESS"
$env:SESSION_ID = "windows-headless-test-1"
npm start
```

Pour tester sur ton Laravel local, remplace `EVOSURF_BASE_URL` par `http://127.0.0.1:8000`.

Si Playwright indique que Chromium manque, lance :

```powershell
npx playwright install chromium
```

## Test Docker

Depuis la racine du projet :

```powershell
docker build -f viewer-headless/Dockerfile -t evosurf-viewer-headless .
docker run --rm -e EVOSURF_BASE_URL=https://www.evosurf.fr -e ACCESS_KEY=TA_CLE_ACCESS -e SESSION_ID=vps-viewer-1 evosurf-viewer-headless
```

## Plusieurs visionneuses

Chaque instance doit avoir son propre `SESSION_ID`. Pour Docker Compose :

```powershell
docker compose -f viewer-headless/docker-compose.example.yml up --build
```

Duplique les services `viewer-1`, `viewer-2`, etc. avec des `SESSION_ID` differents. Tu peux utiliser la meme `ACCESS_KEY`, mais des comptes/cles separes permettront des statistiques plus propres.

## Publication GitHub publique

Le VPS n'a pas besoin du dossier complet `evosurfv3`. Il doit seulement pouvoir lire un depot GitHub public qui heberge les releases.

Le repo prive du site `Reltoweb/autosurf` peut rester prive. Le repo public de releases `Reltoweb/Evosurf` doit recevoir uniquement les fichiers listes dans `viewer-headless/PUBLIC_RELEASE_FILES.md`.

Publie une release GitHub avec :

- `EvoSurfViewer-win-1.1.6.exe` pour Windows.
- `dist/evosurf-viewer-headless-linux.tar.gz` pour Linux direct.
- l'image Docker `evosurf/viewer:stable` pour Docker.

Le workflow fourni dans `viewer-headless/public-repo/.github/workflows/viewer-headless-release.yml` doit etre copie dans le repo public a l'emplacement `.github/workflows/viewer-headless-release.yml`. Il genere les assets automatiquement quand tu pousses un tag :

```bash
git tag viewer-v1.1.6
git push origin viewer-v1.1.6
```

Le tag doit rester au format `viewer-vX.Y.Z`, par exemple `viewer-v1.1.6`.

## Installation Linux sans Docker

Sur Ubuntu 24.04, installe les dependances minimales :

```bash
sudo apt update
sudo apt install -y curl tar python3 nodejs npm
```

Puis installe la derniere release :

```bash
sudo mkdir -p /opt/evosurf-viewer-headless
sudo EVOSURF_RELEASE_REPOSITORY=Reltoweb/Evosurf EVOSURF_INSTALL_DIR=/opt/evosurf-viewer-headless bash -c "$(curl -fsSL https://raw.githubusercontent.com/Reltoweb/Evosurf/main/viewer-headless/scripts/update-headless-linux.sh)"
```

Cree ensuite `/opt/evosurf-viewer-headless/.env` :

```env
EVOSURF_BASE_URL=https://www.evosurf.fr
ACCESS_KEY=TA_CLE_ACCESS
SESSION_ID=vps-1-linux-1
APP_VERSION=1.1.6
VIEWER_RUNTIME=headless
VIEWER_PLATFORM=linux
UPDATE_CHECK_ENABLED=true
UPDATE_EXIT_ON_AVAILABLE=true
UPDATE_CHECK_INTERVAL_MS=3600000
EVOSURF_RELEASE_REPOSITORY=Reltoweb/Evosurf
```

Copie le service systemd :

```bash
sudo cp /opt/evosurf-viewer-headless/viewer-headless/scripts/evosurf-viewer-headless.service.example /etc/systemd/system/evosurf-viewer-headless.service
sudo systemctl daemon-reload
sudo systemctl enable --now evosurf-viewer-headless
```

Avec cette configuration, le service lance `update-headless-linux.sh` avant chaque demarrage. Si le worker detecte une nouvelle version pendant qu'il tourne, il s'arrete, systemd le relance, puis `ExecStartPre` installe la nouvelle release.

## Installation Docker

Le conteneur Docker utilise l'image publique `evosurf/viewer:stable` depuis Docker Hub.

Sur le VPS :

```bash
mkdir -p ~/evosurf-viewer
cd ~/evosurf-viewer
curl -fsSL https://raw.githubusercontent.com/Reltoweb/Evosurf/main/viewer-headless/docker-compose.release.yml -o docker-compose.yml
```

Creer ensuite un fichier `.env` avec la cle d'acces :

```bash
ACCESS_KEY=TA_CLE_ACCESS
```

Puis lance :

```bash
docker compose up -d
```

Pour mettre a jour plus tard, relance :

```bash
docker compose pull
docker compose up -d
```
