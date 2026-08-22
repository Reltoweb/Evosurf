const { withTimeout } = require('../timing');

function createElectronSurfAdapter({
    getSurfView,
    setNavigationProfile,
    setAllowedDomains,
    setViewport,
    waitForSettle,
    loadTimeoutMs = 30000,
    operationTimeoutMs = 30000,
    stopTimeoutMs = 5000
}) {
    const getWebContents = () => {
        const surfView = getSurfView();
        if (!surfView || surfView.webContents.isDestroyed()) {
            const error = new Error('Surf view indisponible');
            error.code = 'EVOSURF_SURF_VIEW_UNAVAILABLE';
            throw error;
        }
        return surfView.webContents;
    };

    return {
        setAudioMuted(muted) {
            getWebContents().setAudioMuted(muted);
        },

        setNavigationProfile(deviceProfile, referrer) {
            if (setNavigationProfile) {
                setNavigationProfile(deviceProfile, referrer);
            }
        },

        setAllowedDomains(allowedDomains, targetUrl) {
            if (setAllowedDomains) {
                setAllowedDomains(allowedDomains, targetUrl);
            }
        },

        setViewport(deviceProfile) {
            if (setViewport) {
                setViewport(deviceProfile);
            }
        },

        setUserAgent(userAgent) {
            getWebContents().setUserAgent(userAgent);
        },

        async loadURL(url, options) {
            const webContents = getWebContents();
            const timeout = Math.max(10, Number(loadTimeoutMs) || 30000);
            let timeoutId = null;

            try {
                return await Promise.race([
                    webContents.loadURL(url, options),
                    new Promise((resolve, reject) => {
                        timeoutId = setTimeout(() => {
                            try { webContents.stop(); } catch (error) { /* ignore */ }
                            const timeoutError = new Error(`Délai de chargement dépassé après ${timeout} ms`);
                            timeoutError.code = 'EVOSURF_LOAD_TIMEOUT';
                            reject(timeoutError);
                        }, timeout);
                    })
                ]);
            } finally {
                if (timeoutId) clearTimeout(timeoutId);
            }
        },

        evaluate(script) {
            const webContents = getWebContents();
            return withTimeout(
                webContents.executeJavaScript(script, true),
                operationTimeoutMs,
                'surf evaluate'
            );
        },

        waitForSettle(timeoutMs) {
            return waitForSettle ? waitForSettle(timeoutMs) : Promise.resolve(false);
        },

        stop() {
            const webContents = getWebContents();
            webContents.stop();
            return withTimeout(webContents.loadURL('about:blank'), stopTimeoutMs, 'surf stop').catch(() => {});
        }
    };
}

module.exports = {
    createElectronSurfAdapter
};
