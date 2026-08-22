class RuntimeTimeoutError extends Error {
    constructor(label, timeoutMs) {
        super(`${label} timed out after ${timeoutMs}ms`);
        this.name = 'RuntimeTimeoutError';
        this.code = 'EVOSURF_RUNTIME_TIMEOUT';
        this.operation = label;
        this.timeoutMs = timeoutMs;
    }
}

function withTimeout(promise, timeoutMs, label = 'runtime operation') {
    const normalizedTimeout = Math.max(10, Number(timeoutMs) || 0);
    let timeoutId = null;

    return Promise.race([
        Promise.resolve(promise),
        new Promise((resolve, reject) => {
            timeoutId = setTimeout(() => reject(new RuntimeTimeoutError(label, normalizedTimeout)), normalizedTimeout);
        })
    ]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
    });
}

module.exports = {
    RuntimeTimeoutError,
    withTimeout
};
