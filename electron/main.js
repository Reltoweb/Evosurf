const { app, BrowserWindow, BrowserView, ipcMain, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const SecureStorage = require('./secure_storage');
const {
    CHROME_USER_AGENT,
    DEFAULT_REFERER,
    SEC_CH_UA,
    SEC_CH_UA_MOBILE,
    SEC_CH_UA_PLATFORM,
    DEVICE_PROFILES,
    runVisit,
    createElectronSurfAdapter
} = require('./viewer-core');

let autoUpdater;
try {
    autoUpdater = require('electron-updater').autoUpdater;
} catch (e) {
    console.warn('[AutoUpdate] electron-updater non disponible:', e.message);
}

// Initialize Secure Storage
let storage;
try {
    storage = new SecureStorage(app.getPath('userData'));
    ipcMain.handle('secure-save', (e, k, v) => storage.save(k, v));
    ipcMain.handle('secure-get', (e, k) => storage.get(k));
} catch (e) {
    console.error("SecureStorage init error:", e);
}
ipcMain.handle('get-app-version', () => app.getVersion());

// ---------------------------------------------------------------------------
// SÉCURITÉ — SUPPRIMÉ : app.commandLine.appendSwitch('ignore-certificate-errors')
//
// Ce switch désactivait la validation TLS GLOBALEMENT pour tout le processus
// Electron, y compris les connexions au serveur EvoSurf lui-même. Un attaquant
// MitM aurait pu intercepter les tokens d'authentification et les crédits.
//
// La gestion des erreurs TLS est désormais déléguée à la BrowserView via
// l'événement 'certificate-error' (voir setupSurfView), qui :
//   - Bloque les erreurs TLS sur la BrowserView (le site invalide est ignoré).
//   - Laisse Electron valider normalement les certificats du serveur EvoSurf.
// ---------------------------------------------------------------------------

let mainWindow;
let surfView;
let surfVisitSerial = 0;

let DEFAULT_CLIENT_URL;
try {
    DEFAULT_CLIENT_URL = require('./default-client-url.js');
} catch (e) {
    DEFAULT_CLIENT_URL = 'https://www.evosurf.fr/surf/client';
}

function getClientUrl() {
    const argUrl = process.argv.find(a => a.startsWith('--url='));
    if (argUrl) return argUrl.replace('--url=', '').trim();
    if (process.env.CLIENT_URL) return process.env.CLIENT_URL;
    try {
        // Chercher config.json : 1) à côté de l'exe (app installée), 2) dans le dossier de l'app (dev npm start)
        const pathsToTry = [
            path.join(path.dirname(app.getPath('exe')), 'config.json'),
            path.join(app.getAppPath(), 'config.json'),
            path.join(__dirname, 'config.json'),
        ];
        for (const configPath of pathsToTry) {
            if (fs.existsSync(configPath)) {
                const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                if (data.clientUrl && typeof data.clientUrl === 'string') return data.clientUrl;
            }
        }
    } catch (e) { /* ignore */ }
    return DEFAULT_CLIENT_URL;
}

let activeSurfNavigationProfile = DEVICE_PROFILES.desktop;
let activeSurfReferrer = null;

// Identifiant de partition pour la session isolée de la BrowserView surf.
// 'persist:' → la session est persistée sur disque mais reste cloisonnée
// du profil principal (defaultSession). Aucun cookie ni cache partagé.
const SURF_SESSION_PARTITION = 'persist:surf-isolated';

/**
 * Configure la session principale (defaultSession) pour masquer la signature
 * Electron sur toutes les requêtes de la mainWindow (connexion au serveur EvoSurf).
 */
function setupSessionStealth() {
    const sess = session.defaultSession;
    sess.setUserAgent(CHROME_USER_AGENT);

    sess.webRequest.onBeforeSendHeaders((details, callback) => {
        const headers = { ...details.requestHeaders };

        headers['User-Agent'] = CHROME_USER_AGENT;

        if (!headers['referer'] || headers['referer'].trim() === '') {
            headers['Referer'] = DEFAULT_REFERER;
        }

        headers['sec-ch-ua'] = SEC_CH_UA;
        headers['sec-ch-ua-mobile'] = SEC_CH_UA_MOBILE;
        headers['sec-ch-ua-platform'] = SEC_CH_UA_PLATFORM;

        if (details.resourceType === 'mainFrame') {
            headers['sec-fetch-site'] = 'cross-site';
            headers['sec-fetch-mode'] = 'navigate';
            headers['sec-fetch-dest'] = 'document';
        }

        const toRemove = [];
        for (const [key, value] of Object.entries(headers)) {
            if (value == null) continue;
            const v = String(value).toLowerCase();
            const k = String(key).toLowerCase();

            // NE PAS supprimer les en-têtes vitaux
            if (k === 'cookie' || k === 'origin' || k === 'referer' || k === 'host') continue;

            // NE PAS supprimer si l'en-tête contient l'URL de production légitime
            if (v.includes('evosurf.fr')) continue;

            if (v.includes('electron') || v.includes('evosurf')) {
                toRemove.push(key);
            }
        }
        toRemove.forEach(k => delete headers[k]);

        callback({ requestHeaders: headers });
    });
}

/**
 * Configure la session isolée de la BrowserView surf :
 *   - Masquage du User-Agent et du Referer (règle métier conservée)
 *   - Suppression des headers anti-iframe (règle métier conservée)
 *   - Blocage des téléchargements initiés par les sites visités
 */
function getHeaderKey(headers, headerName) {
    const lowerName = headerName.toLowerCase();
    return Object.keys(headers).find(key => key.toLowerCase() === lowerName);
}

function setHeader(headers, headerName, value) {
    const existingKey = getHeaderKey(headers, headerName);
    headers[existingKey || headerName] = value;
}

function deleteHeader(headers, headerName) {
    const existingKey = getHeaderKey(headers, headerName);
    if (existingKey) delete headers[existingKey];
}

function applySurfViewport(deviceProfile) {
    const viewport = deviceProfile.viewport || DEVICE_PROFILES.desktop.viewport;

    surfView.setBounds({
        x: -2500,
        y: 0,
        width: Math.max(320, Number(viewport.width) || DEVICE_PROFILES.desktop.viewport.width),
        height: Math.max(320, Number(viewport.height) || DEVICE_PROFILES.desktop.viewport.height)
    });
}

function waitForSurfViewToSettle(timeoutMs = 10000) {
    if (!surfView || surfView.webContents.isDestroyed()) {
        return Promise.resolve(false);
    }

    return new Promise((resolve) => {
        let settled = false;
        let quietTimer = null;

        const cleanup = (loaded) => {
            if (settled) return;
            settled = true;
            clearTimeout(quietTimer);
            clearTimeout(timeoutTimer);
            surfView.webContents.removeListener('did-finish-load', onLoaded);
            surfView.webContents.removeListener('did-stop-loading', onLoaded);
            surfView.webContents.removeListener('did-fail-load', onLoaded);
            resolve(loaded);
        };

        const onLoaded = () => cleanup(true);
        const timeoutTimer = setTimeout(() => cleanup(false), timeoutMs);

        surfView.webContents.once('did-finish-load', onLoaded);
        surfView.webContents.once('did-stop-loading', onLoaded);
        surfView.webContents.once('did-fail-load', onLoaded);

        quietTimer = setTimeout(() => {
            if (!surfView.webContents.isLoading()) cleanup(false);
        }, 1200);
    });
}

function emitSurfInteractionLog(payload) {
    const entry = {
        at: new Date().toISOString(),
        ...payload
    };

    console.log('[Surf][Interaction]', JSON.stringify(entry, null, 2));

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('surf-interaction-log', entry);
    }
}

