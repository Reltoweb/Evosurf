const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../../public/js/viewer-api-errors');

const {
    CONFIRMED_INVALID_ACCESS,
    DEFAULT_BACKOFF_SEQUENCE_MS,
    classifyViewerApiError,
    createViewerApiErrorHandler,
    createViewerRetryPolicy,
} = globalThis.EvoSurfViewerApiErrors;

function httpError(status, data, contentType = 'application/json') {
    const error = new Error(`HTTP ${status}`);
    error.response = {
        status,
        data,
        headers: { 'content-type': contentType },
    };
    return error;
}

test('confirms invalid access only for the exact 401 JSON contract', () => {
    const result = classifyViewerApiError(httpError(401, { error: 'invalid_access_key' }));

    assert.equal(result.kind, CONFIRMED_INVALID_ACCESS);
    assert.equal(result.retryable, false);
});

test('never confirms invalid access for temporary or untrusted responses', () => {
    const cases = [
        ['401 HTML', httpError(401, '<html>Unauthorized</html>', 'text/html')],
        ['401 JSON without recognized code', httpError(401, { error: 'viewer_session_expired' })],
        ['401 invalid JSON', httpError(401, '{"error":', 'application/json')],
        ['403 JSON', httpError(403, { error: 'invalid_access_key' })],
        ['403 HTML', httpError(403, '<html>Forbidden</html>', 'text/html')],
        ['419', httpError(419, { error: 'csrf_mismatch' })],
        ['429', httpError(429, { error: 'rate_limited' })],
        ['500', httpError(500, { error: 'internal_error' })],
        ['502', httpError(502, '<html>Bad gateway</html>', 'text/html')],
        ['503', httpError(503, { error: 'temporary_unavailable' })],
        ['504', httpError(504, '<html>Gateway timeout</html>', 'text/html')],
        ['timeout', Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })],
        ['network', Object.assign(new Error('network'), { code: 'ERR_NETWORK' })],
    ];

    for (const [label, error] of cases) {
        assert.notEqual(classifyViewerApiError(error).kind, CONFIRMED_INVALID_ACCESS, label);
    }
});

test('runs the destructive invalidation procedure at most once under concurrency', async () => {
    let destructiveCalls = 0;
    const handler = createViewerApiErrorHandler({
        onConfirmedInvalidAccess: async () => {
            destructiveCalls += 1;
            await new Promise(resolve => setTimeout(resolve, 10));
        },
    });
    const confirmedError = httpError(401, { error: 'invalid_access_key' });

    await Promise.all(Array.from({ length: 8 }, () => handler.handle(confirmedError, { endpoint: 'next' })));

    assert.equal(destructiveCalls, 1);
    assert.equal(handler.hasStartedInvalidation(), true);
});

test('keeps the key and allows recovery after a temporary failure', async () => {
    let storedKey = 'persistent-viewer-key';
    let destructiveCalls = 0;
    const handler = createViewerApiErrorHandler({
        onConfirmedInvalidAccess: () => {
            destructiveCalls += 1;
            storedKey = '';
        },
    });

    const failure = await handler.handle(
        httpError(503, { error: 'temporary_unavailable' }),
        { endpoint: 'next' }
    );
    const recoveredResponse = { url: 'https://example.test', view_token: 'next-token' };

    assert.equal(failure.retryable, true);
    assert.equal(storedKey, 'persistent-viewer-key');
    assert.equal(destructiveCalls, 0);
    assert.equal(recoveredResponse.view_token, 'next-token');
});

test('uses progressive backoff and resets only after an explicit success', () => {
    let now = 0;
    const policy = createViewerRetryPolicy({ now: () => now, random: () => 0, jitterRatio: 0 });
    const failure = httpError(503, { error: 'temporary_unavailable' });

    for (const expected of DEFAULT_BACKOFF_SEQUENCE_MS) {
        const retry = policy.registerFailure(failure);
        assert.equal(retry.delayMs, expected);
        now += retry.delayMs;
    }

    const capped = policy.registerFailure(failure);
    assert.equal(capped.delayMs, 300000);
    policy.reset();
    assert.equal(policy.snapshot().failureCount, 0);
    assert.equal(policy.remainingDelayMs(), 0);
    assert.equal(policy.registerFailure(failure).delayMs, 3000);
});

