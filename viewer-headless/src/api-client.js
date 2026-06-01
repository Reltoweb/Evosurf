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

        return this.request(`/surf/next?${params.toString()}`, {
            method: 'GET'
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
                viewer_platform: this.config.viewerPlatform
            })
        });
    }
}

module.exports = {
    ApiClient
};
