const test = require('node:test');
const assert = require('node:assert/strict');
const { createAllowedDomainSet, inspectSurfNavigation } = require('../viewer-core/navigation-policy');

test('allows the configured domain and its subdomains', () => {
    const allowed = createAllowedDomainSet(['example.com'], 'https://www.example.com/page');

    assert.equal(inspectSurfNavigation('https://example.com/next', allowed).allowed, true);
    assert.equal(inspectSurfNavigation('https://shop.example.com/next', allowed).allowed, true);
});

test('allows the canonical www and bare-domain redirect in both directions', () => {
    const bareAllowed = createAllowedDomainSet(['example.com']);
    const wwwAllowed = createAllowedDomainSet(['www.example.com']);

    assert.equal(inspectSurfNavigation('https://www.example.com/page', bareAllowed).allowed, true);
    assert.equal(inspectSurfNavigation('https://example.com/page', wwwAllowed).allowed, true);
    assert.equal(inspectSurfNavigation('https://other.example.com/page', wwwAllowed).allowed, false);
});

test('blocks unrelated domains for main-frame navigation', () => {
    const allowed = createAllowedDomainSet(['example.com']);
    const result = inspectSurfNavigation('https://malicious.example/download', allowed);

    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'domain-not-allowed');
});

test('blocks external and executable protocols', () => {
    const allowed = createAllowedDomainSet(['example.com']);

    for (const url of ['file:///C:/Windows/System32/calc.exe', 'ms-windows-store://pdp/', 'mailto:test@example.com', 'javascript:alert(1)']) {
        assert.match(inspectSurfNavigation(url, allowed).reason, /^blocked-protocol:/);
    }
});

test('allows third-party http frames without allowing external protocols', () => {
    const allowed = createAllowedDomainSet(['example.com']);

    assert.equal(inspectSurfNavigation('https://cdn.example.net/embed', allowed, false).allowed, true);
    assert.equal(inspectSurfNavigation('custom-app://launch', allowed, false).allowed, false);
});
