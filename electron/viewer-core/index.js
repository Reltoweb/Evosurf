module.exports = {
    ...require('./devices'),
    ...require('./referrers'),
    ...require('./timing'),
    ...require('./visit-config'),
    ...require('./interaction-runner'),
    ...require('./visit-runner'),
    ...require('./adapters/electron-surf-adapter')
};
