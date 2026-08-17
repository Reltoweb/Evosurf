const test = require('node:test');
const assert = require('node:assert/strict');
const {
    pickVisitAction,
    isAllowedInteractionDomain,
    runPostLoadInteraction,
} = require('../viewer-core/interaction-runner');

// Mock adapter minimal : capture les scripts evaluate et simule le retour
// du script de page (clic/scroll). Pas de navigateur réel.
function createMockAdapter(opts = {}) {
    const calls = { evaluate: [], setUserAgent: [], setViewport: [] };
    const adapter = {
        evaluate: async (script) => {
            calls.evaluate.push(script);
            const s = String(script);
            if (/click/i.test(s)) {
                return { action: 'click', completed: true, results: [{ href: 'https://example.test/page' }] };
            }
            if (/scroll/i.test(s)) {
                return { action: 'scroll', completed: true, target: 'window', distance: 600, finalY: 600 };
            }
            return { action: 'unknown', completed: true };
        },
        waitForSettle: async () => true,
        setViewport: (v) => { calls.setViewport.push(v); },
        setUserAgent: (ua) => { calls.setUserAgent.push(ua); },
        _calls: calls,
    };
    return adapter;
}

// Construit un visitConfig conforme à la structure attendue par
// runPostLoadInteraction (interactions.probabilities + interactions.click/scroll
// + target.allowedDomains).
function makeVisitConfig(action, extra = {}) {
    const probabilities =
        action === 'scroll' ? { scroll: 100, click: 0, none: 0 }
        : action === 'click' ? { scroll: 0, click: 100, none: 0 }
        : { scroll: 0, click: 0, none: 100 };

    const interactions = { probabilities };
    if (action === 'click') {
        interactions.click = Object.assign({
            selectors: ['a.btn'],
            count: 1,
            targetMode: 'first',
            preventNewWindow: true,
            scrollIntoViewBeforeClick: true,
            highlightBeforeClick: true,
        }, extra.click || {});
    }
    if (action === 'scroll') {
        interactions.scroll = extra.scroll || {};
    }

    return {
        interactions,
        target: { allowedDomains: ['example.test'], url: 'https://example.test/' },
        device: null,
        deviceWeights: null,
    };
}

function collectLogs() {
    const logs = [];
    return { logs, push: (m) => logs.push(m) };
}

test('pickVisitAction distributes scroll/click/none according to probabilities', () => {
    assert.equal(pickVisitAction({ scroll: 100, click: 0, none: 0 }).action, 'scroll');
    assert.equal(pickVisitAction({ scroll: 0, click: 100, none: 0 }).action, 'click');
    assert.equal(pickVisitAction({ scroll: 0, click: 0, none: 100 }).action, 'none');
    // Sans config -> none (défaut sûr, pas d'interaction involontaire)
    assert.equal(pickVisitAction().action, 'none');
});

test('pickVisitAction clamps out-of-range probabilities', () => {
    // 200 clampé à 100 => 100% scroll
    assert.equal(pickVisitAction({ scroll: 200, click: -5, none: 0 }).action, 'scroll');
});

test('isAllowedInteractionDomain validates host and subdomain rules', () => {
    const allowed = ['example.test', 'sub.example.test'];
    assert.ok(isAllowedInteractionDomain('https://example.test/page', allowed));
    assert.ok(isAllowedInteractionDomain('https://www.example.test/', allowed));
    assert.ok(isAllowedInteractionDomain('https://sub.example.test/x', allowed));
    assert.ok(!isAllowedInteractionDomain('https://other.test/', allowed));
    assert.ok(!isAllowedInteractionDomain('javascript:alert(1)', allowed));
    assert.ok(!isAllowedInteractionDomain('mailto:a@b.test', allowed));
});

