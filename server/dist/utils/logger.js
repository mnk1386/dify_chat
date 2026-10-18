"use strict";
/**
 * Structured application logger.
 * - Technical details go to server logs only.
 * - Secrets (API keys, session tokens) are never logged.
 * - Each request gets a requestId for tracing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.setLogLevel = setLogLevel;
const ORDER = { debug: 10, info: 20, warn: 30, error: 40 };
let minLevel = process.env.LOG_LEVEL || 'info';
function setLogLevel(l) { minLevel = l; }
const SENSITIVE_KEYS = new Set([
    'authorization', 'apikey', 'api_key', 'difyapikey', 'password', 'session',
    'token', 'cookie', 'set-cookie', 'x-api-key', 'secret',
]);
function redact(obj) {
    if (Array.isArray(obj))
        return obj.map(redact);
    if (obj && typeof obj === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(obj)) {
            out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redact(v);
        }
        return out;
    }
    return obj;
}
function emit(level, msg, meta) {
    if (ORDER[level] < ORDER[minLevel])
        return;
    const line = {
        ts: new Date().toISOString(),
        level,
        msg,
        ...(meta !== undefined ? { meta: redact(meta) } : {}),
    };
    const text = JSON.stringify(line);
    if (level === 'error')
        console.error(text);
    else if (level === 'warn')
        console.warn(text);
    else
        console.log(text);
}
exports.logger = {
    debug: (m, meta) => emit('debug', m, meta),
    info: (m, meta) => emit('info', m, meta),
    warn: (m, meta) => emit('warn', m, meta),
    error: (m, meta) => emit('error', m, meta),
};
//# sourceMappingURL=logger.js.map