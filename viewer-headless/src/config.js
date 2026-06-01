const path = require('path');

function normalizeBaseUrl(rawValue) {
    const fallback = 'https://www.evosurf.fr';
    const value = String(rawValue || fallback).trim().replace(/\/+$/, '');

    if (value.endsWith('/surf/client')) {
        return value.slice(0, -'/surf/client'.length);
    }

    return value;
}

function readConfig() {
    const baseUrl = normalizeBaseUrl(
        process.env.EVOSURF_BASE_URL ||
        process.env.CLIENT_URL ||
        process.env.BASE_URL
    );

    return {
        baseUrl,
        accessKey: String(process.env.ACCESS_KEY || process.env.EVOSURF_ACCESS_KEY || '').trim(),
        sessionId: String(process.env.SESSION_ID || `headless_${Math.random().toString(36).slice(2)}_${Date.now()}`),
        appVersion: String(process.env.APP_VERSION || require('../package.json').version || 'headless-dev'),
        pollDelayMs: Number(process.env.POLL_DELAY_MS || 8000),
        loopDelayMs: Number(process.env.LOOP_DELAY_MS || 1000),
        requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 15000),
        navigationTimeoutMs: Number(process.env.NAVIGATION_TIMEOUT_MS || 30000),
        headless: process.env.HEADLESS !== 'false',
        logLevel: String(process.env.LOG_LEVEL || process.env.EVOSURF_LOG_LEVEL || 'info').trim().toLowerCase(),
        debugInteractions: process.env.DEBUG_INTERACTIONS === 'true' || process.env.EVOSURF_DEBUG_INTERACTIONS === 'true',
        viewerRuntime: String(process.env.VIEWER_RUNTIME || process.env.EVOSURF_VIEWER_RUNTIME || 'headless').trim(),
        viewerPlatform: String(process.env.VIEWER_PLATFORM || process.env.EVOSURF_VIEWER_PLATFORM || process.platform).trim(),
        profileRoot: process.env.PROFILE_ROOT || path.resolve(process.cwd(), 'profiles'),
        updateCheckEnabled: process.env.UPDATE_CHECK_ENABLED !== 'false',
        updateExitOnAvailable: process.env.UPDATE_EXIT_ON_AVAILABLE === 'true',
        updateCheckIntervalMs: Number(process.env.UPDATE_CHECK_INTERVAL_MS || 0),
        updateManifestUrl: String(process.env.UPDATE_MANIFEST_URL || '').trim(),
        releaseRepository: String(
            process.env.EVOSURF_RELEASE_REPOSITORY ||
            process.env.EVOSURF_GITHUB_REPOSITORY ||
            process.env.GITHUB_REPOSITORY ||
            'Reltoweb/Evosurf'
        ).trim(),
        releaseDockerImage: String(process.env.EVOSURF_RELEASE_DOCKER_IMAGE || '').trim()
    };
}

function assertConfig(config) {
    if (!config.accessKey || config.accessKey.length < 8) {
        throw new Error('ACCESS_KEY manquante ou trop courte. Definis ACCESS_KEY dans l environnement.');
    }
}

module.exports = {
    normalizeBaseUrl,
    readConfig,
    assertConfig
};
