function clampNumber(value, min, max, fallback = 0) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return fallback;
    return Math.min(max, Math.max(min, numericValue));
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Génère un délai aléatoire en millisecondes, borné [minMs, maxMs].
// Nom explicite (*Ms) pour éviter la confusion secondes/millisecondes.
function randomDelayMs(minMs, maxMs) {
    const lo = Number(minMs);
    const hi = Number(maxMs);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
    if (hi < lo) return Math.round(lo);
    return Math.round(lo + Math.random() * (hi - lo));
}

// Sleep asynchrone d'une durée aléatoire : combine delay() + randomDelayMs().
// Retourne la durée effectivement attendue (ms), utile pour le logging.
async function sleepRandom(minMs, maxMs) {
    const wait = randomDelayMs(minMs, maxMs);
    await delay(wait);
    return wait;
}

// Alias de compat descendante : ancien nom sans suffixe *Ms.
// @deprecated Prefer randomDelayMs() / sleepRandom().
function randomDelay(minMs, maxMs) {
    return randomDelayMs(minMs, maxMs);
}

module.exports = {
    clampNumber,
    delay,
    randomDelayMs,
    sleepRandom,
    randomDelay, // alias déprécié (compat)
};
