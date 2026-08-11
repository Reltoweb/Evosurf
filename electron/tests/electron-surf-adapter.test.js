const test = require('node:test');
const assert = require('node:assert/strict');
const { createElectronSurfAdapter } = require('../viewer-core/adapters/electron-surf-adapter');

function createAdapter(loadURL, options = {}) {
    const webContents = {
        isDestroyed: () => false,
        loadURL,
        stop: options.stop || (() => {}),
    };

    return createElectronSurfAdapter({
        getSurfView: () => ({ webContents }),
        loadTimeoutMs: options.loadTimeoutMs,
    });
}

test('keeps a blocked external redirect as a failed mission', async () => {
    const error = new Error("ERR_FAILED (-2) loading 'https://example.test/'");
    error.code = 'ERR_FAILED';
    error.errno = -2;
    const adapter = createAdapter(async (url) => {
        throw error;
    });

    await assert.rejects(adapter.loadURL('https://example.test/'), error);
});

test('keeps genuine load failures as failed missions', async () => {
    const error = new Error("ERR_FAILED (-2) loading 'https://offline.test/'");
    error.code = 'ERR_FAILED';
    error.errno = -2;
    const adapter = createAdapter(async () => { throw error; });

    await assert.rejects(adapter.loadURL('https://offline.test/'), error);
});

test('stops and rejects a site that exceeds the loading timeout', async () => {
    let stopped = false;
    const adapter = createAdapter(
        () => new Promise(() => {}),
        { loadTimeoutMs: 15, stop: () => { stopped = true; } }
    );

    await assert.rejects(
        adapter.loadURL('https://slow.test/'),
        error => error?.code === 'EVOSURF_LOAD_TIMEOUT'
    );
    assert.equal(stopped, true);
});