test('does not count simultaneous endpoint failures as separate retry rounds', () => {
    let now = 1000;
    const policy = createViewerRetryPolicy({ now: () => now, random: () => 0, jitterRatio: 0 });

    const first = policy.registerFailure(httpError(503, { error: 'temporary_unavailable' }));
    const heartbeat = policy.registerFailure(httpError(403, { error: 'forbidden' }));
    const prefetch = policy.registerFailure(Object.assign(new Error('network'), { code: 'ERR_NETWORK' }));

    assert.equal(first.delayMs, 3000);
    assert.equal(heartbeat.delayMs, 3000);
    assert.equal(prefetch.delayMs, 3000);
    assert.equal(policy.snapshot().failureCount, 1);

    now += 3000;
    assert.equal(policy.registerFailure(httpError(503, {})).delayMs, 6000);
});

test('429 honors Retry-After header before JSON and never retries early', () => {
    let now = Date.parse('2026-09-02T12:00:00Z');
    const policy = createViewerRetryPolicy({ now: () => now, random: () => 0, jitterRatio: 0 });
    const withHeader = httpError(429, { error: 'rate_limited', retry_after: 30 });
    withHeader.response.headers['retry-after'] = '120';

    assert.equal(policy.registerFailure(withHeader).delayMs, 120000);

    policy.reset();
    const withJson = httpError(429, { error: 'rate_limited', retry_after: 90 });
    assert.equal(policy.registerFailure(withJson).delayMs, 90000);

    policy.reset();
    const withDate = httpError(429, { error: 'rate_limited' });
    withDate.response.headers['retry-after'] = new Date(now + 45000).toUTCString();
    assert.equal(policy.registerFailure(withDate).delayMs, 45000);
});

test('a one-hour generic 403 outage stays capped, preserves the key, and recovers', async () => {
    let now = 0;
    let storedKey = 'persistent-viewer-key';
    let attempts = 0;
    const policy = createViewerRetryPolicy({ now: () => now, random: () => 0.5 });
    const handler = createViewerApiErrorHandler({
        onConfirmedInvalidAccess: () => { storedKey = ''; },
    });
    const failure = httpError(403, '<html>WAF</html>', 'text/html');

    while (now < 60 * 60 * 1000) {
        const classification = await handler.handle(failure, { endpoint: 'next' });
        const retry = policy.registerFailure(failure, classification);
        assert.ok(retry.delayMs <= 300000);
        now += retry.delayMs;
        attempts += 1;
    }

    assert.equal(storedKey, 'persistent-viewer-key');
    assert.ok(attempts < 25, `attempts=${attempts}`);
    policy.reset();
    assert.equal(policy.remainingDelayMs(), 0);
    assert.equal(policy.registerFailure(failure).failureCount, 1);
});

test('a thirty-second WAF outage retries progressively then resumes from a clean state', () => {
    let now = 0;
    const attempts = [];
    const policy = createViewerRetryPolicy({ now: () => now, random: () => 0, jitterRatio: 0 });
    const failure = httpError(403, '<html>WAF</html>', 'text/html');

    while (now < 30000) {
        attempts.push(now);
        now += policy.registerFailure(failure).delayMs;
    }

    assert.deepEqual(attempts, [0, 3000, 9000, 21000]);
    policy.reset();
    assert.equal(policy.snapshot().failureCount, 0);
    assert.equal(policy.remainingDelayMs(), 0);
});

test('503, timeout, and network loss all use the same recoverable policy', () => {
    const failures = [
        httpError(503, { error: 'temporary_unavailable' }),
        Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }),
        Object.assign(new Error('network'), { code: 'ERR_NETWORK' }),
    ];

    for (const failure of failures) {
        const policy = createViewerRetryPolicy({ random: () => 0, jitterRatio: 0 });
        const retry = policy.registerFailure(failure);
        assert.equal(retry.retryable, true);
        assert.equal(retry.delayMs, 3000);
        policy.reset();
        assert.equal(policy.remainingDelayMs(), 0);
    }
});

test('jitter spreads thirty viewers after a common outage', () => {
    const delays = Array.from({ length: 30 }, (_, index) => {
        const policy = createViewerRetryPolicy({ random: () => index / 29 });
        return policy.registerFailure(httpError(503, {})).delayMs;
    });

    assert.ok(new Set(delays).size >= 25);
    assert.ok(Math.min(...delays) >= 3000);
    assert.ok(Math.max(...delays) <= 3300);
});

test('Electron exposes native API-error logging without the private Laravel view', () => {
    const preloadSource = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
    const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

    assert.match(preloadSource, /logApiError/);
    assert.match(mainSource, /ipcMain\.on\('viewer-api-error'/);
    assert.match(mainSource, /viewer\.api_error/);
});
