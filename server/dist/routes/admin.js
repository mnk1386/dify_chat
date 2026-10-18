"use strict";
/**
 * Admin settings routes.
 * - Only role=admin can read/write (checked in middleware).
 * - API key is write-only: stored server-side (env default or DB override), never returned.
 * - Connection test endpoint returns understandable Persian errors.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const validation_1 = require("../utils/validation");
const config_1 = require("../config");
const db_1 = require("../db");
const dify = __importStar(require("../dify/client"));
const errors_helper_1 = require("./errors-helper");
const logger_1 = require("../utils/logger");
exports.adminRouter = (0, express_1.Router)();
exports.adminRouter.use(auth_1.requireAdmin);
function maskKey(key) {
    if (!key)
        return '';
    if (key.length <= 8)
        return '••••';
    return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
/* GET /api/admin/settings — no secret values are ever included */
exports.adminRouter.get('/settings', (_req, res) => {
    const cfg = config_1.runtimeSettings.get();
    res.json({
        difyBaseUrl: cfg.difyBaseUrl,
        apiKeySet: Boolean(cfg.difyApiKey),
        apiKeyMasked: maskKey(cfg.difyApiKey),
        difyTimeoutMs: cfg.difyTimeoutMs,
        difyAppType: cfg.difyAppType,
        maxUploadSizeMb: cfg.maxUploadSizeMb,
        uiFont: (0, db_1.getSetting)('ui_font') || 'vazirmatn',
        uiThemeDefault: (0, db_1.getSetting)('ui_theme_default') || 'auto',
        authProvider: process.env.AUTH_PROVIDER || 'local',
        versions: { node: process.version, server: '1.0.0' },
    });
});
/* PUT /api/admin/settings */
exports.adminRouter.put('/settings', auth_1.requireCsrf, (req, res) => {
    try {
        const body = (0, validation_1.validate)(validation_1.adminSettingsSchema, req.body);
        const updates = {};
        if (body.difyBaseUrl !== undefined) {
            updates.difyBaseUrl = body.difyBaseUrl;
            (0, db_1.setSetting)('dify_base_url', body.difyBaseUrl);
        }
        if (body.difyApiKey !== undefined && body.difyApiKey !== '') {
            updates.difyApiKey = body.difyApiKey;
            (0, db_1.setSetting)('dify_api_key', body.difyApiKey, true); // stored server-side only
            logger_1.logger.info('dify api key updated by admin', { userId: req.user.id });
        }
        if (body.difyTimeoutMs !== undefined) {
            updates.difyTimeoutMs = body.difyTimeoutMs;
            (0, db_1.setSetting)('dify_timeout_ms', String(body.difyTimeoutMs));
        }
        if (body.difyAppType !== undefined) {
            updates.difyAppType = body.difyAppType;
            (0, db_1.setSetting)('dify_app_type', body.difyAppType);
        }
        if (body.maxUploadSizeMb !== undefined) {
            updates.maxUploadSizeMb = body.maxUploadSizeMb;
            (0, db_1.setSetting)('max_upload_size_mb', String(body.maxUploadSizeMb));
        }
        if (body.uiFont !== undefined)
            (0, db_1.setSetting)('ui_font', body.uiFont);
        if (body.uiThemeDefault !== undefined)
            (0, db_1.setSetting)('ui_theme_default', body.uiThemeDefault);
        config_1.runtimeSettings.update(updates);
        res.json({ ok: true });
    }
    catch (e) {
        (0, errors_helper_1.handleRouteError)(res, e, req);
    }
});
/* POST /api/admin/test-connection — uses current settings (or draft values passed in) */
exports.adminRouter.post('/test-connection', auth_1.requireCsrf, async (req, res) => {
    try {
        const draft = (req.body || {});
        let restore = null;
        if (draft.difyBaseUrl || draft.difyApiKey) {
            const before = { ...config_1.runtimeSettings.get() };
            config_1.runtimeSettings.update({
                ...(draft.difyBaseUrl ? { difyBaseUrl: draft.difyBaseUrl } : {}),
                ...(draft.difyApiKey ? { difyApiKey: draft.difyApiKey } : {}),
            });
            restore = () => config_1.runtimeSettings.update(before);
        }
        const result = await dify.checkConnection();
        if (restore)
            restore();
        res.json({
            ok: result.ok,
            appName: result.info?.name || null,
            appDescription: result.info?.description || null,
            siteTitle: result.site?.title || null,
            error: result.error || null, // already human-readable Persian
            errorCode: result.errorCode || null,
        });
    }
    catch (e) {
        (0, errors_helper_1.handleRouteError)(res, e, req);
    }
});
/* GET /api/admin/events — technical/error events for diagnostics (sanitized) */
exports.adminRouter.get('/events', (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit || '100'), 10) || 100, 500);
    res.json({ data: (0, db_1.recentEvents)(limit) });
});
//# sourceMappingURL=admin.js.map