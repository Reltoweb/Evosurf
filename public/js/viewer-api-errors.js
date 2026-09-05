(function (root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.EvoSurfViewerApiErrors = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const CONFIRMED_INVALID_ACCESS = 'confirmed_invalid_access_key';
    const DEFAULT_BACKOFF_SEQUENCE_MS = [3000, 6000, 12000, 24000, 48000, 96000, 180000, 300000];
    const DEFAULT_BACKOFF_CAP_MS = 300000;

    function responseHeader(headers, name) {
        if (!headers) return '';

        if (typeof headers.get === 'function') {
            return String(headers.get(name) || '');
        }

        const expected = String(name).toLowerCase();
        const key = Object.keys(headers).find(header => String(header).toLowerCase() === expected);

        return key ? String(headers[key] || '') : '';
    }

    function hasJsonContentType(contentType) {
        return /^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(String(contentType || '').trim());
    }

    function isJsonObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function retryAfterHeaderMilliseconds(value, now) {
        const normalized = String(value || '').trim();
        if (!normalized) return 0;

        if (/^\d+(?:\.\d+)?$/.test(normalized)) {
            return Math.max(0, Math.ceil(Number(normalized) * 1000));
        }

        const timestamp = Date.parse(normalized);
        return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : 0;
    }

    function retryAfterMilliseconds(error, now = Date.now()) {
        const response = error && error.response ? error.response : null;
        if (!response || Number(response.status) !== 429) return 0;

        const headerDelay = retryAfterHeaderMilliseconds(
            responseHeader(response.headers, 'retry-after'),
            now
        );
        if (headerDelay > 0) return headerDelay;

        const jsonDelay = Number(response.data && response.data.retry_after);
        return Number.isFinite(jsonDelay) && jsonDelay > 0 ? Math.ceil(jsonDelay * 1000) : 0;
    }

    function classifyViewerApiError(error) {
        const response = error && error.response ? error.response : null;
        const rawStatus = response ? Number(response.status) : null;
        const status = Number.isFinite(rawStatus) ? rawStatus : null;
        const contentType = responseHeader(response && response.headers, 'content-type');
        const data = response ? response.data : null;
        const validJson = hasJsonContentType(contentType) && isJsonObject(data);
        const errorCode = validJson && typeof data.error === 'string' ? data.error : null;

        if (status === 401 && validJson && errorCode === 'invalid_access_key') {
            return {
                kind: CONFIRMED_INVALID_ACCESS,
                status,
                contentType,
                errorCode,
                retryable: false,
            };
        }

        if (status === 429) {
            return {
                kind: 'rate_limited',
                status,
                contentType,
                errorCode,
                retryable: true,
                retryAfterMs: retryAfterMilliseconds(error),
            };
        }

        if (status === 401 || status === 403 || status === 419 || (status !== null && status >= 500)) {
            return { kind: 'temporary', status, contentType, errorCode, retryable: true };
        }

        if (!response) {
            return {
                kind: error && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') ? 'timeout' : 'network',
                status: null,
                contentType: '',
                errorCode: error && error.code ? String(error.code) : null,
                retryable: true,
            };
        }

        if (!validJson) {
            return { kind: 'unexpected_response', status, contentType, errorCode: null, retryable: true };
        }

        return { kind: 'api_error', status, contentType, errorCode, retryable: false };
    }

    function createViewerRetryPolicy(options) {
        const settings = options || {};
        const sequence = Array.isArray(settings.sequenceMs) && settings.sequenceMs.length > 0
            ? settings.sequenceMs.map(value => Math.max(1, Number(value) || 1))
            : DEFAULT_BACKOFF_SEQUENCE_MS.slice();
        const capMs = Math.max(1, Number(settings.capMs) || DEFAULT_BACKOFF_CAP_MS);
        const jitterRatio = Math.max(0, Math.min(0.5, Number(settings.jitterRatio ?? 0.1)));
        const now = typeof settings.now === 'function' ? settings.now : () => Date.now();
        const random = typeof settings.random === 'function' ? settings.random : () => Math.random();
        let failureCount = 0;
        let blockedUntil = 0;

        function jitteredDelay(baseDelay) {
            const base = Math.min(capMs, Math.max(1, baseDelay));
            if (jitterRatio === 0) return base;

            if (base >= capMs) {
                const minimum = Math.max(1, Math.floor(capMs * (1 - jitterRatio)));
                return Math.round(minimum + ((capMs - minimum) * random()));
            }

            return Math.min(capMs, Math.round(base + (base * jitterRatio * random())));
        }

        function registerFailure(error, existingClassification = null) {
            const classification = existingClassification || classifyViewerApiError(error);
            if (!classification.retryable) {
                return { ...classification, delayMs: 0, failureCount, blockedUntil };
            }

            const timestamp = now();
            let delayMs;
            if (blockedUntil > timestamp) {
                delayMs = blockedUntil - timestamp;
            } else {
                failureCount += 1;
                const index = Math.min(failureCount - 1, sequence.length - 1);
                delayMs = jitteredDelay(sequence[index]);
            }

            if (classification.kind === 'rate_limited') {
                const requiredDelay = retryAfterMilliseconds(error, timestamp);
                delayMs = Math.max(delayMs, requiredDelay);
            }

            blockedUntil = Math.max(blockedUntil, timestamp + delayMs);

            return {
                ...classification,
                delayMs: Math.max(0, blockedUntil - timestamp),
                failureCount,
                blockedUntil,
            };
        }

        function reset() {
            failureCount = 0;
            blockedUntil = 0;
        }

        function remainingDelayMs() {
            return Math.max(0, blockedUntil - now());
        }

        return {
            registerFailure,
            reset,
            remainingDelayMs,
            isCoolingDown: () => remainingDelayMs() > 0,
            snapshot: () => ({ failureCount, blockedUntil, remainingDelayMs: remainingDelayMs() }),
        };
    }

    function createViewerApiErrorHandler(options) {
        const settings = options || {};
        let invalidationPromise = null;

        async function handle(error, context) {
            const classification = classifyViewerApiError(error);

            if (typeof settings.onClassified === 'function') {
                await settings.onClassified(classification, error, context || {});
            }

            if (classification.kind === CONFIRMED_INVALID_ACCESS) {
                if (!invalidationPromise) {
                    invalidationPromise = Promise.resolve()
                        .then(() => settings.onConfirmedInvalidAccess
                            ? settings.onConfirmedInvalidAccess(classification, context || {})
                            : undefined)
                        .catch((handlerError) => {
                            if (typeof settings.onHandlerError === 'function') {
                                settings.onHandlerError(handlerError);
                            }
                        });
                }

                await invalidationPromise;
            }

            return classification;
        }

        return {
            handle,
            classify: classifyViewerApiError,
            hasStartedInvalidation: () => invalidationPromise !== null,
        };
    }

    return {
        CONFIRMED_INVALID_ACCESS,
        DEFAULT_BACKOFF_SEQUENCE_MS,
        classifyViewerApiError,
        createViewerApiErrorHandler,
        createViewerRetryPolicy,
        retryAfterMilliseconds,
    };
}));
