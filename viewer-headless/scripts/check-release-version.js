const fs = require('fs');
const path = require('path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const versionFiles = [
    ['electron/package.json', false],
    ['electron/package-lock.json', true],
    ['viewer-headless/package.json', false],
    ['viewer-headless/package-lock.json', true]
];

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8'));
}

function normalizeExpectedVersion(value) {
    const raw = String(value || '').trim();

    if (!raw) {
        return null;
    }

    if (raw.startsWith('viewer-v')) {
        return raw.slice('viewer-v'.length);
    }

    return raw;
}

function fail(message) {
    console.error(`Release version check failed: ${message}`);
    process.exit(1);
}

const requestedVersion = process.argv[2] || process.env.RELEASE_VERSION || '';
const expectedVersion = normalizeExpectedVersion(requestedVersion)
    || readJson('electron/package.json').version;

if (requestedVersion && !String(requestedVersion).startsWith('viewer-v')) {
    fail(`the release tag must use the viewer-vX.Y.Z convention, received "${requestedVersion}"`);
}

if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) {
    fail(`"${expectedVersion}" is not a strict X.Y.Z version`);
}

for (const [relativePath, isLockFile] of versionFiles) {
    const contents = readJson(relativePath);

    if (contents.version !== expectedVersion) {
        fail(`${relativePath} announces ${contents.version || 'no version'} instead of ${expectedVersion}`);
    }

    if (isLockFile && contents.packages?.['']?.version !== expectedVersion) {
        fail(`${relativePath} root package announces ${contents.packages?.['']?.version || 'no version'} instead of ${expectedVersion}`);
    }
}

console.log(`Release version check passed: viewer-v${expectedVersion}`);
