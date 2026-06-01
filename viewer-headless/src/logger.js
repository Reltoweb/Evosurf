function formatTimestamp(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');

    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('/') + ' ' + [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join(':');
}

function createLogger(prefix = 'viewer', options = {}) {
    const debugEnabled = options.debug === true;
    const debugInteractions = options.debugInteractions === true;

    const write = (level, message, extra = null) => {
        if (level === 'debug' && !debugEnabled) return;

        const levelLabel = level.toUpperCase().padEnd(5, ' ');
        const line = `${formatTimestamp()} ${levelLabel} => ${message}`;
        const shouldPrintExtra = debugEnabled && extra !== null && extra !== undefined;

        if (level === 'error') {
            if (shouldPrintExtra) console.error(line, extra);
            else console.error(line);
        } else if (level === 'warn') {
            if (shouldPrintExtra) console.warn(line, extra);
            else console.warn(line);
        } else {
            if (shouldPrintExtra) console.log(line, extra);
            else console.log(line);
        }
    };

    return {
        info: (message, extra) => write('info', message, extra),
        warn: (message, extra) => write('warn', message, extra),
        error: (message, extra) => write('error', message, extra),
        debug: (message, extra) => write('debug', message, extra),
        interaction: (payload) => {
            if (debugInteractions) {
                write('debug', '[Surf][Interaction]', payload);
            }
        },
        visit: (index, points, seconds, url) => {
            write('info', `[${index}][${points} Points][${seconds} seconds]: ${url}`);
        }
    };
}

module.exports = {
    formatTimestamp,
    createLogger
};
