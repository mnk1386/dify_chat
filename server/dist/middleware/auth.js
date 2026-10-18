"use strict";
/**
 * Session authentication + CSRF protection middleware.
 * - Session cookie: HttpOnly, SameSite=Lax (Strict when SECURE_COOKIES), Secure in prod.
 * - CSRF: double-submit pattern — session-bound token delivered via /api/auth/me,
 *   required in X-CSRF-Token header on state-changing methods.
 * - Authorization checks happen here (backend), never only in the UI.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CSRF_HEADER = exports.SESSION_COOKIE = void 0;
exports.parseCookies = parseCookies;
exports.setSessionCookie = setSessionCookie;
exports.clearSessionCookie = clearSessionCookie;
exports.attachUser = attachUser;
exports.requireAuth = requireAuth;
exports.requireAdmin = requireAdmin;
exports.requireCsrf = requireCsrf;
exports.sessionTtlMs = sessionTtlMs;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
const db_1 = require("../db");
const auth_1 = require("../services/auth");
const errors_1 = require("../utils/errors");
exports.SESSION_COOKIE = 'dchat_session';
exports.CSRF_HEADER = 'x-csrf-token';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h
function parseCookies(req) {
    const header = req.headers.cookie || '';
    const out = {};
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1)
            continue;
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k)
            out[k] = decodeURIComponent(v);
    }
    return out;
}
function setSessionCookie(res, token) {
    const cfg = config_1.runtimeSettings.get();
    const attrs = [
        `${exports.SESSION_COOKIE}=${token}`,
        'HttpOnly',
        `SameSite=${cfg.secureCookies ? 'Strict' : 'Lax'}`,
        'Path=/',
        `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ];
    if (cfg.secureCookies)
        attrs.push('Secure');
    res.setHeader('Set-Cookie', attrs.join('; '));
}
function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `${exports.SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}
function resolveUser(req) {
    // 1) organizational signed-header provider
    const identity = (0, auth_1.authenticateSignedHeader)(req.headers['x-auth-user'], req.headers['x-auth-sign']);
    if (identity) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { ensureUser } = require('../services/auth');
        return ensureUser(identity);
    }
    // 2) local session cookie
    const cookies = parseCookies(req);
    const token = cookies[exports.SESSION_COOKIE];
    if (!token)
        return null;
    const sess = (0, db_1.getSession)(token);
    if (!sess)
        return null;
    const user = (0, db_1.findUserById)(sess.user_id);
    if (!user)
        return null;
    req.sessionToken = token;
    req.csrfToken = sess.csrf_token;
    return user;
}
function attachUser(req, _res, next) {
    req.user = resolveUser(req) || undefined;
    next();
}
function requireAuth(req, res, next) {
    if (!req.user) {
        (0, db_1.logEvent)({ level: 'security', type: 'unauthorized_api', requestId: res.getHeader('x-request-id') });
        res.status(401).json({ error: { code: 'unauthenticated', message: 'برای ادامه باید وارد سامانه شوید.' } });
        return;
    }
    next();
}
function requireAdmin(req, res, next) {
    if (!req.user) {
        res.status(401).json({ error: { code: 'unauthenticated', message: 'برای ادامه باید وارد سامانه شوید.' } });
        return;
    }
    if (req.user.role !== 'admin') {
        (0, db_1.logEvent)({ level: 'security', type: 'admin_access_denied', userId: req.user.id, requestId: res.getHeader('x-request-id') });
        res.status(403).json({ error: { code: 'forbidden', message: 'این بخش فقط برای مدیر سامانه است.' } });
        return;
    }
    next();
}
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
function requireCsrf(req, res, next) {
    if (SAFE_METHODS.has(req.method))
        return next();
    if (!req.user)
        return next(); // unauthenticated handled by requireAuth ordering
    const provided = String(req.headers[exports.CSRF_HEADER] || '');
    const expected = req.csrfToken || '';
    let ok = false;
    try {
        ok = provided.length > 0 && expected.length > 0 &&
            crypto_1.default.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    }
    catch {
        ok = false;
    }
    if (!ok) {
        (0, db_1.logEvent)({ level: 'security', type: 'csrf_failure', userId: req.user?.id, requestId: res.getHeader('x-request-id') });
        res.status(403).json({ error: { code: 'csrf_failed', message: 'اعتبار درخواست (CSRF) تأیید نشد. صفحه را بازخوانی کنید.' } });
        return;
    }
    next();
}
function sessionTtlMs() { return SESSION_TTL_MS; }
void errors_1.AppError; // keep import graph stable
//# sourceMappingURL=auth.js.map