function createSurfAdapter() {
    return createElectronSurfAdapter({
        getSurfView: () => surfView,
        setNavigationProfile: (deviceProfile, referrer) => {
            activeSurfNavigationProfile = deviceProfile;
            activeSurfReferrer = referrer;
        },
        setViewport: applySurfViewport,
        waitForSettle: waitForSurfViewToSettle
    });
}

function setupSurfSession() {
    const surfSess = session.fromPartition(SURF_SESSION_PARTITION);

    // ----- Stealth : User-Agent + Referer + Client Hints sur la session surf -----
    surfSess.setUserAgent(CHROME_USER_AGENT);

    surfSess.webRequest.onBeforeSendHeaders((details, callback) => {
        const headers = { ...details.requestHeaders };
        const profile = activeSurfNavigationProfile || DEVICE_PROFILES.desktop;
        const clientHints = profile.clientHints || DEVICE_PROFILES.desktop.clientHints;

        setHeader(headers, 'User-Agent', profile.userAgent || CHROME_USER_AGENT);

        // Appliquer le referrer defini pour la visite, ou le retirer en mode direct.
        if (details.resourceType === 'mainFrame') {
            if (activeSurfReferrer) {
                setHeader(headers, 'Referer', activeSurfReferrer);
            } else {
                deleteHeader(headers, 'Referer');
            }
        }

        setHeader(headers, 'sec-ch-ua', SEC_CH_UA);
        setHeader(headers, 'sec-ch-ua-mobile', clientHints.mobile || SEC_CH_UA_MOBILE);
        setHeader(headers, 'sec-ch-ua-platform', clientHints.platform || SEC_CH_UA_PLATFORM);

        if (details.resourceType === 'mainFrame') {
            headers['sec-fetch-site'] = 'cross-site';
            headers['sec-fetch-mode'] = 'navigate';
            headers['sec-fetch-dest'] = 'document';
        }

        // Supprimer toute trace Electron
        const toRemove = [];
        for (const [key, value] of Object.entries(headers)) {
            if (value == null) continue;
            const v = String(value).toLowerCase();
            const k = String(key).toLowerCase();
            if (k === 'cookie' || k === 'origin' || k === 'referer' || k === 'host') continue;
            if (v.includes('electron') || v.includes('evosurf')) toRemove.push(key);
        }
        toRemove.forEach(k => delete headers[k]);

        callback({ requestHeaders: headers });
    });

    // ----- Suppression des headers anti-iframe (règle métier) -----
    surfSess.webRequest.onHeadersReceived((details, callback) => {
        const responseHeaders = { ...details.responseHeaders };
        const headersToRemove = [
            'x-frame-options',
            'content-security-policy',
            'cross-origin-opener-policy',
            'cross-origin-embedder-policy',
        ];
        Object.keys(responseHeaders).forEach(header => {
            if (headersToRemove.includes(header.toLowerCase())) {
                delete responseHeaders[header];
            }
        });
        callback({ cancel: false, responseHeaders });
    });

    // ----- SÉCURITÉ : Blocage silencieux de tous les téléchargements -----
    // Un site malveillant pourrait tenter de forcer un téléchargement de fichier
    // (.exe, .bat, .zip…). On annule systématiquement sans interaction utilisateur.
    surfSess.on('will-download', (event, item) => {
        console.warn(`[Surf] Téléchargement bloqué : ${item.getURL()} (${item.getFilename()})`);
        item.cancel();
    });

    return surfSess;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 700,
        height: 650,
        title: "EvoSurf Viewer",
        icon: path.join(__dirname, 'icon.png'),
        backgroundColor: '#f8fafc',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            userAgent: CHROME_USER_AGENT
        }
    });

    const clientUrl = getClientUrl();
    mainWindow.setTitle('EvoSurf - ' + clientUrl);
    mainWindow.loadURL(clientUrl, { userAgent: CHROME_USER_AGENT });
    mainWindow.removeMenu(); // Désactiver le menu natif (Fichier, Édition, etc.)

    // Les liens externes dans la mainWindow (ex: mentions légales) s'ouvrent
    // dans le navigateur système et ne sont jamais chargés dans Electron.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        require('electron').shell.openExternal(url);
        return { action: 'deny' };
    });

    setupSurfView();

    if (autoUpdater) {
        checkUpdates().catch((err) => {
            console.error('[AutoUpdate] Erreur non gérée:', err?.message || err);
        });
    }
}

