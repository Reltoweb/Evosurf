const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlaywrightSurfAdapter } = require('../src/playwright-adapter');

test('reports and bounds a Playwright renderer that stops answering', async () => {
    const listeners = new Map();
    const runtimeFailures = [];
    const page = {
        setDefaultNavigationTimeout: () => {},
        setDefaultTimeout: () => {},
        on: (event, callback) => listeners.set(event, callback),
        addInitScript: async () => {},
        goto: async () => {},
        evaluate: () => new Promise(() => {}),
        close: async () => {},
    };
    const context = {
        setDefaultNavigationTimeout: () => {},
        setDefaultTimeout: () => {},
        newPage: async () => page,
        close: async () => {},
    };
    const browser = {
        newContext: async () => context,
    };
    const adapter = createPlaywrightSurfAdapter({
        browser,
        config: {
            navigationTimeoutMs: 100,
            operationTimeoutMs: 15,
            cleanupTimeoutMs: 15,
        },
        logger: { debug: () => {} },
        onRuntimeFailure: error => runtimeFailures.push(error),
    });

    await adapter.loadURL('https://example.test/');
    await assert.rejects(
        adapter.evaluate('document.title'),
        error => error?.code === 'EVOSURF_RUNTIME_TIMEOUT'
    );
    assert.equal(runtimeFailures.at(-1)?.operation, 'page.evaluate');

    listeners.get('crash')();
    assert.equal(runtimeFailures.at(-1)?.code, 'EVOSURF_RENDERER_CRASHED');
    await adapter.stop();
});

test('falls back to the navigation timeout when optional runtime timeouts are omitted', async () => {
    const configuredTimeouts = [];
    const page = {
        setDefaultNavigationTimeout: timeout => configuredTimeouts.push(timeout),
        setDefaultTimeout: timeout => configuredTimeouts.push(timeout),
        on: () => {},
        addInitScript: async () => {},
        goto: async () => {},
        evaluate: async () => 'ok',
        close: async () => {},
    };
    const context = {
        setDefaultNavigationTimeout: timeout => configuredTimeouts.push(timeout),
        setDefaultTimeout: timeout => configuredTimeouts.push(timeout),
        newPage: async () => page,
        close: async () => {},
    };
    const adapter = createPlaywrightSurfAdapter({
        browser: { newContext: async () => context },
        config: { navigationTimeoutMs: 10000 },
        logger: { debug: () => {} },
    });

    await adapter.loadURL('https://example.test/');
    assert.equal(await adapter.evaluate('document.title'), 'ok');
    assert.deepEqual(configuredTimeouts, [10000, 10000, 10000, 10000]);
    await adapter.stop();
});
