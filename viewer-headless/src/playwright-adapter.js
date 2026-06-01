const { chromium } = require('playwright');
const {
    SEC_CH_UA,
    SEC_CH_UA_MOBILE,
    SEC_CH_UA_PLATFORM
} = require('../../electron/viewer-core');

function buildClientHintHeaders(deviceProfile = {}) {
    const hints = deviceProfile.clientHints || {};

    return {
        'sec-ch-ua': SEC_CH_UA,
        'sec-ch-ua-mobile': hints.mobile || SEC_CH_UA_MOBILE,
        'sec-ch-ua-platform': hints.platform || SEC_CH_UA_PLATFORM
    };
}

async function launchBrowser(config) {
    return chromium.launch({
        headless: config.headless,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding'
        ]
    });
}

function createPlaywrightSurfAdapter({ browser, config, logger }) {
    let context = null;
    let page = null;
    let deviceProfile = null;
    let referrer = null;
    let userAgent = null;
    let audioMuted = true;

    async function closeCurrentPage() {
        if (page) {
            const currentPage = page;
            page = null;
            await currentPage.close().catch(() => {});
        }

        if (context) {
            const currentContext = context;
            context = null;
            await currentContext.close().catch(() => {});
        }
    }

    return {
        async setAudioMuted(value) {
            audioMuted = value !== false;
        },

        async setNavigationProfile(nextDeviceProfile, nextReferrer) {
            deviceProfile = nextDeviceProfile || null;
            referrer = nextReferrer || null;
        },

        async setViewport(nextDeviceProfile) {
            deviceProfile = nextDeviceProfile || deviceProfile;
        },

        async setUserAgent(nextUserAgent) {
            userAgent = nextUserAgent || null;
        },

        async loadURL(url, options = {}) {
            await closeCurrentPage();

            const viewport = deviceProfile?.viewport || { width: 1280, height: 720 };
            const contextOptions = {
                userAgent: userAgent || options.userAgent || deviceProfile?.userAgent,
                viewport: {
                    width: viewport.width || 1280,
                    height: viewport.height || 720
                },
                deviceScaleFactor: viewport.deviceScaleFactor || 1,
                isMobile: Boolean(viewport.isMobile),
                hasTouch: Boolean(viewport.isMobile),
                javaScriptEnabled: true,
                ignoreHTTPSErrors: false,
                extraHTTPHeaders: buildClientHintHeaders(deviceProfile)
            };

            context = await browser.newContext(contextOptions);
            context.setDefaultNavigationTimeout(config.navigationTimeoutMs);
            context.setDefaultTimeout(config.navigationTimeoutMs);

            page = await context.newPage();
            page.setDefaultNavigationTimeout(config.navigationTimeoutMs);
            page.setDefaultTimeout(config.navigationTimeoutMs);

            page.on('popup', async popup => {
                await popup.close().catch(() => {});
            });

            page.on('download', async download => {
                await download.cancel().catch(() => {});
            });

            if (audioMuted && page.evaluate) {
                await page.addInitScript(() => {
                    Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
                        configurable: true,
                        get() {
                            return true;
                        },
                        set() {}
                    });
                }).catch(() => {});
            }

            logger.info('Chargement de la page', {
                url,
                viewport: contextOptions.viewport,
                isMobile: contextOptions.isMobile,
                referrer: options.httpReferrer || referrer || null
            });

            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: config.navigationTimeoutMs,
                referer: options.httpReferrer || referrer || undefined
            });
        },

        async waitForSettle(timeoutMs = 1200) {
            if (!page) return false;
            await page.waitForLoadState('load', { timeout: timeoutMs }).catch(() => {});
            await page.waitForTimeout(Math.min(Math.max(Number(timeoutMs) || 0, 0), 3000)).catch(() => {});
            return true;
        },

        async evaluate(script) {
            if (!page) {
                throw new Error('Aucune page active pour evaluate()');
            }

            return page.evaluate(script);
        },

        async stop() {
            await closeCurrentPage();
        }
    };
}

module.exports = {
    launchBrowser,
    createPlaywrightSurfAdapter
};
