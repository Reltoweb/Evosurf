function clampNumber(value, min, max, fallback = 0) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return fallback;
    return Math.min(max, Math.max(min, numericValue));
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(minMs, maxMs) {
    return Math.round(minMs + Math.random() * (maxMs - minMs));
}

module.exports = {
    clampNumber,
    delay,
    randomDelay
};
