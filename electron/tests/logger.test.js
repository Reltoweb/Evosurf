const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogger, formatTimestamp } = require('../viewer-core/logger');

test('uses the established Docker visit log format', () => {
    const lines = [];
    const originalLog = console.log;
    console.log = line => lines.push(line);

    try {
        createLogger('electron').visit(12, '2.4', 30, 'https://example.test/page');
    } finally {
        console.log = originalLog;
    }

    assert.equal(lines.length, 1);
    assert.match(
        lines[0],
        /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} INFO {2}=> \[12\]\[2\.4 Points\]\[30 seconds\]: https:\/\/example\.test\/page$/
    );
});

test('formats timestamps consistently', () => {
    assert.equal(formatTimestamp(new Date(2026, 7, 10, 15, 21, 19)), '2026/08/10 15:21:19');
});
