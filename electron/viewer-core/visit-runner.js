const { normalizeVisitConfig } = require('./visit-config');
const { getDeviceProfile } = require('./devices');
const { resolveReferrer } = require('./referrers');
const { clampNumber, delay } = require('./timing');
const { runPostLoadInteraction } = require('./interaction-runner');

async function runVisit({ payload, adapter, emitLog, isCurrent = () => true }) {
    const visitConfig = normalizeVisitConfig(payload);
    const url = visitConfig.target.url;

    if (!url || typeof url !== 'string') {
        throw new Error(`URL invalide: ${url}`);
    }

    const urlObj = new URL(url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new Error(`Protocole non autorise: ${urlObj.protocol}`);
    }

    const deviceProfile = getDeviceProfile(visitConfig.device);
    const referrer = resolveReferrer(visitConfig.referrer);

    if (adapter.setAudioMuted) {
        await adapter.setAudioMuted(true);
    }

    if (adapter.setNavigationProfile) {
        await adapter.setNavigationProfile(deviceProfile, referrer);
    }

    if (adapter.setAllowedDomains) {
        await adapter.setAllowedDomains(visitConfig.target.allowedDomains || [], urlObj.toString());
    }

    if (adapter.setViewport) {
        await adapter.setViewport(deviceProfile);
    }

    if (adapter.setUserAgent) {
        await adapter.setUserAgent(deviceProfile.userAgent);
    }

    const loadOptions = {
        userAgent: deviceProfile.userAgent
    };

    if (referrer) {
        loadOptions.httpReferrer = referrer;
    }

    await adapter.loadURL(urlObj.toString(), loadOptions);
    if (!isCurrent()) return;

    const waitAfterLoadMs = clampNumber(visitConfig.timing?.waitAfterLoadMs, 0, 30000, 1500);
    if (waitAfterLoadMs > 0) {
        await delay(waitAfterLoadMs);
    }
    if (!isCurrent()) return;

    await runPostLoadInteraction({
        visitConfig,
        targetUrl: urlObj.toString(),
        adapter,
        emitLog,
        viewport: deviceProfile.viewport || null
    });
}

module.exports = {
    runVisit
};
