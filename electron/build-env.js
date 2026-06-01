/**
 * Lit CLIENT_URL depuis le .env du projet (ou variable d'environnement)
 * et génère default-client-url.js pour le build Electron.
 * Permet d'avoir une URL par défaut différente en dev / prod selon le .env.
 * Supprime dist/ avant le build pour que la version et les fichiers viennent toujours de la racine.
 */
const fs = require('fs');
const path = require('path');

// Version : lire le package.json du dossier electron (pas app/, pas le projet Laravel)
const electronPkgPath = path.join(__dirname, 'package.json');
const electronPkg = JSON.parse(fs.readFileSync(electronPkgPath, 'utf8'));
console.log('Build version (electron/package.json):', electronPkg.version);

// Supprimer dist/ pour un build propre (version et icônes à jour)
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true });
    console.log('dist/ supprimé pour build propre');
}

const envPath = path.join(__dirname, '..', '.env');
const outPath = path.join(__dirname, 'default-client-url.js');

const FALLBACK = 'https://www.evosurf.fr/surf/client';

let url = process.env.CLIENT_URL || '';

if (!url && fs.existsSync(envPath)) {
    try {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/^\s*CLIENT_URL\s*=\s*(.+?)\s*$/m);
        if (match) {
            url = match[1].replace(/^["']|["']$/g, '').trim();
        }
    } catch (e) {
        // ignore
    }
}

if (!url || typeof url !== 'string') url = FALLBACK;
if (url.endsWith('/') && !url.endsWith('/surf/client')) url = url + 'surf/client';

const js = `// Généré par build-env.js - ne pas modifier à la main\nmodule.exports = ${JSON.stringify(url)};\n`;
fs.writeFileSync(outPath, js, 'utf8');
console.log('default-client-url.js écrit avec CLIENT_URL =', url);

// Copier icon.ico dans assets/ pour win.icon (NSIS) et dans build/ pour buildResources
const buildDir = path.join(__dirname, 'build');
const assetsDir = path.join(__dirname, 'assets');
if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
const iconIco = path.join(__dirname, 'icon.ico');
const iconPng = path.join(__dirname, 'icon.png');
if (fs.existsSync(iconIco)) {
    fs.copyFileSync(iconIco, path.join(buildDir, 'icon.ico'));
    fs.copyFileSync(iconIco, path.join(assetsDir, 'icon.ico'));
    console.log('icon.ico copié dans build/ et assets/');
}
if (fs.existsSync(iconPng)) {
    fs.copyFileSync(iconPng, path.join(buildDir, 'icon.png'));
    console.log('icon.png copié dans build/');
}

// Nom de l'exécutable Windows : EvoSurfViewer-win-{version}
const version = electronPkg.version || '1.1.0';
if (!electronPkg.build) electronPkg.build = {};
if (!electronPkg.build.win) electronPkg.build.win = {};
electronPkg.build.win.executableName = `EvoSurfViewer-win-${version}`;
fs.writeFileSync(electronPkgPath, JSON.stringify(electronPkg, null, 4), 'utf8');
console.log('executableName Windows = EvoSurfViewer-win-' + version);
