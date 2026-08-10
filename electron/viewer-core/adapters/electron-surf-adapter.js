function createElectronSurfAdapter({
    getSurfView,
    setNavigationProfile,
    setAllowedDomains,
    setViewport,
    waitForSettle,
    shouldRecoverBlockedNavigation
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

            try {
                return await webContents.loadURL(url, options);
            } catch (error) {
                if (!shouldRecoverBlockedNavigation || !shouldRecoverBlockedNavigation(error)) {
                    throw error;
                }

                // Une redirection principale vers un domaine externe a été
                // bloquée. Afficher une vue neutre, puis laisser la visite et
                // son compteur continuer normalement.
                await webContents.loadURL('about:blank').catch(() => {});
                return null;
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
