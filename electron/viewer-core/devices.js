const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const SEC_CH_UA = '"Not A Brand";v="8", "Chromium";v="121", "Google Chrome";v="121"';
const SEC_CH_UA_MOBILE = '?0';
const SEC_CH_UA_PLATFORM = '"Windows"';

const DEVICE_PROFILES = {
    desktop: {
        userAgent: CHROME_USER_AGENT,
        viewport: { width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false },
        clientHints: {
            mobile: '?0',
            platform: '"Windows"'
        }
    },
    mobile: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
        viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true },
        clientHints: {
            mobile: '?1',
            platform: '"iOS"'
        }
    },
    tablet: {
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
        viewport: { width: 820, height: 1180, deviceScaleFactor: 2, isMobile: true },
        clientHints: {
            mobile: '?1',
            platform: '"iOS"'
        }
    }
};

function getDeviceProfile(deviceConfig = {}) {
    const baseProfile = DEVICE_PROFILES[deviceConfig.type] || DEVICE_PROFILES.desktop;
    const viewport = {
        ...baseProfile.viewport,
        ...(deviceConfig.viewport || {})
    };

    return {
        ...baseProfile,
        userAgent: deviceConfig.userAgent || baseProfile.userAgent,
        viewport
    };
}

module.exports = {
    CHROME_USER_AGENT,
    SEC_CH_UA,
    SEC_CH_UA_MOBILE,
    SEC_CH_UA_PLATFORM,
    DEVICE_PROFILES,
    getDeviceProfile
};
