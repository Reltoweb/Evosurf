const { app, BrowserWindow, BrowserView, ipcMain, session, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ---------------------------------------------------------------------------
// FILTRE CONSOLE — masquer le bruit Electron non fatal
//
// Quand une URL de site surfé ne se résout pas (ex. ERR_NAME_NOT_RESOLVED sur
// des sites démo/non résolvables), Electron émet sur stderr une ligne bruyante
// du type « (node:PID) electron: Failed to load URL: ... ». Ces erreurs sont
// DÉJÀ gérées : le viewer les traite via did-fail-load + le rejet de loadURL
// dans le visit-runner, qui déclenche un retry sur le site suivant. Elles ne
// sont donc pas fatales, juste du bruit pour l'opérateur.
//
// On filtre ces lignes spécifiques au niveau du process stderr pour garder une
// console lisible (logs de visite INFO uniquement). On ne supprime PAS les
// autres erreurs (true errors, stack traces, etc.).
// ---------------------------------------------------------------------------
(function installErrorNoiseFilter() {
    const NOISE_PATTERNS = [
        /^\(node:\d+\) electron: Failed to load URL: .* with error: ERR_NAME_NOT_RESOLVED/i,
        /^\(node:\d+\) electron: Failed to load URL: .* with error: ERR_INTERNET_DISCONNECTED/i,
        /^\(node:\d+\) electron: Failed to load URL: .* with error: ERR_CONNECTION_/i,
        /^\(node:\d+\) electron: Failed to load URL: .* with error: ERR_TIMED_OUT/i,
    ];
    const isNoise = (line) => {
        if (typeof line !== 'string') return false;
        const trimmed = line.replace(/\r/g, '').trim();
        return NOISE_PATTERNS.some((re) => re.test(trimmed));
    };

    const origStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = function (chunk, encoding, callback) {
        if (isNoise(typeof chunk === 'string' ? chunk : chunk ? chunk.toString() : '')) {
            if (typeof callback === 'function') callback();
            return true;
        }
        return origStderrWrite(chunk, encoding, callback);
    };
})();
const SecureStorage = require('./secure_storage');
const {
    CHROME_USER_AGENT,
    DEFAULT_REFERER,
    SEC_CH_UA,
    SEC_CH_UA_MOBILE,
    SEC_CH_UA_PLATFORM,
    DEVICE_PROFILES,
    createAllowedDomainSet,
    inspectSurfNavigation,
    createLogger,
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
const debugInteractions = process.env.DEBUG_INTERACTIONS === 'true' || process.env.EVOSURF_DEBUG_INTERACTIONS === 'true';
let updaterLockPath = null;
let updaterLockOwned = false;
let updaterListenersConfigured = false;
let updateCheckInProgress = false;

// Les erreurs réseau natives de Chromium sont conservées en mode diagnostic,
// mais ne polluent pas le journal normal destiné aux visites.
if (!debugInteractions) {
    app.commandLine.appendSwitch('log-level', '3');
}

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
let activeSurfAllowedDomains = new Set();
let surfVisitCounter = 0;
const viewerLogger = createLogger('electron', { debug: debugInteractions, debugInteractions });
let connectionReadyLogged = false;

function logViewerStartup() {
    const bitness = process.arch === 'x64' ? '64-bit' : process.arch;
    const cpu = os.cpus()[0]?.model || 'Unknown CPU';

    viewerLogger.info('*'.repeat(80));
    viewerLogger.info(`Starting EvoSurf Viewer... [Version: ${app.getVersion()}] - ${bitness}`);
    viewerLogger.info('Mode: Visible');
    viewerLogger.info(`AutoUpdate is ${app.isPackaged && autoUpdater ? 'activated' : 'disabled (development mode)'}`);
    viewerLogger.info('Connecting instance...');
    viewerLogger.info('Get System Info');
    viewerLogger.info(`[CPU]: ${cpu}`);
    viewerLogger.info(`[Cores]: ${os.cpus().length || 1}`);
    viewerLogger.info(`[Memory]: ${Math.round(os.totalmem() / 1024 / 1024)}`);
    viewerLogger.info(`[OS]: ${os.platform()} ${os.arch()}`);
    viewerLogger.info(`[OS Version]: ${os.type()} ${os.release()}`);
    viewerLogger.info(`Version: ${app.getVersion()}`);
    viewerLogger.info('Get configuration...');
    viewerLogger.info('Checking connection...');
}

// Lorsqu'un lanceur fournit une clé par variable d'environnement, la mémoriser
// dans le stockage chiffré du profil courant avant de charger la connexion.
// La clé n'est jamais placée dans les arguments de la ligne de commande.
function saveLaunchAccessKey() {
    const accessKey = String(process.env.ACCESS_KEY || process.env.EVOSURF_ACCESS_KEY || '').trim();
    if (!accessKey || accessKey.length < 8 || !storage) return;

    storage.save('viewer_access_key', accessKey);
}

// Partition temporaire et isolée de la BrowserView surf. Elle n'est jamais
// réutilisée au prochain lancement : cookies et stockage des sites disparaissent.
const SURF_SESSION_PARTITION = 'surf-isolated';
const LEGACY_SURF_SESSION_PARTITION = 'persist:surf-isolated';

function setActiveSurfAllowedDomains(allowedDomains = [], targetUrl = null) {
    activeSurfAllowedDomains = createAllowedDomainSet(allowedDomains, targetUrl);
}

function sanitizeLogText(value, fallback = '', maxLength = 100) {
    const cleaned = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
    return (cleaned || fallback).slice(0, maxLength);
}

function hostnameForLog(url, fallback = 'site inconnu') {
    try {
        return sanitizeLogText(new URL(url).hostname, fallback);
    } catch (error) {
        return fallback;
    }
}

function blockUnsafeSurfNavigation(event, detailsOrUrl, requireAllowedDomain = true) {
    const details = typeof detailsOrUrl === 'string' ? { url: detailsOrUrl } : (detailsOrUrl || {});
    const result = inspectSurfNavigation(details.url || '', activeSurfAllowedDomains, requireAllowedDomain);
    if (result.allowed) return;

    event.preventDefault();
    const domain = hostnameForLog(details.url || '');
    emitSurfInteractionLog({
        type: 'security-block',
        action: 'navigation',
        reason: result.reason,
        domain,
    });
}

async function clearLegacySurfStorage() {
    const legacySession = session.fromPartition(LEGACY_SURF_SESSION_PARTITION);
    await legacySession.clearStorageData({
        storages: ['cookies', 'filesystem', 'indexdb', 'localstorage', 'serviceworkers', 'cachestorage'],
    });
    await legacySession.clearCache();
}

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

    if (debugInteractions) {
        console.log('[Surf][Interaction]', JSON.stringify(entry, null, 2));
    }

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
        setAllowedDomains: setActiveSurfAllowedDomains,
        setViewport: applySurfViewport,
        waitForSettle: waitForSurfViewToSettle,
        loadTimeoutMs: 30000,
    });
}

