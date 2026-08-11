const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('does not bypass Windows update verification or replace the packaged feed', () => {
    assert.doesNotMatch(mainSource, /verifyUpdateCodeSignature\s*=/);
    assert.doesNotMatch(mainSource, /setFeedURL\s*\(/);
    assert.doesNotMatch(mainSource, /checkForUpdatesAndNotify\s*\(/);
});

test('checks packaged updater metadata and awaits the installer download', () => {
    assert.match(mainSource, /process\.resourcesPath[\s\S]*app-update\.yml/);
    assert.match(mainSource, /await autoUpdater\.checkForUpdates\(\)/);
    assert.match(mainSource, /await autoUpdater\.downloadUpdate\(/);
});