test('runPostLoadInteraction with none action emits decision+result and does not touch the page', async () => {
    const adapter = createMockAdapter();
    const { logs, push } = collectLogs();
    await runPostLoadInteraction({
        visitConfig: makeVisitConfig('none'),
        targetUrl: 'https://example.test/',
        adapter,
        emitLog: push,
    });
    assert.equal(adapter._calls.evaluate.length, 0, 'aucun evaluate ne doit être exécuté pour action none');
    const types = logs.map((l) => l.type);
    assert.ok(types.includes('decision'), 'décision émise');
    assert.ok(types.includes('result'), 'résultat émis');
    const result = logs.find((l) => l.type === 'result');
    assert.equal(result.action, 'none');
    assert.equal(result.completed, true);
});

test('runPostLoadInteraction with click action evaluates the page click script', async () => {
    const adapter = createMockAdapter();
    const { logs, push } = collectLogs();
    await runPostLoadInteraction({
        visitConfig: makeVisitConfig('click'),
        targetUrl: 'https://example.test/',
        adapter,
        emitLog: push,
    });
    assert.ok(adapter._calls.evaluate.length >= 1, 'le script de clic doit être évalué');
    const result = logs.find((l) => l.type === 'result');
    assert.ok(result, 'un résultat doit être émis');
    assert.equal(result.action, 'click');
    assert.equal(result.completed, true, 'le clic mocké doit marquer completed=true');
});

test('runPostLoadInteraction with scroll action evaluates the scroll script', async () => {
    const adapter = createMockAdapter();
    const { logs, push } = collectLogs();
    await runPostLoadInteraction({
        visitConfig: makeVisitConfig('scroll'),
        targetUrl: 'https://example.test/',
        adapter,
        emitLog: push,
    });
    assert.ok(adapter._calls.evaluate.length >= 1, 'le script de scroll doit être évalué');
    const result = logs.find((l) => l.type === 'result');
    assert.ok(result, 'un résultat doit être émis');
    assert.equal(result.action, 'scroll');
    assert.equal(result.completed, true);
});

test('runPostLoadInteraction blocks interaction on non-allowed domain', async () => {
    const adapter = createMockAdapter();
    const { logs, push } = collectLogs();
    await runPostLoadInteraction({
        visitConfig: makeVisitConfig('click'),
        targetUrl: 'https://malicious.test/', // non autorisé
        adapter,
        emitLog: push,
    });
    assert.equal(adapter._calls.evaluate.length, 0, 'aucun evaluate sur domaine non autorisé');
    const blocked = logs.find((l) => l.type === 'blocked');
    assert.ok(blocked, 'un log blocked doit être émis');
    assert.equal(blocked.reason, 'domain-not-allowed');
});

test('runPostLoadInteraction propagates evaluate errors (resilience is the caller job)', async () => {
    // runPostLoadInteraction ne catche pas les erreurs d'evaluate : c'est
    // volontaire, la résilience est assurée par le visit-runner (runVisit)
    // qui enveloppe l'appel d'un try/catch. On valide ici ce contrat :
    // l'erreur remonte, l'appelant la transforme en log non-fatal.
    const adapter = {
        loadURL: async () => {},          // chargement OK (simulé)
        setAudioMuted: () => {},
        setNavigationProfile: () => {},
        setAllowedDomains: async () => {},
        setViewport: () => {},
        setUserAgent: () => {},
        evaluate: async () => { throw new Error('page detached'); },
        waitForSettle: async () => false,
    };
    const { logs, push } = collectLogs();
    // runVisit (visit-runner) attrape l'erreur d'interaction.
    const { runVisit } = require('../viewer-core/visit-runner');
    await runVisit({
        payload: {
            target: { url: 'https://example.test/', allowedDomains: ['example.test'] },
            interactions: makeVisitConfig('click').interactions,
            device: null, referrer: null,
            timing: { waitAfterLoadMs: 0 },
        },
        adapter,
        emitLog: push,
        isCurrent: () => true,
        onPageReady: () => {},
    });
    const result = logs.find((l) => l.type === 'result' && l.action === 'interaction');
    assert.ok(result, 'runVisit doit émettre un résultat interaction en cas d\'échec');
    assert.equal(result.completed, false);
    assert.equal(result.reason, 'interaction-failed');
});
