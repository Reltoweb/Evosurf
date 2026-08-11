const test = require('node:test');
const assert = require('node:assert/strict');
const { runVisit } = require('../viewer-core/visit-runner');

test('marks the page ready before optional interactions and keeps the visit alive if they fail', async () => {
    const events = [];
    const logs = [];
    const adapter = {
        loadURL: async () => { events.push('loaded'); },
        evaluate: async () => {
            events.push('interaction');
            throw new Error('interaction failed');
        },
    };

    await runVisit({
        payload: {
            target: {
                url: 'https://example.test/page',
                allowedDomains: ['example.test'],
            },
            timing: { waitAfterLoadMs: 0 },
            interactions: {
                probabilities: { scroll: 100, click: 0, none: 0 },
                scroll: { minDurationMs: 500, maxDurationMs: 500 },
            },
        },
        adapter,
        emitLog: entry => logs.push(entry),
        onPageReady: () => { events.push('ready'); },
    });

    assert.deepEqual(events, ['loaded', 'ready', 'interaction']);
    assert.equal(logs.at(-1)?.reason, 'interaction-failed');
});
