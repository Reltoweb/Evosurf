const test = require('node:test');
const assert = require('node:assert/strict');
const {
    clampNumber,
    delay,
    randomDelayMs,
    sleepRandom,
    randomDelay,
} = require('../viewer-core/timing');

test('clampNumber clamps within bounds and falls back for non-finite values', () => {
    assert.equal(clampNumber(5, 0, 10), 5);
    assert.equal(clampNumber(-3, 0, 10), 0);   // borne basse
    assert.equal(clampNumber(42, 0, 10), 10);  // borne haute
    assert.equal(clampNumber(NaN, 0, 10), 0);  // fallback
    assert.equal(clampNumber('abc', 0, 10, 7), 7); // fallback personnalisé
    assert.equal(clampNumber('8', 0, 10), 8);  // coerce string
});

test('delay resolves after the given milliseconds', async () => {
    const t0 = Date.now();
    await delay(30);
    const elapsed = Date.now() - t0;
    // Tolérance large sur CI/Windows (timer non temps-réel strict).
    assert.ok(elapsed >= 25, `delay trop court: ${elapsed}ms`);
    assert.ok(elapsed < 1000, `delay trop long: ${elapsed}ms`);
});

test('randomDelayMs stays within [min, max] over many samples', () => {
    const min = 5000;
    const max = 25000;
    let outOfBounds = 0;
    for (let i = 0; i < 5000; i++) {
        const v = randomDelayMs(min, max);
        if (!Number.isInteger(v) || v < min || v > max) outOfBounds++;
    }
    assert.equal(outOfBounds, 0);
});

test('randomDelayMs handles degenerate and invalid inputs', () => {
    assert.equal(randomDelayMs(50, 50), 50);     // bornes égales
    assert.equal(randomDelayMs(100, 50), 100);   // bornes inversées -> min
    assert.equal(randomDelayMs(NaN, 100), 0);    // NaN -> 0
    assert.equal(randomDelayMs(100, NaN), 0);    // NaN -> 0
    assert.equal(randomDelayMs(undefined, undefined), 0);
});

test('sleepRandom awaits and returns a bounded wait duration', async () => {
    const wait = await sleepRandom(10, 20);
    assert.equal(typeof wait, 'number');
    assert.ok(wait >= 10 && wait <= 20, `wait hors bornes: ${wait}`);
});

test('randomDelay alias remains backward-compatible and equals randomDelayMs', () => {
    assert.equal(typeof randomDelay, 'function');
    // Même algorithme : valeurs dans les bornes.
    for (let i = 0; i < 1000; i++) {
        const v = randomDelay(100, 200);
        assert.ok(v >= 100 && v <= 200, `alias hors bornes: ${v}`);
    }
    // Bornes égales identiques.
    assert.equal(randomDelay(50, 50), randomDelayMs(50, 50));
});
