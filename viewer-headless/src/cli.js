const { ApiClient } = require('./api-client');
const { assertConfig, readConfig } = require('./config');
const { createLogger } = require('./logger');
const { createPlaywrightSurfAdapter, launchBrowser } = require('./playwright-adapter');
const { checkForUpdate, scheduleUpdateChecks } = require('./update-checker');
const { delay, runVisit } = require('../../electron/viewer-core');
const os = require('os');

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

function getBitnessLabel() {
    return process.arch.includes('64') ? '64 Bits' : '32 Bits';
}

function getPlatformLabel(config) {
    const runtime = String(config.viewerRuntime || '').toLowerCase();
    if (runtime === 'docker') return 'docker';
    return String(config.viewerPlatform || process.platform || 'unknown').toLowerCase();
}

function formatPoints(value) {
    const points = Number(value);
    if (!Number.isFinite(points)) return '0';
    return points.toFixed(2).replace(/\.?0+$/, '');
}

function logStartup(logger, config) {
    logger.info('*'.repeat(80));
    logger.info(`Starting EvoSurf Viewer... [Version: ${config.appVersion}] - ${getBitnessLabel()}`);
    logger.info(`Mode: ${config.headless ? 'Console' : 'Visible'}`);
    logger.info(`AutoUpdate is ${config.updateCheckEnabled ? 'activated' : 'disabled'}`);
    logger.info('Connecting instance...');
    logger.info('Get System Info');
    logger.info(`[CPU]: ${os.cpus()[0]?.model || 'Unknown CPU'}`);
    logger.info(`[Cores]: ${os.cpus().length || 1}`);
    logger.info(`[Memory]: ${Math.round(os.totalmem() / 1024 / 1024)}`);
    logger.info(`[OS]: ${getPlatformLabel(config)}`);
    logger.info(`[OS Version]: ${os.type()} ${os.release()}`);
    logger.info(`User: ${config.sessionId}`);
    logger.info(`Version: ${config.appVersion}`);
    logger.info('Get configuration...');
    logger.info('Checking connection...');
    logger.info('Connection: Ready');
    logger.info('Surf is about to start');
}

async function runWorker() {
    const config = readConfig();
    assertConfig(config);

    const logger = createLogger(`headless:${config.sessionId}`, {
        debug: config.logLevel === 'debug',
        debugInteractions: config.debugInteractions || config.logLevel === 'debug'
    });
    const api = new ApiClient(config, logger);

    let stopping = false;
    let browser = null;
    let activeAdapter = null;
    let visitCounter = 0;

    async function shutdown(signal) {
        if (stopping) return;
        stopping = true;
        logger.warn(`Shutdown requested (${signal})`);

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

    logStartup(logger, config);

    await checkForUpdate(config, logger).catch(error => {
        logger.warn(`Update check failed: ${error.message}`);
    });
    scheduleUpdateChecks(config, logger);

    browser = await launchBrowser(config);

    while (!stopping) {
        let mission = null;

        try {
            mission = await api.getNextVisit();
        } catch (error) {
            const waitMs = error.status === 503 ? config.pollDelayMs : Math.max(config.pollDelayMs, 10000);
            logger.warn(`Unable to get mission: ${error.status || 'network'} ${error.message}. Retry in ${Math.round(waitMs / 1000)} seconds`);
            await delay(waitMs);
            continue;
        }

        if (!mission?.url || !mission?.view_token) {
            logger.debug('No visit available', {
                duration: mission?.duration || 0
            });
            await delay(config.pollDelayMs);
            continue;
        }

        const durationSeconds = normalizeDurationSeconds(mission.duration);
        activeAdapter = createPlaywrightSurfAdapter({ browser, config, logger });

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
            visitCounter += 1;
            logger.visit(visitCounter, formatPoints(validation.credits_earned), durationSeconds, mission.url);
        } catch (error) {
            logger.error(`Mission failed: ${error.message}`);
            logger.debug('Mission failure details', {
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
    console.error('[viewer-headless] Fatal error', error);
    process.exit(1);
});