function setupSurfSession() {
    const surfSess = session.fromPartition(SURF_SESSION_PARTITION);

    // ----- Stealth : User-Agent + Referer + Client Hints sur la session surf -----
    surfSess.setUserAgent(CHROME_USER_AGENT);

    // Les sites autosurf sont non fiables et n'ont besoin d'aucune permission native.
    surfSess.setPermissionCheckHandler(() => false);
    surfSess.setPermissionRequestHandler((webContents, permission, callback, details) => {
        // storage-access est demandé couramment par Chromium pour les cookies
        // tiers. Il reste refusé, mais sans polluer les logs à chaque visite.
        if (permission !== 'storage-access') {
            emitSurfInteractionLog({
                type: 'security-block',
                action: 'permission',
                permission,
            });
        }
        callback(false);
    });
    surfSess.setDevicePermissionHandler(() => false);

    surfSess.on('will-download', (event, item, webContents) => {
        event.preventDefault();
        const domain = hostnameForLog(item?.getURL?.() || webContents?.getURL?.() || '');
        emitSurfInteractionLog({
            type: 'security-block',
            action: 'download',
            domain,
        });
    });

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
            backgroundThrottling: false,
            userAgent: CHROME_USER_AGENT
        }
    });

    const clientUrl = getClientUrl();
    mainWindow.setTitle('EvoSurf Viewer');

    const loadClient = async () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        try {
            await mainWindow.loadURL(clientUrl, { userAgent: CHROME_USER_AGENT });
        } catch (err) {
            // Une redirection interne (/surf/client -> /surf/client/auth) annule
            // la navigation précédente sans constituer une panne de démarrage.
            if (err?.code === 'ERR_ABORTED' || String(err?.message || '').includes('ERR_ABORTED')) {
                return;
            }
            console.error('[Startup] Impossible de charger la visionneuse:', err?.message || err);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('startup-error', err?.message || String(err));
            }
        }
    };

    mainWindow.loadFile(path.join(__dirname, 'splash.html'))
        .then(() => setTimeout(loadClient, 700))
        .catch((err) => {
            console.error('[Startup] Impossible de charger le splash:', err?.message || err);
            loadClient();
        });

    mainWindow.webContents.on('did-finish-load', () => {
        const loadedUrl = mainWindow?.webContents?.getURL?.() || '';
        if (!connectionReadyLogged && /^https?:\/\//i.test(loadedUrl)) {
            connectionReadyLogged = true;
            viewerLogger.info('Connection: Ready');
            viewerLogger.info('Surf is about to start');
        }
    });

    mainWindow.webContents.on('page-title-updated', (event) => {
        event.preventDefault();
        mainWindow.setTitle('EvoSurf Viewer');
    });
    mainWindow.removeMenu(); // Désactiver le menu natif (Fichier, Édition, etc.)

    // Les liens externes dans la mainWindow (ex: mentions légales) s'ouvrent
    // dans le navigateur système et ne sont jamais chargés dans Electron.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        try {
            const parsed = new URL(url);
            if (['http:', 'https:'].includes(parsed.protocol)) {
                shell.openExternal(parsed.toString());
            }
        } catch (error) {
            console.warn(`[Main] Lien externe invalide bloqué : ${url}`);
        }
        return { action: 'deny' };
    });

    setupSurfView();

    if (autoUpdater) {
        setTimeout(() => {
            void checkUpdates();
        }, 8000);
    }
}

