const { clampNumber, delay, randomDelay } = require('./timing');

function pickVisitAction(probabilities = {}) {
    const scroll = clampNumber(probabilities.scroll, 0, 100);
    const click = clampNumber(probabilities.click, 0, 100);
    const none = clampNumber(probabilities.none, 0, 100);
    const total = scroll + click + none;

    if (total <= 0) {
        return { action: 'none', roll: 0 };
    }

    const roll = Math.random() * total;
    if (roll < scroll) return { action: 'scroll', roll };
    if (roll < scroll + click) return { action: 'click', roll };
    return { action: 'none', roll };
}

function isAllowedInteractionDomain(targetUrl, allowedDomains = []) {
    if (!Array.isArray(allowedDomains) || allowedDomains.length === 0) {
        return false;
    }

    const targetHost = new URL(targetUrl).hostname.toLowerCase();

    return allowedDomains.some(domain => {
        if (!domain || typeof domain !== 'string') return false;
        const normalizedDomain = domain.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
        return targetHost === normalizedDomain || targetHost.endsWith(`.${normalizedDomain}`);
    });
}

async function runPostLoadInteraction({ visitConfig, targetUrl, adapter, emitLog = () => {}, viewport = null }) {
    const interactions = visitConfig.interactions || {};
    const probabilities = interactions.probabilities || {};
    const selectedAction = pickVisitAction(probabilities);
    emitLog({
        type: 'decision',
        action: selectedAction.action,
        roll: Number(selectedAction.roll.toFixed(2)),
        probabilities,
        device: visitConfig.device || null,
        deviceWeights: visitConfig.deviceWeights || null,
        viewport
    });

    if (selectedAction.action === 'none') {
        emitLog({
            type: 'result',
            action: 'none',
            completed: true
        });
        return;
    }

    if (!isAllowedInteractionDomain(targetUrl, visitConfig.target.allowedDomains)) {
        emitLog({
            type: 'blocked',
            action: selectedAction.action,
            reason: 'domain-not-allowed',
            targetUrl,
            allowedDomains: visitConfig.target.allowedDomains || []
        });
        return;
    }

    if (selectedAction.action === 'scroll') {
        const result = await executeHumanScroll(adapter, interactions.scroll || {});
        emitLog({
            type: 'result',
            ...result
        });
        return;
    }

    if (selectedAction.action === 'click') {
        const result = await executeHumanClick(adapter, interactions.click || {}, visitConfig.target.allowedDomains || []);
        emitLog({
            type: 'result',
            ...result
        });
    }
}

