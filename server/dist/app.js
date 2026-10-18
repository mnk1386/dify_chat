"use strict";
/**
 * Express app factory — wires middleware, routes and static frontend.
 * Exported separately from index.ts so tests can create isolated instances.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const config_1 = require("./config");
const auth_1 = require("./middleware/auth");
const auth_2 = require("./routes/auth");
const chat_1 = require("./routes/chat");
const conversations_1 = require("./routes/conversations");
const app_1 = require("./routes/app");
const admin_1 = require("./routes/admin");
const logger_1 = require("./utils/logger");
function createApp() {
    const app = (0, express_1.default)();
    app.disable('x-powered-by');
    app.set('trust proxy', true);
    // Security headers with CSP tuned for an internal app that ships all assets locally.
    app.use((0, helmet_1.default)({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind/vite injects styles; inline needed for theme toggling
                imgSrc: ["'self'", 'data:', 'blob:'],
                mediaSrc: ["'self'", 'blob:'],
                connectSrc: ["'self'"],
                fontSrc: ["'self'", 'data:'],
                objectSrc: ["'none'"],
                frameAncestors: ["'self'"],
                baseUri: ["'self'"],
            },
        },
        crossOriginEmbedderPolicy: false, // allow local blob images
    }));
    // request id for tracing errors (never contains secrets)
    app.use((req, res, next) => {
        const id = req.headers['x-request-id'] || crypto_1.default.randomUUID();
        res.setHeader('X-Request-Id', id);
        next();
    });
    app.use(express_1.default.json({ limit: '1mb' })); // body size guard
    app.use(express_1.default.urlencoded({ extended: false, limit: '1mb' }));
    // Global rate limiting + stricter limiter for AI calls
    app.use('/api/', (0, express_rate_limit_1.default)({
        windowMs: config_1.runtimeSettings.get().rateLimitWindowMs,
        limit: config_1.runtimeSettings.get().rateLimitMax,
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => req.path.startsWith('/auth/login'), // login has its own limiter
        message: { error: { code: 'rate_limited', message: 'تعداد درخواست‌ها بیش از حد مجاز است. لحظی صبر کنید.' } },
    }));
    app.use('/api/chat/send', (0, express_rate_limit_1.default)({
        windowMs: 60000, limit: 20, standardHeaders: true, legacyHeaders: false,
        message: { error: { code: 'rate_limited', message: 'ارسال پیام سریع‌تر از حد مجاز است.' } },
    }));
    app.use(auth_1.attachUser);
    app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
    app.use('/api/auth', auth_2.authRouter);
    app.use('/api/chat', chat_1.chatRouter);
    app.use('/api/conversations', conversations_1.conversationsRouter);
    app.use('/api/app', app_1.appRouter);
    app.use('/api/admin', admin_1.adminRouter);
    // 404 for unknown API endpoints
    app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'مسیر موردنظر یافت نشد.' } }));
    // Static frontend build (single container deployment)
    const webDist = process.env.WEB_DIST_DIR || path_1.default.join(__dirname, '..', '..', 'web', 'dist');
    app.use(express_1.default.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
        res.sendFile(path_1.default.join(webDist, 'index.html'), (err) => {
            if (err) {
                logger_1.logger.debug('static fallback failed', { err: String(err) });
                res.status(200).type('html').send('<!doctype html><html dir="rtl"><body style="font-family:sans-serif;padding:2rem">فرانت‌اند ساخته نشده است. در محیط توسعه از Vite dev server استفاده کنید یا `npm run build` را اجرا کنید.</body></html>');
            }
        });
    });
    // Final error handler — never leaks stack traces.
    app.use((err, _req, res, _next) => {
        logger_1.logger.error('unhandled route error', { message: err.message });
        if (res.headersSent)
            return;
        const status = err.status || 500;
        res.status(status >= 400 && status < 600 ? status : 500).json({
            error: { code: 'internal', message: 'خطای داخلی سرور رخ داد.', requestId: res.getHeader('x-request-id') },
        });
    });
    return app;
}
//# sourceMappingURL=app.js.map