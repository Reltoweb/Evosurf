const https = require('https');
const currentPackage = require('../package.json');

function normalizeVersion(value) {
    return String(value || '')
        .trim()
        .replace(/^viewer-headless-/i, '')
        .replace(/^viewer-/i, '')
        .replace(/^headless-/i, '')
        .replace(/^v/i, '')
        .split(/[+-]/)[0];
}

function compareVersions(left, right) {
    const a = normalizeVersion(left).split('.').map(part => Number(part) || 0);
    const b = normalizeVersion(right).split('.').map(part => Number(part) || 0);
    const length = Math.max(a.length, b.length, 3);

    for (let i = 0; i < length; i += 1) {
        const diff = (a[i] || 0) - (b[i] || 0);
        if (diff !== 0) return diff > 0 ? 1 : -1;
    }

    return 0;
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, {
            headers: {
                'Accept': 'application/vnd.github+json, application/json',
                'User-Agent': 'EvoSurf-Headless-Updater'
            },
            timeout: 15000
        }, response => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.resume();
                fetchJson(response.headers.location).then(resolve, reject);
                return;
            }

            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => {
                body += chunk;
            });
            response.on('end', () => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(`Update check HTTP ${response.statusCode}`));
                    return;
                }

                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(error);
                }
            });
        });

        request.on('timeout', () => {
            request.destroy(new Error('Update check timeout'));
        });
        request.on('error', reject);
    });
}

function getReleaseAsset(release) {
    return (release.assets || []).find(asset => {
        return typeof asset.name === 'string' && /^evosurf-viewer-headless-linux.*\.tar\.gz$/i.test(asset.name);
    }) || null;
}

async function getLatestRelease(config) {
    if (config.updateManifestUrl) {
        return fetchJson(config.updateManifestUrl);
    }

    const repo = config.releaseRepository;
    if (!repo) {
        throw new Error('EVOSURF_RELEASE_REPOSITORY is required for update checks');
    }

    return fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
}

async function checkForUpdate(config, logger) {
    if (!config.updateCheckEnabled) {
        return null;
    }

    const currentVersion = config.appVersion || currentPackage.version;
    const release = await getLatestRelease(config);
    const latestVersion = release.version || release.tag_name || release.name;
    const asset = getReleaseAsset(release);

    if (!latestVersion || compareVersions(latestVersion, currentVersion) <= 0) {
        logger.info(`Current version: ${normalizeVersion(currentVersion)}, Stable: ${normalizeVersion(latestVersion || currentVersion)}`);
        logger.info('App is up to date');
        return null;
    }

    const update = {
        currentVersion,
        latestVersion,
        releaseUrl: release.html_url || null,
        downloadUrl: release.download_url || asset?.browser_download_url || null
    };

    logger.warn(`Update available: ${normalizeVersion(currentVersion)} -> ${normalizeVersion(latestVersion)}`);
    logger.debug('Update details', update);

    if (config.updateExitOnAvailable) {
        logger.warn('Stopping worker so the service can install the update');
        process.exit(42);
    }

    return update;
}

function scheduleUpdateChecks(config, logger) {
    if (!config.updateCheckEnabled || !config.updateCheckIntervalMs || config.updateCheckIntervalMs < 60000) {
        return;
    }

    setInterval(() => {
        checkForUpdate(config, logger).catch(error => {
            logger.warn(`Update check failed: ${error.message}`);
        });
    }, config.updateCheckIntervalMs).unref();
}

module.exports = {
    checkForUpdate,
    compareVersions,
    scheduleUpdateChecks
};