async function executeHumanScroll(adapter, scrollConfig = {}) {
    const config = {
        minDistancePx: clampNumber(scrollConfig.minDistancePx, 100, 10000, 600),
        maxDistancePx: clampNumber(scrollConfig.maxDistancePx, 100, 20000, 2400),
        minDurationMs: clampNumber(scrollConfig.minDurationMs, 500, 60000, 2500),
        maxDurationMs: clampNumber(scrollConfig.maxDurationMs, 500, 90000, 9000)
    };

    if (config.maxDistancePx < config.minDistancePx) {
        config.maxDistancePx = config.minDistancePx;
    }

    if (config.maxDurationMs < config.minDurationMs) {
        config.maxDurationMs = config.minDurationMs;
    }

    const script = `
        (async () => {
            const config = ${JSON.stringify(config)};
            const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            const randomBetween = (min, max) => min + Math.random() * (max - min);
            const findScrollTarget = () => {
                const pageScroller = document.scrollingElement || document.documentElement;
                if (pageScroller && pageScroller.scrollHeight > pageScroller.clientHeight + 20) {
                    return { element: pageScroller, isWindow: true };
                }

                const candidates = Array.from(document.querySelectorAll('body *')).filter((element) => {
                    const style = window.getComputedStyle(element);
                    const overflowY = style.overflowY;
                    return /(auto|scroll)/.test(overflowY) && element.scrollHeight > element.clientHeight + 20;
                });

                candidates.sort((a, b) => {
                    return (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight);
                });

                if (candidates[0]) {
                    return { element: candidates[0], isWindow: false };
                }

                return { element: pageScroller, isWindow: true };
            };

            const target = findScrollTarget();
            const scroller = target.element;
            const getScrollTop = () => target.isWindow ? window.scrollY : scroller.scrollTop;
            const maxScrollTop = Math.max(0, scroller.scrollHeight - (target.isWindow ? window.innerHeight : scroller.clientHeight));
            const remainingDistance = Math.max(0, maxScrollTop - getScrollTop());

            if (remainingDistance <= 0) {
                return { action: 'scroll', completed: false, reason: 'page-too-short' };
            }

            const requestedDistance = randomBetween(config.minDistancePx, config.maxDistancePx);
            const targetY = Math.min(maxScrollTop, getScrollTop() + requestedDistance);
            const startY = getScrollTop();
            const distance = targetY - startY;
            const duration = randomBetween(config.minDurationMs, config.maxDurationMs);
            const steps = Math.max(8, Math.round(duration / randomBetween(90, 170)));
            const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

            for (let index = 1; index <= steps; index += 1) {
                const progress = easeInOut(index / steps);
                const y = Math.round(startY + distance * progress);
                if (target.isWindow) {
                    window.scrollTo({ top: y, left: 0, behavior: 'auto' });
                    window.dispatchEvent(new WheelEvent('wheel', { deltaY: y - getScrollTop(), bubbles: true, cancelable: true }));
                } else {
                    scroller.scrollTop = y;
                    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: y - getScrollTop(), bubbles: true, cancelable: true }));
                }

                if (index % 5 === 0 && Math.random() < 0.25) {
                    await sleep(randomBetween(180, 650));
                }

                await sleep(randomBetween(70, 180));
            }

            return {
                action: 'scroll',
                completed: true,
                target: target.isWindow ? 'window' : (scroller.tagName || 'element').toLowerCase(),
                distance: Math.round(distance),
                finalY: Math.round(getScrollTop())
            };
        })();
    `;

    const result = await adapter.evaluate(script);
    console.log('[Surf] Scroll execute:', result);
    return result;
}

