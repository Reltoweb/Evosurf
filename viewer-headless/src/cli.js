const { ApiClient } = require('./api-client');
const { assertConfig, readConfig } = require('./config');
const { createLogger } = require('./logger');
const { createPlaywrightSurfAdapter, launchBrowser } = require('./playwright-adapter');
const { checkForUpdate, scheduleUpdateChecks } = require('./update-checker');
const { delay, runVisit } = require('../../electron/viewer-core');

function getAllowedDomainsForUrl(url) {
    try {
        return [new URL(url).hostname].filter(Boolean);
    } catch (error) {
        return [];
    }
}

function buildVisitConfigFromApi(data) {
    const apiConfig = data.navigation_config || data.viewer_config || null;

    if (apiConfig && typeof apiConfig === 'object') {
        const target = {
            ...(apiConfig.target || {}),
            url: apiConfig.target?.url || data.url
        };

        if (!target.allowedDomains || target.allowedDomains.length === 0) {
            target.allowedDomains = getAllowedDomainsForUrl(target.url);
        }

        return {
            ...apiConfig,
            target,
            device: apiConfig.device || { type: 'desktop' },
            referrer: apiConfig.referrer || { mode: 'direct' },
            interactions: apiConfig.interactions || {
                probabilities: { none: 100, scroll: 0, click: 0 }
            }
        };
    }

    return {
        target: {
            url: data.url,
            allowedDomains: getAllowedDomainsForUrl(data.url)
        },
        device: data.device || { type: 'desktop' },
        referrer: data.referrer || { mode: 'direct' },
        interactions: data.interactions || {
            probabilities: { none: 100, scroll: 0, click: 0 },
            scroll: {
                minDistancePx: 600,
                maxDistancePx: 2400,
                minDurationMs: 2500,
                maxDurationMs: 9000
            },
            click: {
                selectors: [],
                fallbackToRandomLink: false,
                randomPageClick: true,
                preventNewWindow: true,
                scrollIntoViewBeforeClick: true,
                highlightBeforeClick: true
            }
        },
        timing: {
            waitAfterLoadMs: Number(data.wait_after_load_ms) || 1500
        }
    };
}

function normalizeDurationSeconds(value) {
    const duration = Number(value);
    if (!Number.isFinite(duration)) return 15;
    return Math.max(5, Math.min(duration, 3600));
}

async function runWorker() {
    const config = readConfig();
    assertConfig(config);

    const logger = createLogger(`headless:${config.sessionId}`);
    const api = new ApiClient(config, logger);

    let stopping = false;
    let browser = null;
    let activeAdapter = null;

    async function shutdown(signal) {
        if (stopping) return;
        stopping = true;
        logger.warn(`Arret demande (${signal})`);

        if (activeAdapter) {
            await activeAdapter.stop().catch(() => {});
        }

        if (browser) {
            await browser.close().catch(() => {});
        }
    }

    process.on('SIGINT', () => {
        shutdown('SIGINT').finally(() => process.exit(0));
    });

    process.on('SIGTERM', () => {
        shutdown('SIGTERM').finally(() => process.exit(0));
    });

    logger.info('Demarrage du worker EvoSurf headless', {
        baseUrl: config.baseUrl,
        sessionId: config.sessionId,
        appVersion: config.appVersion,
        headless: config.headless,
        viewerRuntime: config.viewerRuntime,
        viewerPlatform: config.viewerPlatform
    });

    await checkForUpdate(config, logger).catch(error => {
        logger.warn('Verification de mise a jour impossible', {
            message: error.message
        });
    });
    scheduleUpdateChecks(config, logger);

    browser = await launchBrowser(config);

    while (!stopping) {
        let mission = null;

        try {
            mission = await api.getNextVisit();
        } catch (error) {
            const waitMs = error.status === 503 ? config.pollDelayMs : Math.max(config.pollDelayMs, 10000);
            logger.warn('Impossible de recuperer une mission', {
                status: error.status || null,
                message: error.message,
                waitMs
            });
            await delay(waitMs);
            continue;
        }

        if (!mission?.url || !mission?.view_token) {
            logger.info('Aucune visite disponible', {
                duration: mission?.duration || 0
            });
            await delay(config.pollDelayMs);
            continue;
        }

        const durationSeconds = normalizeDurationSeconds(mission.duration);
        activeAdapter = createPlaywrightSurfAdapter({ browser, config, logger });

        logger.info('Mission recue', {
            url: mission.url,
            durationSeconds
        });

        try {
            const visitConfig = buildVisitConfigFromApi(mission);
            const visitTask = runVisit({
                payload: visitConfig,
                adapter: activeAdapter,
                emitLog: payload => logger.interaction(payload),
                isCurrent: () => !stopping
            });
            const durationTask = delay(durationSeconds * 1000);

            await Promise.all([visitTask, durationTask]);

            if (stopping) {
                break;
            }

            const validation = await api.validateVisit(mission.view_token);
            logger.info('Visite validee', {
                creditsEarned: validation.credits_earned ?? null,
                status: validation.status || 'success'
            });
        } catch (error) {
            logger.error('Echec de la mission', {
                message: error.message,
                url: mission.url
            });
        } finally {
            if (activeAdapter) {
                await activeAdapter.stop().catch(() => {});
                activeAdapter = null;
            }
        }

        await delay(config.loopDelayMs);
    }
}

runWorker().catch(error => {
    console.error('[viewer-headless] Erreur fatale', error);
    process.exit(1);
});
