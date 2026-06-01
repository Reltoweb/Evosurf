function normalizeVisitConfig(payload) {
    if (typeof payload === 'string') {
        return {
            target: { url: payload },
            device: { type: 'desktop' },
            referrer: { mode: 'direct' }
        };
    }

    if (!payload || typeof payload !== 'object') {
        throw new Error('Configuration de visite invalide');
    }

    return {
        ...payload,
        target: {
            ...(payload.target || {}),
            url: payload.target?.url || payload.url
        },
        device: {
            type: 'desktop',
            ...(payload.device || {})
        },
        referrer: {
            mode: 'direct',
            ...(payload.referrer || {})
        }
    };
}

module.exports = {
    normalizeVisitConfig
};
