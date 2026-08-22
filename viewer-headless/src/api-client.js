class ApiClient {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
    }

    headers(extra = {}) {
        return {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Access-Key': this.config.accessKey,
            ...extra
        };
    }

    async request(path, options = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
        const startedAt = Date.now();

        try {
            const response = await fetch(`${this.config.baseUrl}${path}`, {
                ...options,
                signal: controller.signal,
                headers: this.headers(options.headers || {})
            });

            const text = await response.text();
            let data = null;
            if (text) {
                try {
                    data = JSON.parse(text);
                } catch (error) {
                    data = { raw: text };
                }
            }

            if (!response.ok) {
                const error = new Error(data?.error || data?.message || `HTTP ${response.status}`);
                error.status = response.status;
                error.data = data;
                throw error;
            }

            return data || {};
        } catch (error) {
            if (error?.name === 'AbortError') {
                const timeoutError = new Error(`request timeout after ${Date.now() - startedAt}ms`);
                timeoutError.code = 'REQUEST_TIMEOUT';
                timeoutError.path = path;
                throw timeoutError;
            }

            error.path = error.path || path;
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    getNextVisit() {
        const params = new URLSearchParams({
            session_id: this.config.sessionId,
            app_version: this.config.appVersion,
            viewer_runtime: this.config.viewerRuntime,
            viewer_platform: this.config.viewerPlatform
        });

        params.append('control_capabilities[]', 'restart_runtime');

        return this.request(`/surf/next?${params.toString()}`, {
            method: 'GET'
        });
    }

    heartbeat(telemetry = {}) {
        return this.request('/surf/heartbeat', {
            method: 'POST',
            body: JSON.stringify({
                session_id: this.config.sessionId,
                app_version: this.config.appVersion,
                viewer_runtime: this.config.viewerRuntime,
                viewer_platform: this.config.viewerPlatform,
                viewer_state: telemetry.viewerState || 'waiting',
                current_website_id: telemetry.currentWebsiteId || null,
                last_completed_at: telemetry.lastCompletedAt || null,
                last_error_code: telemetry.lastErrorCode || null,
                consecutive_failures: telemetry.consecutiveFailures || 0,
                control_capabilities: ['restart_runtime']
            })
        });
    }

    validateVisit(viewToken) {
        return this.request('/surf/validate', {
            method: 'POST',
            body: JSON.stringify({
                view_token: viewToken,
                session_id: this.config.sessionId,
                app_version: this.config.appVersion,
                viewer_runtime: this.config.viewerRuntime,
                viewer_platform: this.config.viewerPlatform,
                control_capabilities: ['restart_runtime']
            })
        });
    }

    cancelVisit(viewToken, reason = 'runtime_failure') {
        return this.request('/surf/cancel', {
            method: 'POST',
            body: JSON.stringify({
                view_token: viewToken,
                reason,
                session_id: this.config.sessionId,
                app_version: this.config.appVersion,
                viewer_runtime: this.config.viewerRuntime,
                viewer_platform: this.config.viewerPlatform,
                control_capabilities: ['restart_runtime']
            })
        });
    }
}

module.exports = {
    ApiClient
};
