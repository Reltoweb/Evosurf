# Générer l’exécutable (.exe) EvoSurf

Le dossier **`dist/`** (où se trouve l’installateur et le .exe) n’est pas sur GitHub (voir `.gitignore`). Pour le recréer sur ta machine :

## Prérequis

- Node.js installé
- Dans le dossier **`electron`** : `npm install`

## Version de l'app

La version affichée vient **uniquement** du **`package.json` à la racine** de `electron/`.  
Le dossier **`app/`** est généré par `build:secure` (obfuscation) et peut contenir une ancienne version.

- **Pour que la version soit bien prise en compte** : modifie **`electron/package.json`** (champ `"version"`), puis lance **`npm run build`**. Le script supprime `dist/` avant chaque build, donc la version du .exe sera celle du `package.json` racine.
- Si tu as déjà fait un build et que la version ne change pas : lance **`npm run build:clean`** (supprime `dist/` et `app/`, puis rebuild). Ainsi aucun fichier ancien n'interfère.

## Logo / icône du .exe

Le .exe utilise **`icon.ico`** (pas seulement `icon.png`). Pour avoir ton logo sur l’exe :

1. Mets ton logo en **`electron/icon.png`** (carré, par ex. 256×256 ou 512×512).
2. Régénère l’icône Windows :  
   `npm run icon`  
   (ça lance `convert_icon.js` et recrée `icon.ico` à partir de `icon.png`).
3. Rebuild :  
   `npm run build`

Tu peux copier le logo du site depuis `public/images/logo.png` vers `electron/icon.png` si c’est le bon visuel.

**Transparence (fond carré / damier)** : sous Windows, l'icône du .exe gère mal la transparence (fond noir ou damier). C'est une limite de l'affichage des icônes .ico. Pour un rendu propre, utilise un **fond uni** (ex. blanc ou couleur de ton app) dans `icon.png` avant de lancer `npm run icon`.

**Si l’exe affiche encore l’ancienne icône** :
1. Supprime le dossier **`electron/dist/`** puis refais **`npm run build`** (le script copie tes `icon.ico` / `icon.png` dans **`build/`** avant le build, c’est là qu’electron-builder les prend pour l’exe).
2. Vide le cache electron-builder : supprime le dossier **`%LOCALAPPDATA%\electron-builder\Cache`** (ou lance **`npm run build -- --clean`** si disponible), puis rebuild.
3. Windows met en cache les icônes : déplace l’exe dans un autre dossier ou redémarre l’Explorateur pour voir la nouvelle icône.

## Commandes

```bash
cd electron
npm install
npm run icon
npm run build
```

Après le build :

- **`electron/dist/win-unpacked/`** contient **EvoSurfViewer-win-{version}.exe** (ex. `EvoSurfViewer-win-1.1.0.exe`) et les fichiers nécessaires (DLL, ffmpeg, etc.). Lance cet exe pour ouvrir le client.

**Important – ffmpeg.dll / déplacer l’exe** : le .exe a besoin des DLL (dont **ffmpeg.dll**) qui sont dans le même dossier.  
- **Ne copie pas uniquement** l’exe (par ex. sur le Bureau) : tu aurais « ffmpeg.dll introuvable ».  
- **À faire** : copie **tout le dossier** `dist/win-unpacked/` (exe, ffmpeg.dll, etc.) là où tu veux, ou crée un **raccourci** vers l’exe dans ce dossier.

## URL par défaut (prod / dev)

L'URL du client est lue **au moment du build** depuis le **`.env`** du projet (clé **`CLIENT_URL`**). Si aucune valeur n'est trouvée, le build utilise maintenant l'URL de production : `https://www.evosurf.fr/surf/client`.

- En **local** : laisser `CLIENT_URL=https://localhost/evosurf/public/` (ou avec `/surf/client`) dans `.env`, puis `npm run build` → l’exe utilisera cette URL par défaut.
- En **prod** : mettre `CLIENT_URL=https://www.evosurf.fr/surf/client` dans `.env`, puis builder → l'exe utilisera l'URL de prod.

Le script **`build-env.js`** génère **`default-client-url.js`** à partir du `.env` avant chaque build, y compris `npm run build:secure` / `npm run deploy`. Tu peux aussi lancer `node build-env.js` puis `npm run build` si tu as changé le `.env`.

En **runtime**, l’exe peut encore être surchargé par un **`config.json`** à côté de l’exe ou par la variable d’environnement **`CLIENT_URL`**.

## Si l’app affiche « 404 Not Found »

- **Laravel doit tourner** et être accessible à l’URL configurée (celle du `.env` au build, ou celle dans `config.json`).
- Si tu utilises une autre URL (ex. `http://evosurf.test/surf/client`), crée un fichier **`config.json`** **à côté de l’exe** (dans le même dossier que EvoSurfViewer-win-*.exe) avec :

```json
{
  "clientUrl": "http://evosurf.test/surf/client"
}
```

Tu peux t’inspirer de **`config.json.example`** dans le dossier `electron/`. Après modification, relance l’exe (pas besoin de rebuild).

## Variantes

- **`npm run pack`** : idem `npm run build` (target = dir).
- **`npm run build:secure`** : build avec code obfusqué (pour distribution).