async function executeHumanClick(adapter, clickConfig = {}, allowedDomains = []) {
    const selectors = Array.isArray(clickConfig.selectors) ? clickConfig.selectors.filter(Boolean) : [];
    const explicitRandomPageClick = clickConfig.randomPageClick === true || clickConfig.randomPageClick === 1 || clickConfig.randomPageClick === '1' || clickConfig.randomPageClick === 'true';
    const requestedClickCount = Math.max(1, Math.min(10, Number(clickConfig.count) || 1));
    const targetMode = ['first', 'last', 'random'].includes(clickConfig.targetMode) ? clickConfig.targetMode : 'random';
    const config = {
        selectors,
        fallbackToRandomLink: !explicitRandomPageClick && selectors.length > 0 && clickConfig.fallbackToRandomLink !== false,
        randomPageClick: targetMode === 'random',
        clickCount: 1,
        targetMode,
        preventNewWindow: clickConfig.preventNewWindow !== false,
        scrollIntoViewBeforeClick: clickConfig.scrollIntoViewBeforeClick !== false,
        highlightBeforeClick: clickConfig.highlightBeforeClick !== false,
        allowedDomains: Array.isArray(allowedDomains) ? allowedDomains.filter(Boolean) : [],
        excludedHrefs: Array.isArray(clickConfig.excludedHrefs) ? clickConfig.excludedHrefs : []
    };

    const buildClickScript = (runtimeConfig) => `
        (async () => {
            const config = ${JSON.stringify(runtimeConfig)};
            const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            const randomBetween = (min, max) => min + Math.random() * (max - min);
            const allowedDomains = config.allowedDomains.map(domain => {
                return String(domain).replace(/^https?:\\/\\//i, '').split('/')[0].toLowerCase();
            }).filter(Boolean);
            const currentHost = window.location.hostname.toLowerCase();
            if (currentHost && !allowedDomains.includes(currentHost)) {
                allowedDomains.push(currentHost);
            }

            const isDomainAllowed = (url) => {
                if (!allowedDomains.length) return false;
                try {
                    const host = new URL(url, window.location.href).hostname.toLowerCase();
                    return allowedDomains.some(domain => host === domain || host.endsWith('.' + domain));
                } catch (error) {
                    return false;
                }
            };

            const isSafeHref = (href) => {
                if (!href) return false;
                const normalized = String(href).trim().toLowerCase();
                if (
                    normalized.startsWith('javascript:') ||
                    normalized.startsWith('mailto:') ||
                    normalized.startsWith('tel:') ||
                    normalized.startsWith('#')
                ) {
                    return false;
                }

                try {
                    const target = new URL(href, window.location.href);
                    const current = new URL(window.location.href);
                    target.hash = '';
                    current.hash = '';
                    if (target.toString() === current.toString()) {
                        return false;
                    }
                } catch (error) {
                    return false;
                }

                return isDomainAllowed(href);
            };

            const isVisible = (element) => {
                if (!element || !(element instanceof HTMLElement)) return false;
                const style = window.getComputedStyle(element);
                if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
                const rect = element.getBoundingClientRect();
                return rect.width >= 8 && rect.height >= 8;
            };

            const canClickElement = (element) => {
                if (!isVisible(element)) return false;
                const anchor = element.closest('a[href]');
                if (!anchor) return true;
                return isSafeHref(anchor.href);
            };

            const getActionableElement = (element) => {
                if (!element || !(element instanceof HTMLElement)) return null;
                return element.closest('a[href], button, input, select, textarea');
            };

            const hasMeaningfulClickSurface = (element) => {
                if (!element || !(element instanceof HTMLElement)) return false;
                if (element.matches('input, select, textarea')) return true;
                if (element.matches('a[href]') && element.querySelector('img, svg, canvas, video')) return true;
                const label = [
                    element.innerText,
                    element.textContent,
                    element.getAttribute('aria-label'),
                    element.getAttribute('title'),
                    element.getAttribute('alt')
                ].filter(Boolean).join(' ').trim();
                return label.length > 0;
            };

            const getElementLabel = (element) => {
                return [
                    element?.innerText,
                    element?.textContent,
                    element?.getAttribute?.('aria-label'),
                    element?.getAttribute?.('title'),
                    element?.getAttribute?.('alt')
                ].filter(Boolean).join(' ').trim();
            };

            const isNavigationControl = (element) => {
                const label = getElementLabel(element).toLowerCase();
                if (/\\b(menu|main menu|navigation|nav|hamburger|toggle|ouvrir|fermer|close)\\b/.test(label)) return true;
                if (element.matches('button, input, select, textarea') && element.closest('header, nav, [role="navigation"]')) return true;
                return false;
            };

            const findMenuToggle = () => {
                const controls = Array.from(document.querySelectorAll('button, [role="button"], [onclick]'))
                    .filter((element) => element instanceof HTMLElement)
                    .filter(isVisible)
                    .filter(isNavigationControl);

                return controls[0] || null;
            };

            const isSamePageHref = (href) => {
                try {
                    const target = new URL(href, window.location.href);
                    const current = new URL(window.location.href);
                    target.hash = '';
                    current.hash = '';
                    return target.toString() === current.toString();
                } catch (error) {
                    return false;
                }
            };

            const isHomepageHref = (href) => {
                try {
                    const target = new URL(href, window.location.href);
                    const current = new URL(window.location.href);
                    return target.origin === current.origin && (target.pathname === '/' || target.pathname === '') && !target.search && !target.hash;
                } catch (error) {
                    return false;
                }
            };

            const isExcludedHref = (href) => {
                if (!href) return false;
                try {
                    const normalized = new URL(href, window.location.href).toString();
                    return config.excludedHrefs.includes(normalized);
                } catch (error) {
                    return false;
                }
            };

            const getClickRejectReason = (element, options = {}) => {
                const actionable = getActionableElement(element);
                if (!actionable) return 'not-actionable';
                if (!isVisible(actionable)) return 'not-visible';
                if (!actionable.matches('a[href], button, input, select, textarea')) return 'unsupported-tag';
                if (isNavigationControl(actionable)) return 'navigation-control';
                const anchor = actionable.closest('a[href]');
                if (anchor && !options.allowExcludedHref && isExcludedHref(anchor.href)) return 'already-clicked';
                if (anchor && !isSafeHref(anchor.href)) return 'href-not-allowed';
                if (!hasMeaningfulClickSurface(actionable)) return 'empty-surface';
                return null;
            };

            const canClickActionableElement = (element, options = {}) => {
                return getClickRejectReason(element, options) === null;
            };

            const executePointerClick = async (clickable, x, y) => {
                const eventOptions = {
                    view: window,
                    bubbles: true,
                    cancelable: true,
                    clientX: x,
                    clientY: y,
                    button: 0
                };

                clickable.dispatchEvent(new MouseEvent('mouseover', eventOptions));
                clickable.dispatchEvent(new MouseEvent('mousemove', eventOptions));
                await sleep(randomBetween(80, 220));
                clickable.dispatchEvent(new MouseEvent('mousedown', eventOptions));
                await sleep(randomBetween(90, 260));
                clickable.dispatchEvent(new MouseEvent('mouseup', eventOptions));
                const clickEvent = new MouseEvent('click', eventOptions);
                const wasNotCancelled = clickable.dispatchEvent(clickEvent);

                if (wasNotCancelled && typeof clickable.click === 'function') {
                    clickable.click();
                }

                return wasNotCancelled;
            };

            const openNavigationMenuIfNeeded = async () => {
                const toggle = findMenuToggle();
                if (!toggle) return false;

                const rect = toggle.getBoundingClientRect();
                const x = Math.round(rect.left + rect.width / 2);
                const y = Math.round(rect.top + rect.height / 2);
                await executePointerClick(toggle, x, y);
                await sleep(700);
                return true;
            };

            const getSelectorCandidates = () => {
                const diagnostics = {
                    total: 0,
                    actionable: 0,
                    accepted: 0,
                    rejected: []
                };
                const rememberRejected = (element, reason) => {
                    if (!element || diagnostics.rejected.length >= 8) return;
                    const anchor = element.closest?.('a[href]');
                    diagnostics.rejected.push({
                        tagName: element.tagName ? element.tagName.toLowerCase() : null,
                        href: anchor?.href || element.href || element.getAttribute?.('href') || null,
                        text: getElementLabel(element).slice(0, 80),
                        reason,
                        allowedDomains: [...allowedDomains]
                    });
                };
                const filterCandidate = (element) => {
                    diagnostics.actionable += 1;
                    const reason = getClickRejectReason(element);
                    if (!reason) return true;
                    rememberRejected(element, reason);
                    return false;
                };

                for (const selector of config.selectors) {
                    try {
                        const nodes = Array.from(document.querySelectorAll(selector));
                        diagnostics.total += nodes.length;
                        const matches = nodes.map(getActionableElement)
                            .filter((element, index, items) => element && items.indexOf(element) === index)
                            .filter(filterCandidate);
                        diagnostics.accepted += matches.length;
                        if (matches.length) {
                            return {
                                source: 'selector',
                                selector,
                                elements: matches,
                                diagnostics
                            };
                        }
                    } catch (error) {
                        continue;
                    }
                }

                if (!config.selectors.length) {
                    const nodes = Array.from(document.querySelectorAll('a[href], button, input, select, textarea'));
                    diagnostics.total += nodes.length;
                    let usedAlreadyClickedFallback = false;
                    let elements = nodes.map(getActionableElement)
                        .filter((element, index, items) => element && items.indexOf(element) === index)
                        .filter(filterCandidate);
                    if (!elements.length && diagnostics.rejected.some(item => item.reason === 'already-clicked')) {
                        usedAlreadyClickedFallback = true;
                        elements = nodes.map(getActionableElement)
                            .filter((element, index, items) => element && items.indexOf(element) === index)
                            .filter((element) => canClickActionableElement(element, { allowExcludedHref: true }));
                    }
                    diagnostics.accepted += elements.length;

                    return {
                        source: config.targetMode === 'random' ? 'random-page' : 'page-elements',
                        selector: null,
                        elements,
                        diagnostics,
                        usedAlreadyClickedFallback
                    };
                }

                if (!config.fallbackToRandomLink) {
                    return { source: 'none', selector: null, elements: [], diagnostics };
                }

                const links = Array.from(document.querySelectorAll('a[href]')).filter(canClickElement);
                return {
                    source: 'random-link',
                    selector: 'a[href]',
                    elements: links,
                    diagnostics
                };
            };

            const getHiddenLinkFallbackCandidates = (options = {}) => {
                return Array.from(document.querySelectorAll('a[href]'))
                    .filter((anchor, index, items) => anchor instanceof HTMLAnchorElement && items.indexOf(anchor) === index)
                    .filter((anchor) => {
                        if (isVisible(anchor)) return false;
                        if (!options.allowExcludedHref && isExcludedHref(anchor.href)) return false;
                        if (!isSafeHref(anchor.href)) return false;
                        const normalized = String(anchor.getAttribute('href') || '').trim().toLowerCase();
                        if (normalized === '#' || normalized.startsWith('#')) return false;
                        return true;
                    });
            };

            const clickHiddenLinkFallback = (candidates) => {
                if (!candidates.length) return null;
                const preferredCandidates = candidates.filter((anchor) => {
                    return !isSamePageHref(anchor.href)
                        && !(isHomepageHref(anchor.href) && getElementLabel(anchor) === '')
                        && hasMeaningfulClickSurface(anchor);
                });
                const pool = preferredCandidates.length ? preferredCandidates : candidates;
                const anchor = config.targetMode === 'first'
                    ? pool[0]
                    : config.targetMode === 'last'
                        ? pool[pool.length - 1]
                        : pool[Math.floor(Math.random() * pool.length)];

                if (config.preventNewWindow) {
                    anchor.setAttribute('target', '_self');
                    anchor.removeAttribute('rel');
                    window.open = () => null;
                }

                const clickEvent = new MouseEvent('click', {
                    view: window,
                    bubbles: true,
                    cancelable: true,
                    button: 0
                });
                const wasNotCancelled = anchor.dispatchEvent(clickEvent);

                if (wasNotCancelled && typeof anchor.click === 'function') {
                    anchor.click();
                }

                if (wasNotCancelled) {
                    window.location.href = anchor.href;
                }

                return {
                    action: 'click',
                    completed: wasNotCancelled,
                    reason: wasNotCancelled ? null : 'event-cancelled',
                    eventCancelled: !wasNotCancelled,
                    source: 'hidden-link-fallback',
                    targetMode: config.targetMode,
                    tagName: 'a',
                    href: anchor.href,
                    text: getElementLabel(anchor).slice(0, 120)
                };
            };

            const clickElementTarget = async (excludedElements = []) => {
                let candidates = getSelectorCandidates();
                if (!candidates.elements.length && await openNavigationMenuIfNeeded()) {
                    candidates = getSelectorCandidates();
                    candidates.openedNavigationMenu = true;
                }
                const usedAlreadyClickedFallback = !!candidates.usedAlreadyClickedFallback;

                const availableElements = candidates.elements.filter(element => !excludedElements.includes(element));

                if (!availableElements.length) {
                    let hiddenFallbackCandidates = getHiddenLinkFallbackCandidates();
                    let usedHiddenAlreadyClickedFallback = false;
                    if (!hiddenFallbackCandidates.length) {
                        usedHiddenAlreadyClickedFallback = true;
                        hiddenFallbackCandidates = getHiddenLinkFallbackCandidates({ allowExcludedHref: true });
                    }
                    const hiddenFallback = clickHiddenLinkFallback(hiddenFallbackCandidates);
                    if (hiddenFallback) {
                        return {
                            ...hiddenFallback,
                            openedNavigationMenu: !!candidates.openedNavigationMenu,
                            usedAlreadyClickedFallback: usedHiddenAlreadyClickedFallback,
                            diagnostics: candidates.diagnostics
                        };
                    }

                    return {
                        action: 'click',
                        completed: false,
                        reason: 'no-clickable-target',
                        source: candidates.source,
                        targetMode: config.targetMode,
                        diagnostics: candidates.diagnostics,
                        usedAlreadyClickedFallback,
                        openedNavigationMenu: !!candidates.openedNavigationMenu
                    };
                }

                const element = config.targetMode === 'first'
                    ? availableElements[0]
                    : config.targetMode === 'last'
                        ? availableElements[availableElements.length - 1]
                        : availableElements[Math.floor(Math.random() * availableElements.length)];
                const clickable = element.closest('a[href], button, input, select, textarea') || element;
                const anchor = clickable.closest('a[href]');

                if (!canClickActionableElement(clickable, { allowExcludedHref: usedAlreadyClickedFallback })) {
                    return {
                        action: 'click',
                        completed: false,
                        reason: 'invalid-click-target',
                        source: candidates.source,
                        targetMode: config.targetMode,
                        tagName: clickable.tagName.toLowerCase(),
                        text: (clickable.innerText || clickable.textContent || '').trim().slice(0, 120)
                    };
                }

                if (config.preventNewWindow && anchor) {
                    anchor.setAttribute('target', '_self');
                    anchor.removeAttribute('rel');
                }

                if (config.preventNewWindow) {
                    window.open = () => null;
                }

                if (config.scrollIntoViewBeforeClick) {
                    clickable.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                    await sleep(randomBetween(450, 1100));
                }

                if (config.highlightBeforeClick) {
                    const previousOutline = clickable.style.outline;
                    const previousBoxShadow = clickable.style.boxShadow;
                    clickable.style.outline = '3px solid rgba(234, 88, 12, 0.85)';
                    clickable.style.boxShadow = '0 0 0 6px rgba(234, 88, 12, 0.18)';
                    await sleep(randomBetween(300, 800));
                    clickable.style.outline = previousOutline;
                    clickable.style.boxShadow = previousBoxShadow;
                }

                const rect = clickable.getBoundingClientRect();
                const x = Math.round(rect.left + randomBetween(rect.width * 0.25, rect.width * 0.75));
                const y = Math.round(rect.top + randomBetween(rect.height * 0.25, rect.height * 0.75));
                const wasNotCancelled = await executePointerClick(clickable, x, y);

                return {
                    action: 'click',
                    completed: wasNotCancelled,
                    reason: wasNotCancelled ? null : 'event-cancelled',
                    eventCancelled: !wasNotCancelled,
                    source: candidates.source,
                    targetMode: config.targetMode,
                    openedNavigationMenu: !!candidates.openedNavigationMenu,
                    usedAlreadyClickedFallback,
                    selector: candidates.selector,
                    tagName: clickable.tagName.toLowerCase(),
                    href: anchor ? anchor.href : null,
                    text: (clickable.innerText || clickable.textContent || '').trim().slice(0, 120)
                };
            };

            const results = [];
            const excludedElements = [];
            for (let index = 0; index < config.clickCount; index += 1) {
                let result = null;
                for (let attempt = 0; attempt < 5; attempt += 1) {
                    result = await clickElementTarget(excludedElements);
                    results.push(result);
                    if (result.completed || result.reason === 'no-clickable-target') break;
                    if (result.eventCancelled && result.tagName) {
                        const candidates = getSelectorCandidates();
                        const failed = candidates.elements.find(element => {
                            const label = getElementLabel(element);
                            return element.tagName.toLowerCase() === result.tagName && label.slice(0, 120) === (result.text || '');
                        });
                        if (failed) excludedElements.push(failed);
                    }
                }
                if (index < config.clickCount - 1) await sleep(randomBetween(5000, 25000));
            }

            return {
                action: 'click',
                completed: results.some(result => result.completed),
                source: config.randomPageClick ? 'random-page' : 'page-elements',
                count: config.clickCount,
                targetMode: config.targetMode,
                results
            };
        })();
    `;

    const aggregateResults = [];
    const excludedHrefs = [];

    for (let index = 0; index < requestedClickCount; index += 1) {
        config.excludedHrefs = [...excludedHrefs];
        const script = buildClickScript(config);
        const result = await adapter.evaluate(script);
        console.log('[Surf] Click execute:', JSON.stringify(result, null, 2));
        aggregateResults.push({
            index: index + 1,
            ...result
        });

        for (const item of result.results || []) {
            if (item.href && !excludedHrefs.includes(item.href)) {
                excludedHrefs.push(item.href);
            }
        }

        if (index < requestedClickCount - 1) {
            const navigationSettled = adapter.waitForSettle ? await adapter.waitForSettle(9000) : false;
            await delay(randomDelay(5000, 25000));
        }
    }

    return {
        action: 'click',
        completed: aggregateResults.some(result => result.completed),
        source: aggregateResults.find(result => result.source)?.source || 'click',
        count: requestedClickCount,
        targetMode,
        results: aggregateResults
    };
}


module.exports = {
    pickVisitAction,
    isAllowedInteractionDomain,
    runPostLoadInteraction,
    executeHumanScroll,
    executeHumanClick
};
