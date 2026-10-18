"use strict";
/**
 * Auth routes: login / logout / me.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const validation_1 = require("../utils/validation");
const auth_1 = require("../services/auth");
const db_1 = require("../db");
const auth_2 = require("../middleware/auth");
exports.authRouter = (0, express_1.Router)();
const loginLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'تعداد تلاش‌های ورود بیش از حد است. کمی صبر کنید.' } },
});
exports.authRouter.get('/provider', (_req, res) => {
    // Expose only the provider name; no secrets.
    res.json({ provider: (0, auth_1.currentConfiguredProvider)() });
});
exports.authRouter.post('/login', loginLimiter, async (req, res) => {
    try {
        const body = (0, validation_1.validate)(validation_1.loginSchema, req.body);
        const identity = await (0, auth_1.authenticateCredentials)(body);
        if (!identity) {
            (0, db_1.logEvent)({ level: 'security', type: 'login_failed', detail: `user=${body.username}` });
            res.status(401).json({ error: { code: 'invalid_credentials', message: 'نام کاربری یا رمز عبور نادرست است.' } });
            return;
        }
        const user = (0, auth_1.ensureUser)(identity);
        const { token } = (0, db_1.createSession)(user.id, (0, auth_2.sessionTtlMs)());
        (0, auth_2.setSessionCookie)(res, token);
        res.json({ ok: true });
    }
    catch (e) {
        next_error(res, e);
    }
});
exports.authRouter.post('/logout', (req, res) => {
    const cookies = require('../middleware/auth').parseCookies(req);
    const token = cookies[require('../middleware/auth').SESSION_COOKIE];
    if (token)
        (0, db_1.deleteSessionByToken)(token);
    (0, auth_2.clearSessionCookie)(res);
    res.json({ ok: true });
});
exports.authRouter.get('/me', auth_2.requireAuth, (req, res) => {
    const u = req.user;
    res.json({
        user: {
            id: u.id,
            username: u.username,
            displayName: u.display_name,
            role: u.role,
        },
        csrfToken: req.csrfToken, // CSRF double-submit token is safe to expose to its own session owner
    });
});
function next_error(res, e) {
    const status = e.status || 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({
        error: { code: 'internal', message: 'خطای داخلی رخ داد.' },
    });
}
//# sourceMappingURL=auth.js.map