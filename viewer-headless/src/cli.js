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

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function retryDelayForMissionError(error, config, failureCount) {
    const pollDelay = Number(config.pollDelayMs);
    const baseDelay = Number.isFinite(pollDelay) && pollDelay > 0 ? pollDelay : 8000;

    let retryDelay = error.status === 503 ? baseDelay : Math.max(baseDelay, 10000);

    if (!error.status) {
        const maxDelay = Number(config.maxPollDelayMs);
        const cap = Number.isFinite(maxDelay) && maxDelay > 0 ? maxDelay : 60000;
        const multiplier = Math.pow(2, Math.min(Math.max(failureCount - 1, 0), 4));
        retryDelay = Math.min(cap, retryDelay * multiplier);
    }

    const jitter = Number(config.pollJitterMs);
    if (Number.isFinite(jitter) && jitter > 0) {
        retryDelay += randomInt(0, jitter);
    }

    return retryDelay;
}

function describeRequestError(error) {
    if (error.code === 'REQUEST_TIMEOUT') return 'timeout';
    return error.status || error.code || 'network';
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
    let missionFailureCount = 0;
    let heartbeatTimer = null;
    let heartbeatInFlight = false;

    async function sendHeartbeat() {
        if (stopping || heartbeatInFlight) return;
        heartbeatInFlight = true;

        try {
            await api.heartbeat();
            logger.debug('Heartbeat sent');
        } catch (error) {
            logger.debug('Heartbeat failed', {
                status: error.status || 'network',
                message: error.message
            });
        } finally {
            heartbeatInFlight = false;
        }
    }

    function startHeartbeat() {
        const interval = Number(config.heartbeatIntervalMs);
        if (heartbeatTimer || !Number.isFinite(interval) || interval <= 0) return;
        sendHeartbeat();
        heartbeatTimer = setInterval(sendHeartbeat, interval);
    }

    function stopHeartbeat() {
        if (!heartbeatTimer) return;
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }

    async function shutdown(signal) {
        if (stopping) return;
        stopping = true;
        logger.warn(`Shutdown requested (${signal})`);
        stopHeartbeat();

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
    startHeartbeat();

    while (!stopping) {
        let mission = null;

        try {
            mission = await api.getNextVisit();
        } catch (error) {
            missionFailureCount += 1;
            const waitMs = retryDelayForMissionError(error, config, missionFailureCount);
            logger.warn(`Unable to get mission: ${describeRequestError(error)} ${error.message}. Retry in ${Math.round(waitMs / 1000)} seconds`);
            await delay(waitMs);
            continue;
        }

        missionFailureCount = 0;

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
                isCurrent: () => !stopping,
                onPageReady: () => {
                    if (stopping) return;
                    visitCounter += 1;
                    logger.visit(
                        visitCounter,
                        formatPoints(mission.credits_expected),
                        durationSeconds,
                        mission.url
                    );
                }
            });
            const durationTask = delay(durationSeconds * 1000);

            await Promise.all([visitTask, durationTask]);

            if (stopping) {
                break;
            }

            await api.validateVisit(mission.view_token);
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
