"use strict";
/**
 * Shared route error handling: maps AppError to safe JSON responses.
 * Never exposes stack traces or secrets.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleRouteError = handleRouteError;
const errors_1 = require("../utils/errors");
const logger_1 = require("../utils/logger");
const db_1 = require("../db");
function handleRouteError(res, e, req) {
    let status = 500;
    let code = 'internal';
    let message = 'خطای داخلی سرور رخ داد.';
    let detail = e?.message || 'unknown';
    if ((0, errors_1.isAppError)(e)) {
        const err = e;
        status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
        code = err.code.replace(/^dify_/, '');
        message = err.userMessage;
        if (err instanceof errors_1.DifyApiError && err.status === 404)
            status = 404;
    }
    else {
        const anyErr = e;
        if (anyErr?.status) {
            status = anyErr.status;
            code = anyErr.code || 'invalid_input';
            message = anyErr.message || 'ورودی نامعتبر است.';
        }
    }
    if (status >= 500)
        logger_1.logger.error('route failed', { code, detail, userId: req?.user?.id });
    else
        logger_1.logger.warn('route failed', { code, status });
    (0, db_1.logEvent)({
        level: status >= 500 ? 'error' : 'warn', type: `api_${code}`,
        userId: req?.user?.id ?? null, requestId: String(res.getHeader('x-request-id') || ''), detail: detail.slice(0, 300),
    });
    res.status(status).json({ error: { code, message, requestId: res.getHeader('x-request-id') } });
}
//# sourceMappingURL=errors-helper.js.map