function checkUpdates() {
    if (!autoUpdater) {
        console.warn('[AutoUpdate] autoUpdater is not available - skipping update check');
        return;
    }

    console.log('[AutoUpdate] ===== INITIALIZING UPDATE CHECK =====');
    console.log('[AutoUpdate] App version:', app.getVersion());
    console.log('[AutoUpdate] App name:', app.getName());

    // Cibler explicitement le dépôt public des releases (Reltoweb/Evosurf)
    autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'Reltoweb',
        repo: 'Evosurf'
    });
    console.log('[AutoUpdate] Feed URL configured for: Reltoweb/Evosurf');

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    console.log('[AutoUpdate] autoDownload=true, autoInstallOnAppQuit=true');

    // Éviter que la vérification de signature bloque l'install (exe non signé ou erreur)
    try {
        autoUpdater.verifyUpdateCodeSignature = () => Promise.resolve(null);
        console.log('[AutoUpdate] Signature verification disabled');
    } catch (e) {
        console.warn('[AutoUpdate] Could not disable signature verification:', e.message);
    }

    autoUpdater.on('checking-for-update', () => {
        console.log('[AutoUpdate] Checking for update...');
    });

    autoUpdater.on('update-available', (info) => {
        console.log('[AutoUpdate] Update available:', info?.version || '');
    });

    autoUpdater.on('update-not-available', () => {
        console.log('[AutoUpdate] Update not available.');
    });

    autoUpdater.on('download-progress', (progress) => {
        console.log('[AutoUpdate] Download progress:', Math.round(progress.percent || 0) + '%');
    });

    autoUpdater.on('update-downloaded', (info) => {
        console.log('[AutoUpdate] ===== EVENT: update-downloaded FIRED =====');
        console.log('[AutoUpdate] Update info:', JSON.stringify(info || {}, null, 2));
        console.log('[AutoUpdate] mainWindow exists?', !!mainWindow);

        try {
            const result = dialog.showMessageBoxSync(mainWindow, {
                type: 'info',
                buttons: ['Redémarrer et Installer', 'Plus tard'],
                title: 'Mise à jour prête',
                message: "La nouvelle version est téléchargée. Vous pouvez l'installer maintenant, ou elle sera installée automatiquement à la fermeture de l'application.",
                defaultId: 0,
                cancelId: 1
            });

            console.log('[AutoUpdate] Dialog response:', result);
            console.log('[AutoUpdate] Response type:', typeof result);

            if (result === 0) {
                console.log('[AutoUpdate] User clicked INSTALL - starting shutdown sequence...');

                // Désactiver tous les listeners qui pourraient empêcher la fermeture
                console.log('[AutoUpdate] Removing all window-all-closed listeners...');
                app.removeAllListeners('window-all-closed');

                // On tue proprement la fenêtre et la vue
                if (mainWindow) {
                    console.log('[AutoUpdate] Removing close listeners from mainWindow...');
                    mainWindow.removeAllListeners('close');
                    console.log('[AutoUpdate] Destroying mainWindow...');
                    mainWindow.destroy();
                    mainWindow = null;
                }

                // Détacher la BrowserView
                if (surfView) {
                    console.log('[AutoUpdate] Destroying surfView...');
                    try {
                        surfView.webContents.destroy();
                    } catch (e) { /* ignore */ }
                    surfView = null;
                }

                // Wrapping dans setImmediate pour laisser le cycle d'événements se terminer
                setImmediate(() => {
                    console.log('[AutoUpdate] In setImmediate - calling quitAndInstall(false, true)...');
                    try {
                        // (false, true) = (isSilent=false → affiche l'installeur, isForceRunAfter=true)
                        autoUpdater.quitAndInstall(false, true);
                        console.log('[AutoUpdate] quitAndInstall called');

                        // Fallback : forcer app.quit() après un délai court si l'app tourne encore
                        setTimeout(() => {
                            console.log('[AutoUpdate] FALLBACK: Forcing app.quit()...');
                            app.quit();
                        }, 1000);
                    } catch (err) {
                        console.error('[AutoUpdate] ERROR calling quitAndInstall:', err);
                        console.log('[AutoUpdate] Forcing app.quit() due to error');
                        app.quit();
                    }
                });
            } else {
                console.log('[AutoUpdate] User clicked LATER - update will install on app quit');
            }
        } catch (err) {
            console.error('[AutoUpdate] ERROR in update-downloaded handler:', err);
            console.error('[AutoUpdate] Error stack:', err?.stack);
        }
    });

    autoUpdater.on('error', (err) => {
        console.error('[AutoUpdate] Erreur:', err?.message || err);
    });

    return autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        console.error('[AutoUpdate] checkForUpdatesAndNotify failed:', err?.message || err);
    });
}

