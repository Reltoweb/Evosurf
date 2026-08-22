const test = require('node:test');
const assert = require('node:assert/strict');
const { withTimeout } = require('../src/runtime-guard');

test('returns a runtime result before the deadline', async () => {
    assert.equal(await withTimeout(Promise.resolve('ok'), 50, 'quick operation'), 'ok');
});

test('rejects a runtime operation that never settles', async () => {
    await assert.rejects(
        withTimeout(new Promise(() => {}), 15, 'stuck renderer'),
        error => error?.code === 'EVOSURF_RUNTIME_TIMEOUT' && error?.operation === 'stuck renderer'
    );
});
