function createLogger(prefix = 'viewer') {
    const write = (level, message, extra = null) => {
        const entry = {
            at: new Date().toISOString(),
            level,
            prefix,
            message
        };

        if (extra !== null && extra !== undefined) {
            entry.extra = extra;
        }

        const line = `[${entry.at}] [${prefix}] [${level.toUpperCase()}] ${message}`;
        if (level === 'error') {
            console.error(line, extra || '');
        } else if (level === 'warn') {
            console.warn(line, extra || '');
        } else {
            console.log(line, extra || '');
        }
    };

    return {
        info: (message, extra) => write('info', message, extra),
        warn: (message, extra) => write('warn', message, extra),
        error: (message, extra) => write('error', message, extra),
        interaction: (payload) => write('info', '[Surf][Interaction]', payload)
    };
}

module.exports = {
    createLogger
};
