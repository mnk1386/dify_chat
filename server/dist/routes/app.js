"use strict";
/**
 * App meta routes (available to authenticated users): app info/parameters/site,
 * connection status (non-secret), file-upload limits derived from Dify /parameters.
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
exports.appRouter = void 0;
const express_1 = require("express");
const dify = __importStar(require("../dify/client"));
const config_1 = require("../config");
const errors_helper_1 = require("./errors-helper");
exports.appRouter = (0, express_1.Router)();
/* GET /api/app/status — safe, non-secret connectivity snapshot for the UI badge */
exports.appRouter.get('/status', async (req, res) => {
    try {
        const cfg = config_1.runtimeSettings.get();
        const check = await dify.checkConnection();
        res.json({
            configured: Boolean(cfg.difyBaseUrl && cfg.difyApiKey),
            connected: check.ok,
            appName: check.info?.name || null,
            appDescription: check.info?.description || null,
            siteTitle: check.site?.title || null,
            appType: cfg.difyAppType,
            error: check.ok ? null : check.error,
            errorCode: check.ok ? null : check.errorCode,
        });
    }
    catch (e) {
        (0, errors_helper_1.handleRouteError)(res, e, req);
    }
});
/* GET /api/app/parameters — opening statement, suggested questions, upload limits, user input form */
exports.appRouter.get('/parameters', async (req, res) => {
    try {
        const user = req.user;
        const p = await dify.getParameters(user.dify_user_id);
        // Normalize limits into a simple contract for the frontend.
        const sys = p.system_parameters?.file_upload || p;
        res.json({
            opening_statement: p.opening_statement || '',
            suggested_questions: Array.isArray(p.suggested_questions) ? p.suggested_questions : [],
            user_input_form: p.user_input_form || [],
            file_upload: {
                enabled: Boolean(p.file_upload?.enabled ?? p.file_upload),
                number_limits: p.file_upload?.number_limits ?? 1,
                image_file_size_limit_mb: toMb(sys.image_file_size_limit),
                audio_file_size_limit_mb: toMb(sys.audio_file_size_limit),
                video_file_size_limit_mb: toMb(sys.video_file_size_limit),
                file_size_limit_mb: toMb(sys.file_size_limit),
                file_upload_limit: sys.file_upload_limit ?? 10,
            },
            tts_available: Boolean(p.tts_config), // refined by actual call errors
        });
    }
    catch (e) {
        (0, errors_helper_1.handleRouteError)(res, e, req);
    }
});
function toMb(bytes) {
    if (bytes === null || bytes === undefined)
        return null;
    return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}
//# sourceMappingURL=app.js.map