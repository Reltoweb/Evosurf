const http = require('http');
const { runVisit } = require('../../electron/viewer-core');
const { createLogger } = require('./logger');
const { createPlaywrightSurfAdapter, launchBrowser } = require('./playwright-adapter');

function createSmokeServer() {
    return http.createServer((request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(`<!doctype html>
            <html>
                <head><title>EvoSurf Smoke</title></head>
                <body>
                    <button id="smoke-button">Click me</button>
                    <main style="height: 3000px; padding: 40px;">Smoke page</main>
                    <script>
                        document.getElementById('smoke-button').addEventListener('click', function () {
                            document.body.dataset.clicked = '1';
                        });
                    </script>
                </body>
            </html>`);
    });
}

async function main() {
    const server = createSmokeServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    const port = server.address().port;
    const logger = createLogger('smoke');
    const browser = await launchBrowser({ headless: true });
    const adapter = createPlaywrightSurfAdapter({
        browser,
        config: { navigationTimeoutMs: 10000 },
        logger
    });

    try {
        await runVisit({
            payload: {
                target: {
                    url: `http://127.0.0.1:${port}/`,
                    allowedDomains: ['127.0.0.1']
                },
                device: { type: 'desktop' },
                referrer: { mode: 'direct' },
                interactions: {
                    probabilities: { none: 0, scroll: 0, click: 100 },
                    click: {
                        randomPageClick: true,
                        targetMode: 'random',
                        preventNewWindow: true,
                        highlightBeforeClick: false
                    }
                },
                timing: { waitAfterLoadMs: 100 }
            },
            adapter,
            emitLog: payload => logger.interaction(payload)
        });

        console.log('smoke-ok');
    } finally {
        await adapter.stop().catch(() => {});
        await browser.close().catch(() => {});
        server.close();
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