function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return false;
    }
}

function acquireUpdaterLock() {
    if (updaterLockOwned) return true;

    updaterLockPath = path.join(app.getPath('appData'), 'EvoSurf-updater.lock');
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const descriptor = fs.openSync(updaterLockPath, 'wx');
            fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, createdAt: Date.now() }), 'utf8');
            fs.closeSync(descriptor);
            updaterLockOwned = true;
            return true;
        } catch (error) {
            if (error?.code !== 'EEXIST') return false;

            try {
                const lock = JSON.parse(fs.readFileSync(updaterLockPath, 'utf8'));
                if (isProcessAlive(Number(lock?.pid))) return false;
                fs.unlinkSync(updaterLockPath);
            } catch (readError) {
                try { fs.unlinkSync(updaterLockPath); } catch (unlinkError) { return false; }
            }
        }
    }

    return false;
}

function releaseUpdaterLock() {
    if (!updaterLockOwned || !updaterLockPath) return;
    try {
        const lock = JSON.parse(fs.readFileSync(updaterLockPath, 'utf8'));
        if (Number(lock?.pid) === process.pid) fs.unlinkSync(updaterLockPath);
    } catch (error) { /* ignore */ }
    updaterLockOwned = false;
}

function configureUpdaterListeners() {
    if (updaterListenersConfigured || !autoUpdater) return;
    updaterListenersConfigured = true;

    // Les événements utiles sont journalisés par EvoSurf. Le logger interne de
    // electron-updater est volontairement silencieux pour éviter les doublons.
    autoUpdater.logger = {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
    };
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
        viewerLogger.info(`Update ${info?.version || 'disponible'} found; download starting`);
    });

    autoUpdater.on('update-downloaded', (info) => {
        viewerLogger.info(`Update ${info?.version || ''} ready to install`);
        try {
            const result = dialog.showMessageBoxSync(mainWindow, {
                type: 'info',
                buttons: ['Redémarrer et installer', 'Plus tard'],
                title: 'Mise à jour prête',
                message: "La nouvelle version est téléchargée. Vous pouvez l'installer maintenant, ou elle sera installée automatiquement à la fermeture de l'application.",
                defaultId: 0,
                cancelId: 1
            });

            if (result !== 0) return;

            app.removeAllListeners('window-all-closed');
            if (mainWindow) {
                mainWindow.removeAllListeners('close');
                mainWindow.destroy();
                mainWindow = null;
            }
            if (surfView) {
                try { surfView.webContents.destroy(); } catch (error) { /* ignore */ }
                surfView = null;
            }

            setImmediate(() => {
                try {
                    autoUpdater.quitAndInstall(false, true);
                    setTimeout(() => app.quit(), 1000);
                } catch (error) {
                    viewerLogger.error(`Update installation failed: ${error?.message || error}`);
                    app.quit();
                }
            });
        } catch (error) {
            viewerLogger.error(`Update dialog failed: ${error?.message || error}`);
        }
    });

    autoUpdater.on('error', (error) => {
        viewerLogger.debug(`Update unavailable: ${error?.message || error}`);
    });
}

