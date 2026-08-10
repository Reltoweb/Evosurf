const test = require('node:test');
const assert = require('node:assert/strict');
const { createElectronSurfAdapter } = require('../viewer-core/adapters/electron-surf-adapter');

function createAdapter(loadURL, shouldRecoverBlockedNavigation) {
    const webContents = {
        isDestroyed: () => false,
        loadURL,
    };

    return createElectronSurfAdapter({
        getSurfView: () => ({ webContents }),
        shouldRecoverBlockedNavigation,
    });
}

test('continues a visit on a load failure caused by a blocked external redirect', async () => {
    const loadedUrls = [];
    const adapter = createAdapter(async (url) => {
        loadedUrls.push(url);
        if (url !== 'about:blank') {
            const error = new Error("ERR_FAILED (-2) loading 'https://example.test/'");
            error.code = 'ERR_FAILED';
            error.errno = -2;
            throw error;
        }
    }, () => true);

    await assert.doesNotReject(adapter.loadURL('https://example.test/'));
    assert.deepEqual(loadedUrls, ['https://example.test/', 'about:blank']);
});

test('keeps genuine load failures as failed missions', async () => {
    const error = new Error("ERR_FAILED (-2) loading 'https://offline.test/'");
    error.code = 'ERR_FAILED';
    error.errno = -2;
    const adapter = createAdapter(async () => { throw error; }, () => false);

    await assert.rejects(adapter.loadURL('https://offline.test/'), error);
});