/**
 * Crée et configure la BrowserView qui charge les sites tiers de l'autosurf.
 *
 * Architecture de sécurité :
 *   - Session cloisonnée (partition isolée) → aucun cookie/cache partagé avec mainWindow
 *   - nodeIntegration: false + contextIsolation: true → pas d'accès Node.js/filesystem
 *   - setWindowOpenHandler → toutes les pop-ups bloquées silencieusement
 *   - will-download → tous les téléchargements annulés silencieusement
 *   - setAudioMuted(true) → surf silencieux
 *   - certificate-error → erreurs TLS loguées mais non ignorées globalement ;
 *     le site avec SSL invalide reçoit une erreur dans la vue (comportement sain)
 */
function setupSurfView() {
    const surfSess = setupSurfSession();

    // -------------------------------------------------------------------------
    // SÉCURITÉ — Isolation stricte
    // nodeIntegration: false → le JS du site visité n'a AUCUN accès aux APIs Node
    // contextIsolation: true → le contexte preload est séparé du contexte web
    // sandbox: true → le renderer Chromium tourne dans un sandbox OS
    //
    // Note : aucun preload n'est injecté dans la surfView ; les sites tiers ne
    // doivent interagir avec aucune API Electron.
    // -------------------------------------------------------------------------
    surfView = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            session: surfSess,
            userAgent: CHROME_USER_AGENT,
            // Pas de preload : la surf view n'expose aucune API à la page visitée.
        }
    });

    mainWindow.setBrowserView(surfView);
    surfView.setBounds({ x: -2500, y: 0, width: 1280, height: 720 });

    // -------------------------------------------------------------------------
    // SÉCURITÉ — Silence total
    // Les sites visités ne doivent pas pouvoir diffuser de son sans consentement.
    // -------------------------------------------------------------------------
    surfView.webContents.setAudioMuted(true);

    // -------------------------------------------------------------------------
    // SÉCURITÉ — Blocage total des pop-ups
    // window.open(), target="_blank", window.location redirect vers une nouvelle
    // fenêtre : tout est bloqué. Aucune fenêtre externe n'est créée.
    // -------------------------------------------------------------------------
    surfView.webContents.setWindowOpenHandler(({ url }) => {
        console.warn(`[Surf] Pop-up bloquée : ${url}`);
        return { action: 'deny' };
    });

    // -------------------------------------------------------------------------
    // SÉCURITÉ — Gestion des erreurs TLS (certificats invalides)
    //
    // Contrairement à l'ancien 'ignore-certificate-errors' (global), ici on gère
    // les erreurs TLS AU NIVEAU de la surfView uniquement.
    //
    // Comportement choisi : laisser Chromium afficher sa page d'erreur native.
    // Le site avec un SSL invalide sera affiché comme "non sécurisé" dans la vue,
    // ce qui est correct. Le timer de visite ne se déclenchera pas (aucun JS
    // de la page ne s'exécutera), ce qui est acceptable pour un site invalide.
    //
    // Si vous souhaitez à l'avenir sauter ces sites automatiquement, vous pouvez
    // émettre un IPC vers mainWindow pour signaler l'échec TLS.
    // -------------------------------------------------------------------------
    surfView.webContents.on('certificate-error', (event, url, error, certificate, callback) => {
        console.warn(`[Surf] Erreur TLS bloquée pour ${url} — ${error}`);
        // callback(false) → Chromium bloque la navigation et affiche une erreur.
        // NE PAS appeler callback(true) ici, ce qui reviendrait à ignorer l'erreur.
        callback(false);
    });

    // Remonter les erreurs de chargement pour debug (timeout, DNS, etc.)
    surfView.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        if (errorCode !== -3) { // -3 = ERR_ABORTED (navigation annulée volontairement, normal)
            console.warn(`[Surf] Échec de chargement : ${validatedURL} — ${errorDescription} (${errorCode})`);
        }
    });
}

// ---------------------------------------------------------------------------
// IPC : Chargement d'URL dans la surf view
// Validation stricte du protocole avant tout loadURL.
// ---------------------------------------------------------------------------
ipcMain.on('start-visit', async (event, payload) => {
    try {
        const visitSerial = ++surfVisitSerial;
        await runVisit({
            payload,
            adapter: createSurfAdapter(),
            emitLog: emitSurfInteractionLog,
            isCurrent: () => visitSerial === surfVisitSerial
        });
    } catch (e) {
        console.error("[Electron] Load error:", e);
    }
});

ipcMain.on('stop-visit', () => {
    try {
        surfVisitSerial++;
        activeSurfNavigationProfile = DEVICE_PROFILES.desktop;
        activeSurfReferrer = null;
        if (surfView && !surfView.webContents.isDestroyed()) {
            createSurfAdapter().stop();
        }
    } catch (e) {
        console.error("[Electron] Stop visit error:", e);
    }
});

ipcMain.on('visit-duration-met', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('visit-success');
    }
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Quelqu'un a tenté de lancer une seconde instance : focus sur la fenêtre existante.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        setupSessionStealth();
        createWindow();
    });
}

// Fermeture normale : quitter quand toutes les fenêtres sont fermées.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
