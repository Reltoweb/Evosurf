function createElectronSurfAdapter({
    getSurfView,
    setNavigationProfile,
    setAllowedDomains,
    setViewport,
    waitForSettle,
    loadTimeoutMs = 30000
}) {
    const getWebContents = () => {
        const surfView = getSurfView();
        if (!surfView || surfView.webContents.isDestroyed()) {
            throw new Error('Surf view indisponible');
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
            return getWebContents().executeJavaScript(script, true);
        },

        waitForSettle(timeoutMs) {
            return waitForSettle ? waitForSettle(timeoutMs) : Promise.resolve(false);
        },

        stop() {
            const webContents = getWebContents();
            webContents.stop();
            return webContents.loadURL('about:blank').catch(() => {});
        }
    };
}

module.exports = {
    createElectronSurfAdapter
};