async function checkUpdates() {
    if (!app.isPackaged || !autoUpdater || updateCheckInProgress) return null;

    const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml');
    if (!fs.existsSync(updateConfigPath)) {
        viewerLogger.debug('AutoUpdate skipped: packaged test build without app-update.yml');
        return null;
    }

    // Plusieurs profils peuvent surfer simultanément, mais une seule instance
    // par machine doit télécharger et préparer la mise à jour.
    if (!acquireUpdaterLock()) return null;

    configureUpdaterListeners();
    updateCheckInProgress = true;
    try {
        const result = await autoUpdater.checkForUpdates();
        if (result?.isUpdateAvailable) {
            await autoUpdater.downloadUpdate(result.cancellationToken);
        }
        return result;
    } catch (error) {
        viewerLogger.warn(`Update check failed: ${error?.message || error}`);
        return null;
    } finally {
        updateCheckInProgress = false;
    }
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
            disableDialogs: true,
            navigateOnDragDrop: false,
            autoplayPolicy: 'document-user-activation-required',
            session: surfSess,
            backgroundThrottling: false,
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
        const domain = hostnameForLog(url);
        emitSurfInteractionLog({
            type: 'security-block',
            action: 'popup',
            domain,
        });
        return { action: 'deny' };
    });

    surfView.webContents.on('will-navigate', (event, detailsOrUrl) => {
        blockUnsafeSurfNavigation(event, detailsOrUrl, true);
    });

    surfView.webContents.on('will-redirect', (event, detailsOrUrl) => {
        const details = typeof detailsOrUrl === 'string'
            ? { url: detailsOrUrl, isMainFrame: true }
            : (detailsOrUrl || {});
        blockUnsafeSurfNavigation(event, details, details.isMainFrame !== false);
    });

    surfView.webContents.on('will-frame-navigate', (event, details) => {
        blockUnsafeSurfNavigation(event, details, details?.isMainFrame === true);
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
        emitSurfInteractionLog({
            type: 'security-block',
            action: 'certificate',
            error,
            domain: hostnameForLog(url),
        });
        // callback(false) → Chromium bloque la navigation et affiche une erreur.
        // NE PAS appeler callback(true) ici, ce qui reviendrait à ignorer l'erreur.
        callback(false);
    });

    // Remonter les erreurs de chargement pour debug (timeout, DNS, etc.)
    surfView.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        if (errorCode !== -3) { // -3 = ERR_ABORTED (navigation annulée volontairement, normal)
            viewerLogger.debug(`Load failed: ${hostnameForLog(validatedURL)} — ${errorDescription} (${errorCode})`);
        }
    });
}

// ---------------------------------------------------------------------------
// IPC : Chargement d'URL dans la surf view
// Validation stricte du protocole avant tout loadURL.
// ---------------------------------------------------------------------------
ipcMain.on('start-visit', async (event, payload) => {
    const visitSerial = ++surfVisitSerial;
    let pageReadySent = false;
    try {
        await runVisit({
            payload,
            adapter: createSurfAdapter(),
            emitLog: emitSurfInteractionLog,
            isCurrent: () => visitSerial === surfVisitSerial,
            onPageReady: () => {
                if (pageReadySent || visitSerial !== surfVisitSerial || !mainWindow || mainWindow.isDestroyed()) {
                    return;
                }

                pageReadySent = true;
                const metadata = payload?.metadata || {};
                const duration = Math.max(0, Number(metadata.duration) || 0);
                const pointsValue = Math.max(0, Number(metadata.creditsExpected) || 0);
                const points = pointsValue.toFixed(2).replace(/\.?0+$/, '');
                const url = sanitizeLogText(payload?.target?.url || payload?.url, 'URL inconnue', 2048);

                surfVisitCounter++;
                viewerLogger.visit(surfVisitCounter, points, duration, url);
                mainWindow.webContents.send('visit-ready');
            }
        });
    } catch (e) {
        viewerLogger.debug(`Mission failed: ${e?.message || e || 'Unknown error'}`);
        if (!pageReadySent && visitSerial === surfVisitSerial && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('visit-failed', {
                message: e?.message || String(e),
                code: e?.code || null,
                url: payload?.target?.url || payload?.url || null,
            });
        }
    }
});

ipcMain.on('stop-visit', () => {
    try {
        surfVisitSerial++;
        activeSurfNavigationProfile = DEVICE_PROFILES.desktop;
        activeSurfReferrer = null;
        activeSurfAllowedDomains = new Set();
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
        logViewerStartup();
        saveLaunchAccessKey();
        setupSessionStealth();
        clearLegacySurfStorage().catch((error) => {
            console.warn('[Surf] Nettoyage de l’ancienne session isolée impossible :', error?.message || error);
        });
        createWindow();
    });
}

// Fermeture normale : quitter quand toutes les fenêtres sont fermées.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    releaseUpdaterLock();
});
