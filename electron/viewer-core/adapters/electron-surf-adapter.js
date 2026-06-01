function createElectronSurfAdapter({
    getSurfView,
    setNavigationProfile,
    setViewport,
    waitForSettle
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

        setViewport(deviceProfile) {
            if (setViewport) {
                setViewport(deviceProfile);
            }
        },

        setUserAgent(userAgent) {
            getWebContents().setUserAgent(userAgent);
        },

        loadURL(url, options) {
            return getWebContents().loadURL(url, options);
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
