const { ApiClient } = require('./api-client');
const { assertConfig, readConfig } = require('./config');
const { createLogger } = require('./logger');
const { createPlaywrightSurfAdapter, launchBrowser } = require('./playwright-adapter');
const { checkForUpdate, scheduleUpdateChecks } = require('./update-checker');
const { withTimeout } = require('./runtime-guard');
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

function isRuntimeFailure(error) {
    if (['EVOSURF_RUNTIME_TIMEOUT', 'EVOSURF_RENDERER_CRASHED', 'EVOSURF_BROWSER_DISCONNECTED'].includes(error?.code)) {
        return true;
    }

    return /browser.*(?:closed|disconnected)|target.*closed|page.*crash/i.test(String(error?.message || ''));
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
    let terminating = false;
    let browserDisconnected = false;
    let runtimeFailure = null;
    let browserRecoveryAttempts = [];
    const telemetry = {
        viewerState: 'starting',
        currentWebsiteId: null,
        lastCompletedAt: null,
        lastErrorCode: null,
        consecutiveFailures: 0
    };

    function setViewerState(viewerState, error = null) {
        telemetry.viewerState = viewerState;
        if (error) {
            telemetry.lastErrorCode = String(error.code || error.message || error).slice(0, 80);
        }
    }

    function observeBrowser(nextBrowser) {
        nextBrowser.on('disconnected', () => {
            if (terminating) return;
            browserDisconnected = true;
            const error = new Error('Chromium browser disconnected');
            error.code = 'EVOSURF_BROWSER_DISCONNECTED';
            runtimeFailure = runtimeFailure || error;
            logger.warn('Chromium disconnected; runtime recovery scheduled');
        });
    }

    async function launchFreshBrowser() {
        const launchTimeoutMs = Math.max(30000, Number(config.navigationTimeoutMs) + Number(config.operationTimeoutMs));
        const nextBrowser = await withTimeout(launchBrowser(config), launchTimeoutMs, 'chromium.launch');
        observeBrowser(nextBrowser);
        browserDisconnected = false;
        runtimeFailure = null;
        return nextBrowser;
    }

    async function recoverBrowser(reason) {
        if (stopping || terminating) return false;
        const recoveryWindowStart = Date.now() - (5 * 60 * 1000);
        browserRecoveryAttempts = browserRecoveryAttempts.filter(timestamp => timestamp >= recoveryWindowStart);
        browserRecoveryAttempts.push(Date.now());
        if (browserRecoveryAttempts.length > 3) {
            logger.error('Chromium recovery limit reached; delegating restart to container supervisor');
            return false;
        }
        setViewerState('retrying', reason);
        logger.warn(`Recycling Chromium runtime: ${reason?.message || reason}`);

        const previousBrowser = browser;
        browser = null;
        if (previousBrowser) {
            await withTimeout(previousBrowser.close(), config.cleanupTimeoutMs, 'browser.close').catch(() => {});
        }

        try {
            browser = await launchFreshBrowser();
            logger.info('Chromium runtime recovered');
            return true;
        } catch (error) {
            telemetry.lastErrorCode = String(error.code || error.message || error).slice(0, 80);
            logger.error(`Chromium recovery failed: ${error.message}`);
            return false;
        }
    }

    async function terminateProcess(signal, exitCode) {
        if (terminating) return;
        terminating = true;
        stopping = true;
        setViewerState('stopped');
        logger.warn(`Runtime restart requested (${signal})`);
        stopHeartbeat();

        const forceExit = setTimeout(() => process.exit(exitCode), 5000);
        try {
            if (activeAdapter) {
                await withTimeout(activeAdapter.stop(), config.cleanupTimeoutMs, 'adapter.stop').catch(() => {});
                activeAdapter = null;
            }
            if (browser) {
                await withTimeout(browser.close(), config.cleanupTimeoutMs, 'browser.close').catch(() => {});
                browser = null;
            }
        } finally {
            clearTimeout(forceExit);
            process.exit(exitCode);
        }
    }

    async function sendHeartbeat() {
        if (stopping || heartbeatInFlight) return;
        heartbeatInFlight = true;

        try {
            const response = await api.heartbeat(telemetry);
            logger.debug('Heartbeat sent');
            if (response?.control?.action === 'restart_runtime') {
                void terminateProcess('remote-control', 75);
            }
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

    process.on('SIGINT', () => {
        void terminateProcess('SIGINT', 0);
    });

    process.on('SIGTERM', () => {
        void terminateProcess('SIGTERM', 0);
    });

    logStartup(logger, config);

    await checkForUpdate(config, logger).catch(error => {
        logger.warn(`Update check failed: ${error.message}`);
    });
    scheduleUpdateChecks(config, logger);

    browser = await launchFreshBrowser();
    startHeartbeat();

    while (!stopping) {
        let mission = null;
        setViewerState('requesting');

        try {
            mission = await api.getNextVisit();
        } catch (error) {
            missionFailureCount += 1;
            setViewerState(error.status === 503 ? 'waiting' : 'retrying', error);
            telemetry.consecutiveFailures = error.status === 503
                ? 0
                : Math.min(10000, telemetry.consecutiveFailures + 1);
            const waitMs = retryDelayForMissionError(error, config, missionFailureCount);
            logger.warn(`Unable to get mission: ${describeRequestError(error)} ${error.message}. Retry in ${Math.round(waitMs / 1000)} seconds`);
            await delay(waitMs);
            continue;
        }

        missionFailureCount = 0;

        if (!mission?.url || !mission?.view_token) {
            setViewerState('waiting');
            logger.debug('No visit available', {
                duration: mission?.duration || 0
            });
            await delay(config.pollDelayMs);
            continue;
        }

        if (browserDisconnected || !browser) {
            const recovered = await recoverBrowser(runtimeFailure || new Error('Chromium unavailable before mission'));
            if (!recovered) {
                await terminateProcess('automatic-recovery-failed', 70);
                return;
            }
        }

        const durationSeconds = normalizeDurationSeconds(mission.duration);
        telemetry.currentWebsiteId = Number(mission.website_id) || null;
        setViewerState('loading');
        runtimeFailure = null;
        activeAdapter = createPlaywrightSurfAdapter({
            browser,
            config,
            logger,
            onRuntimeFailure: error => {
                runtimeFailure = runtimeFailure || error;
            }
        });
        let shouldRecoverBrowser = false;
        let visitValidated = false;

        try {
            const visitConfig = buildVisitConfigFromApi(mission);
            const visitTask = runVisit({
                payload: visitConfig,
                adapter: activeAdapter,
                emitLog: payload => logger.interaction(payload),
                isCurrent: () => !stopping,
                onPageReady: () => {
                    if (stopping) return;
                    setViewerState('countdown');
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
            const missionTimeoutMs = Math.max(
                60000,
                Number(config.navigationTimeoutMs) + (durationSeconds * 1000) + Number(config.missionRecoveryGraceMs)
            );

            await withTimeout(Promise.all([visitTask, durationTask]), missionTimeoutMs, 'surf mission');

            if (stopping) {
                break;
            }

            if (runtimeFailure || browserDisconnected) {
                throw runtimeFailure || new Error('Chromium disconnected during mission');
            }

            setViewerState('validating');
            await api.validateVisit(mission.view_token);
            visitValidated = true;
            telemetry.lastCompletedAt = new Date().toISOString();
            telemetry.lastErrorCode = null;
            telemetry.consecutiveFailures = 0;
        } catch (error) {
            telemetry.consecutiveFailures = Math.min(10000, telemetry.consecutiveFailures + 1);
            setViewerState('retrying', error);
            shouldRecoverBrowser = Boolean(runtimeFailure || browserDisconnected || isRuntimeFailure(error));
            logger.error(`Mission failed: ${error.message}`);
            logger.debug('Mission failure details', {
                url: mission.url
            });
            if (!stopping && !visitValidated) {
                await api.cancelVisit(mission.view_token, shouldRecoverBrowser ? 'runtime_failure' : 'mission_failed').catch(() => {});
            }
        } finally {
            if (activeAdapter) {
                await withTimeout(activeAdapter.stop(), config.cleanupTimeoutMs, 'adapter.stop').catch(error => {
                    runtimeFailure = runtimeFailure || error;
                    shouldRecoverBrowser = true;
                });
                activeAdapter = null;
            }
            telemetry.currentWebsiteId = null;
        }

        if (!stopping && (shouldRecoverBrowser || runtimeFailure || browserDisconnected)) {
            const recovered = await recoverBrowser(runtimeFailure || new Error('Mission runtime became unhealthy'));
            if (!recovered) {
                await terminateProcess('automatic-recovery-failed', 70);
                return;
            }
        }

        await delay(config.loopDelayMs);
    }
}

runWorker().catch(error => {
    console.error('[viewer-headless] Fatal error', error);
    process.exit(1);
});
