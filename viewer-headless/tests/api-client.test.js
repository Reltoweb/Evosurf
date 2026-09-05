const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ApiClient } = require('../src/api-client');
require('../../public/js/viewer-api-errors');
const { classifyViewerApiError } = globalThis.EvoSurfViewerApiErrors;

test('429 stays temporary and preserves the headless access key', async () => {
    const originalFetch = global.fetch;
    const config = {
        baseUrl: 'https://example.test',
        accessKey: 'persistent-headless-access-key',
        requestTimeoutMs: 1000
    };
    let sentHeaders = null;
    let observedError = null;

    global.fetch = async (url, options) => {
        sentHeaders = options.headers;
        return {
            ok: false,
            status: 429,
            headers: new Headers({
                'content-type': 'application/json',
                'retry-after': '60'
            }),
            text: async () => JSON.stringify({
                error: 'rate_limited',
                retryable: true,
                retry_after: 60
            })
        };
    };

    try {
        const api = new ApiClient(config, { debug() {} });
        await assert.rejects(
            api.heartbeat(),
            error => {
                observedError = error;
                return error.status === 429
                    && error.data?.error === 'rate_limited'
                    && error.data?.retryable === true;
            }
        );

        assert.equal(config.accessKey, 'persistent-headless-access-key');
        assert.equal(sentHeaders['X-Access-Key'], 'persistent-headless-access-key');
        assert.match(sentHeaders['X-Request-ID'], /^[0-9a-f-]{36}$/i);
        assert.equal(observedError.observability.requestId, null);
        assert.equal(observedError.observability.clientRequestId, sentHeaders['X-Request-ID']);
        assert.equal(observedError.observability.contentType, 'application/json');
        assert.ok(observedError.observability.durationMs >= 0);
    } finally {
        global.fetch = originalFetch;
    }
});

test('successful HTML is surfaced as a retryable protocol error', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<html>proxy page</html>'
    });

    try {
        const api = new ApiClient({
            baseUrl: 'https://example.test',
            accessKey: 'persistent-headless-access-key',
            requestTimeoutMs: 1000
        }, { debug() {} });

        await assert.rejects(api.getNextVisit(), error => {
            const classification = classifyViewerApiError(error);
            return classification.kind === 'unexpected_response'
                && classification.retryable === true
                && error.observability.contentType === 'text/html'
                && /^[a-f0-9]{64}$/.test(error.observability.bodySha256)
                && !JSON.stringify(error).includes('<html>proxy page</html>');
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('headless uses the shared policy, serial heartbeat, critical validation retries, and one-shot cancel', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/cli.js'), 'utf8');
    const dockerfile = fs.readFileSync(path.join(__dirname, '../Dockerfile'), 'utf8');

    assert.match(source, /createViewerRetryPolicy/);
    assert.match(source, /async function validateVisitWithRetry/);
    assert.match(source, /await api\.cancelVisit/);
    assert.match(source, /heartbeatTimer = setTimeout/);
    assert.match(source, /classification\.kind === 'rate_limited'[\s\S]*: interval/);
    assert.doesNotMatch(source, /setInterval\(sendHeartbeat/);
    assert.match(dockerfile, /COPY public\/js\/viewer-api-errors\.js/);
    assert.match(source, /viewer\.api_error/);
    assert.match(source, /occurrences_in_window/);
});

test('the public Linux release packages and installs the shared error policy', () => {
    const repositoryRoot = path.join(__dirname, '../..');
    const releaseFiles = fs.readFileSync(path.join(__dirname, '../PUBLIC_RELEASE_FILES.md'), 'utf8');
    const workflowPath = [
        path.join(__dirname, '../public-repo/.github/workflows/viewer-headless-release.yml'),
        path.join(repositoryRoot, '.github/workflows/viewer-headless-release.yml'),
    ].find(candidate => fs.existsSync(candidate));
    assert.ok(workflowPath, 'viewer release workflow is missing');
    const workflow = fs.readFileSync(workflowPath, 'utf8');
    const updater = fs.readFileSync(path.join(__dirname, '../scripts/update-headless-linux.sh'), 'utf8');
    const dockerfile = fs.readFileSync(path.join(__dirname, '../Dockerfile'), 'utf8');
    const sharedModule = path.join(repositoryRoot, 'public/js/viewer-api-errors.js');

    assert.equal(fs.existsSync(sharedModule), true);
    assert.match(releaseFiles, /^public\/js\/viewer-api-errors\.js$/m);
    assert.match(workflow, /viewer-headless electron\/viewer-core public\/js\/viewer-api-errors\.js/);
    assert.match(workflow, /test -f "\$extract_dir\/public\/js\/viewer-api-errors\.js"/);
    assert.match(workflow, /node -e 'require\(process\.argv\[1\]\)' "\$extract_dir\/public\/js\/viewer-api-errors\.js"/);
    assert.match(updater, /shared_policy="\$extract_dir\/public\/js\/viewer-api-errors\.js"/);
    assert.match(updater, /cp -a "\$shared_policy" "\$INSTALL_DIR\/public\/js\/viewer-api-errors\.js"/);
    assert.match(dockerfile, /COPY public\/js\/viewer-api-errors\.js \.\/public\/js\/viewer-api-errors\.js/);
});
