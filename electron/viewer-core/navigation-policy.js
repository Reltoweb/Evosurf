function normalizeAllowedDomain(value) {
    if (!value || typeof value !== 'string') return null;

    try {
        const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
        return new URL(candidate).hostname.toLowerCase();
    } catch (error) {
        return null;
    }
}

function createAllowedDomainSet(allowedDomains = [], targetUrl = null) {
    const domains = Array.isArray(allowedDomains) ? allowedDomains : [];
    const result = new Set(domains.map(normalizeAllowedDomain).filter(Boolean));
    const targetDomain = normalizeAllowedDomain(targetUrl);
    if (targetDomain) result.add(targetDomain);

    return result;
}

function inspectSurfNavigation(url, allowedDomains, requireAllowedDomain = true) {
    if (url === 'about:blank') return { allowed: true, reason: null };

    let parsed;
    try {
        parsed = new URL(url);
    } catch (error) {
        return { allowed: false, reason: 'invalid-url' };
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { allowed: false, reason: `blocked-protocol:${parsed.protocol}` };
    }

    if (!requireAllowedDomain) return { allowed: true, reason: null };

    const hostname = parsed.hostname.toLowerCase();
    const allowed = [...allowedDomains].some(domain => (
        hostname === domain || hostname.endsWith(`.${domain}`)
    ));

    return { allowed, reason: allowed ? null : 'domain-not-allowed' };
}

module.exports = {
    createAllowedDomainSet,
    inspectSurfNavigation,
    normalizeAllowedDomain,
};
