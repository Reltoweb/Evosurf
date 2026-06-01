# Public release repository files

Le repo du site `Reltoweb/autosurf` peut rester prive. Le repo public de releases `Reltoweb/Evosurf` doit contenir uniquement ce qui sert a builder et publier les visionneuses Windows, Linux headless et Docker.

## A copier dans le repo public

Copie ces chemins depuis le repo prive vers le repo public :

```text
.dockerignore
viewer-headless/public-repo/.github/workflows/viewer-headless-release.yml

electron/BUILD.md
electron/EvoSurf-Live.bat
electron/EvoSurf-Local.bat
electron/build-env.js
electron/build_obfuscated.js
electron/config.json.example
electron/convert_icon.js
electron/icon.ico
electron/icon.png
electron/main.js
electron/package.json
electron/package-lock.json
electron/preload.js
electron/secure_storage.js
electron/scripts/
electron/viewer-core/

viewer-headless/Dockerfile
viewer-headless/DOCKERHUB_README.md
viewer-headless/README.md
viewer-headless/docker-compose.release.yml
viewer-headless/docker-compose.example.yml
viewer-headless/package.json
viewer-headless/package-lock.json
viewer-headless/src/
viewer-headless/scripts/
```

Dans le repo public, le fichier :

```text
viewer-headless/public-repo/.github/workflows/viewer-headless-release.yml
```

doit etre place ici :

```text
.github/workflows/viewer-headless-release.yml
```

## A ne pas copier

Ne copie pas le code Laravel du site :

```text
app/
bootstrap/
config/
database/
public/
resources/
routes/
storage/
tests/
vendor/
.env
electron/config.json
electron/assets/
electron/build/
electron/default-client-url.js
electron/dist/
electron/node_modules/
viewer-headless/node_modules/
viewer-headless/profiles/
```

## Release

Dans le repo public, pousse un tag :

```bash
git tag viewer-v1.1.2
git push origin viewer-v1.1.2
```

Le workflow publie :

```text
EvoSurfViewer-win-1.1.2.exe
evosurf-viewer-headless-linux.tar.gz
evosurf/viewer:stable
evosurf/viewer:latest
evosurf/viewer:1.1.2
```

Le VPS doit utiliser `EVOSURF_RELEASE_REPOSITORY=Reltoweb/Evosurf`.
