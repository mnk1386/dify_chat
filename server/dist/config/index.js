"use strict";
/**
 * Central configuration loaded from environment variables.
 * All Dify connection settings come from the environment; nothing is hard-coded.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtimeSettings = void 0;
exports.loadConfig = loadConfig;
exports.normalizeBaseUrl = normalizeBaseUrl;
function envStr(name, def) {
    const v = process.env[name];
    return v === undefined || v === '' ? def : v;
}
function envInt(name, def) {
    const v = process.env[name];
    if (v === undefined || v === '')
        return def;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
}
function normalizeBaseUrl(raw) {
    let url = raw.trim();
    if (!url)
        return '';
    if (!/^https?:\/\//i.test(url))
        url = 'http://' + url;
    url = url.replace(/\/+$/, '');
    // Dify app API base conventionally ends with /v1 — append it when missing.
    if (!/\/v\d+$/i.test(url))
        url = url + '/v1';
    return url;
}
function loadConfig(overrides) {
    const nodeEnv = envStr('NODE_ENV', 'development');
    const secret = envStr('SESSION_SECRET', '');
    if (!secret && nodeEnv === 'production') {
        // Never allow an insecure default in production.
        throw new Error('SESSION_SECRET must be set in production');
    }
    const cfg = {
        appPort: envInt('APP_PORT', 3000),
        databaseUrl: envStr('DATABASE_URL', './data/app.db'),
        sessionSecret: secret || 'dev-only-insecure-secret-change-me',
        difyBaseUrl: normalizeBaseUrl(envStr('DIFY_BASE_URL', '')),
        difyApiKey: envStr('DIFY_API_KEY', ''),
        difyTimeoutMs: envInt('DIFY_TIMEOUT', 120000),
        difyAppType: envStr('DIFY_APP_TYPE', 'chat'),
        nodeEnv,
        secureCookies: (process.env.SECURE_COOKIES !== undefined ? process.env.SECURE_COOKIES === 'true' : nodeEnv === 'production'),
        maxUploadSizeMb: envInt('MAX_UPLOAD_SIZE_MB', 15),
        rateLimitWindowMs: envInt('RATE_LIMIT_WINDOW_MS', 60000),
        rateLimitMax: envInt('RATE_LIMIT_MAX', 120),
        logLevel: envStr('LOG_LEVEL', 'info'),
    };
    if (!['chat', 'completion', 'workflow'].includes(cfg.difyAppType))
        cfg.difyAppType = 'chat';
    return { ...cfg, ...(overrides || {}) };
}
/** Mutable runtime settings (admin can change Dify URL/key/type without redeploy). */
class RuntimeSettings {
    constructor(initial) { this.current = initial; }
    get() { return this.current; }
    update(partial) {
        this.current = { ...this.current, ...partial };
        if (partial.difyBaseUrl !== undefined) {
            this.current.difyBaseUrl = normalizeBaseUrl(partial.difyBaseUrl);
        }
        return this.current;
    }
}
exports.runtimeSettings = new RuntimeSettings(loadConfig());
//# sourceMappingURL=index.js.map