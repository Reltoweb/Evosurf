const DEFAULT_REFERER = 'https://www.google.com/';

const REFERRER_PRESETS = {
    google: 'https://www.google.com/',
    facebook: 'https://www.facebook.com/',
    instagram: 'https://www.instagram.com/',
    x: 'https://x.com/',
    linkedin: 'https://www.linkedin.com/',
    youtube: 'https://www.youtube.com/',
    bing: 'https://www.bing.com/'
};

function resolveReferrer(referrerConfig = {}) {
    if (referrerConfig.mode === 'direct') return null;

    const referrerUrl = referrerConfig.mode === 'custom'
        ? referrerConfig.customUrl
        : REFERRER_PRESETS[referrerConfig.preset];

    if (!referrerUrl) return null;

    const parsedReferrer = new URL(referrerUrl);
    if (!['http:', 'https:'].includes(parsedReferrer.protocol)) {
        throw new Error(`Referrer non autorise: ${parsedReferrer.protocol}`);
    }

    return parsedReferrer.toString();
}

module.exports = {
    DEFAULT_REFERER,
    REFERRER_PRESETS,
    resolveReferrer
};
