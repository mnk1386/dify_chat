"use strict";
/**
 * Chat routes: streaming send (SSE relay), stop, feedback, suggested questions,
 * TTS/STT audio endpoints. Browser talks ONLY to these backend endpoints;
 * the Dify API key never reaches the client.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatRouter = void 0;
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const auth_1 = require("../middleware/auth");
const validation_1 = require("../utils/validation");
const dify = __importStar(require("../dify/client"));
const errors_1 = require("../utils/errors");
const logger_1 = require("../utils/logger");
const db_1 = require("../db");
const ownership_1 = require("../middleware/ownership");
const crypto_1 = __importDefault(require("crypto"));
exports.chatRouter = (0, express_1.Router)();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const activeStreams = new Map(); // local streamId -> state
/* ---------------- POST /api/chat/send — relays SSE from Dify to browser ---------------- */
exports.chatRouter.post('/send', auth_1.requireCsrf, async (req, res) => {
    let body;
    try {
        body = (0, validation_1.validate)(validation_1.chatSendSchema, req.body);
    }
    catch (e) {
        const err = e;
        res.status(err.status || 400).json({ error: { code: err.code || 'invalid_input', message: err.message || 'ورودی نامعتبر است.' } });
        return;
    }
    const user = req.user;
    const difyUser = user.dify_user_id; // stable unguessable per-user id
    if (body.conversationId && !(0, ownership_1.assertConversationOwnership)(req, res, () => undefined, body.conversationId))
        return;
    // Idempotency: reject duplicate clientMsgId within a short window (prevents double sends).
    const dedupeKey = body.clientMsgId ? `idem:${user.id}:${body.clientMsgId}` : null;
    if (dedupeKey) {
        if (recentIds.has(dedupeKey)) {
            res.status(409).json({ error: { code: 'duplicate_request', message: 'این پیام پیش‌تر ارسال شده است.' } });
            return;
        }
        recentIds.add(dedupeKey);
        setTimeout(() => recentIds.delete(dedupeKey), 60000);
    }
    const streamId = crypto_1.default.randomUUID();
    const abort = new AbortController();
    const state = { abort, userId: user.id };
    activeStreams.set(streamId, state);
    // SSE headers toward the browser
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const sendFrame = (obj) => {
        try {
            res.write(`data: ${JSON.stringify(obj)}\n\n`);
        }
        catch { /* connection closed */ }
    };
    // Accumulate assistant text for preview cache + dedupe safety.
    let accumulated = '';
    let sawMessageEnd = false;
    const onEvent = (ev) => {
        if (ev.task_id)
            state.taskId = ev.task_id;
        if (ev.conversation_id)
            state.conversationIdSeen = ev.conversation_id;
        if (ev.message_id)
            state.messageIdSeen = ev.message_id;
        if (ev.event === 'message' || ev.event === 'agent_message') {
            const chunk = ev.answer ?? '';
            // Deduplication guard: if a variant of the API repeats full text instead of deltas,
            // only forward the suffix we haven't sent yet.
            let delta = chunk;
            if (chunk.length > accumulated.length && chunk.startsWith(accumulated)) {
                delta = chunk.slice(accumulated.length);
                accumulated = chunk;
            }
            else {
                accumulated += chunk;
            }
            if (delta)
                sendFrame({ event: 'delta', answer: delta, conversation_id: ev.conversation_id, message_id: ev.message_id, task_id: ev.task_id });
        }
        else if (ev.event === 'message_file' || ev.event === 'message_replace') {
            sendFrame(ev);
        }
        else if (ev.event === 'message_end') {
            sawMessageEnd = true;
            const meta = (ev.data || {});
            sendFrame({
                event: 'end',
                conversation_id: ev.conversation_id,
                message_id: ev.message_id,
                // Only forward usage/retriever info that Dify actually returned:
                ...(meta.usage ? { usage: meta.usage } : {}),
                ...(meta.reference ? { reference: meta.reference } : {}),
                ...(Array.isArray(meta.retriever_resources) && meta.retriever_resources.length ? { retriever_resources: meta.retriever_resources } : {}),
            });
        }
        else if (ev.event === 'error') {
            sendFrame({ event: 'error', code: ev.code, message: ev.message });
        }
        else if (ev.event.startsWith('workflow_') || ev.event.startsWith('node_')) {
            sendFrame(ev); // workflow progress events forwarded verbatim
        }
    };
    const cleanup = () => { activeStreams.delete(streamId); };
    req.on('close', () => { abort.abort(); cleanup(); });
    try {
        const files = (body.files || []).map(f => ({
            type: f.type,
            transfer_method: f.transfer_method,
            url: f.url,
            upload_file_id: f.upload_file_id,
        }));
        const cfgType = require('../config').runtimeSettings.get().difyAppType;
        if (cfgType === 'completion') {
            await dify.streamCompletion({ inputs: (body.inputs || { query: body.query }), user: difyUser, conversationId: body.conversationId || undefined, onEvent, signal: abort.signal });
        }
        else if (cfgType === 'workflow') {
            await dify.streamWorkflow({ inputs: { ...(body.inputs || {}), query: body.query }, user: difyUser, onEvent, signal: abort.signal });
        }
        else {
            await dify.streamChat({
                query: body.query, user: difyUser, conversationId: body.conversationId || null,
                files: files.length ? files : undefined, inputs: body.inputs, onEvent, signal: abort.signal,
            });
        }
        if (!sawMessageEnd)
            sendFrame({ event: 'end', note: 'stream_closed_without_end' });
        // Index & preview caching (source of truth stays in Dify; we keep only metadata/previews)
        if (state.conversationIdSeen) {
            (0, db_1.upsertConversationIndex)({ userId: user.id, difyConversationId: state.conversationIdSeen, lastActivityAt: Math.floor(Date.now() / 1000) });
        }
        if (state.messageIdSeen && accumulated) {
            (0, db_1.cacheMessagePreview)({ userId: user.id, difyConversationId: state.conversationIdSeen || '', difyMessageId: state.messageIdSeen, role: 'assistant', content: accumulated });
            (0, db_1.cacheMessagePreview)({ userId: user.id, difyConversationId: state.conversationIdSeen || '', difyMessageId: state.messageIdSeen + '-q', role: 'user', content: body.query });
        }
        sendFrame({ event: 'stream_end', stream_id: streamId });
    }
    catch (e) {
        const err = normalizeError(e);
        (0, db_1.logEvent)({ level: 'error', type: 'chat_stream_error', userId: user.id, detail: `${err.code}: ${err.detail}`.slice(0, 500) });
        logger_1.logger.warn('chat stream error', { code: err.code, status: err.status });
        sendFrame({ event: 'app_error', code: err.code.replace(/^dify_/, ''), message: err.userMessage, retryable: err.retryable });
    }
    finally {
        cleanup();
        res.end();
    }
});
/* ---------------- POST /api/chat/stop ---------------- */
exports.chatRouter.post('/stop', auth_1.requireCsrf, async (req, res) => {
    try {
        const body = (0, validation_1.validate)(validation_1.stopSchema, req.body);
        const user = req.user;
        const result = await dify.stopTask(body.taskId, user.dify_user_id);
        // Abort our relay side too so UI state recovers cleanly.
        for (const [, st] of activeStreams) {
            if (st.userId === user.id && st.taskId === body.taskId)
                st.abort.abort();
        }
        res.json({ ok: true, result });
    }
    catch (e) {
        handle(res, e, req);
    }
});
/* ---------------- POST /api/chat/feedback/:messageId ---------------- */
exports.chatRouter.post('/feedback/:messageId', auth_1.requireCsrf, async (req, res) => {
    try {
        const body = (0, validation_1.validate)(validation_1.feedbackSchema, req.body);
        const user = req.user;
        const rating = body.rating === 'null' ? null : body.rating;
        const result = await dify.feedback(req.params.messageId, user.dify_user_id, rating, body.content);
        res.json({ ok: true, result });
    }
    catch (e) {
        handle(res, e, req);
    }
});
/* ---------------- GET /api/chat/suggested/:messageId ---------------- */
exports.chatRouter.get('/suggested/:messageId', async (req, res) => {
    try {
        const user = req.user;
        const data = await dify.suggestedQuestions(req.params.messageId, user.dify_user_id);
        res.json(data);
    }
    catch (e) {
        handle(res, e, req);
    }
});
/* ---------------- Files ---------------- */
exports.chatRouter.post('/files/upload', auth_1.requireCsrf, upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            res.status(400).json({ error: { code: 'no_file', message: 'فایلی ارسال نشده است.' } });
            return;
        }
        const cfg = require('../config').runtimeSettings.get();
        const check = (0, validation_1.validateFileMeta)(file.originalname, file.size, cfg.maxUploadSizeMb);
        if (!check.ok) {
            const messages = {
                unsupported_type: 'نوع این فایل پشتیبانی نمی‌شود.',
                blocked_type: 'این نوع فایل به دلایل امنیتی مجاز نیست.',
                too_large: `حجم فایل بیش از حد مجاز (${cfg.maxUploadSizeMb} مگابایت) است.`,
                empty_file: 'فایل خالی است.',
                file_no_extension: 'پسوند فایل مشخص نیست.',
            };
            res.status(400).json({ error: { code: check.reason || 'invalid_file', message: messages[check.reason || ''] || 'فایل نامعتبر است.' } });
            return;
        }
        const uploaded = await dify.uploadFile(file.buffer, file.originalname, file.mimetype, req.user.dify_user_id);
        res.json({
            id: uploaded.id, name: uploaded.name, size: uploaded.size,
            mime_type: uploaded.mime_type, extension: uploaded.extension,
            file_type: (0, validation_1.classifyFileType)(file.originalname),
        });
    }
    catch (e) {
        handle(res, e, req);
    }
});
/* ---------------- Audio ---------------- */
exports.chatRouter.post('/audio/to-text', auth_1.requireCsrf, upload.single('audio'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            res.status(400).json({ error: { code: 'no_audio', message: 'فایل صوتی دریافت نشد.' } });
            return;
        }
        const cfg = require('../config').runtimeSettings.get();
        if (file.size > cfg.maxUploadSizeMb * 1024 * 1024) {
            res.status(413).json({ error: { code: 'too_large', message: 'حجم فایل صوتی بیش از حد مجاز است.' } });
            return;
        }
        const out = await dify.audioToText(file.buffer, file.originalname || 'audio.webm', req.user.dify_user_id);
        res.json(out);
    }
    catch (e) {
        handle(res, e, req);
    }
});
exports.chatRouter.post('/audio/from-text', auth_1.requireCsrf, async (req, res) => {
    try {
        const body = (0, validation_1.validate)(validation_1.ttsSchema, req.body);
        const out = await dify.textToAudio(body.text, req.user.dify_user_id);
        res.setHeader('Content-Type', out.contentType);
        res.send(out.buffer);
    }
    catch (e) {
        handle(res, e, req);
    }
});
/* ---------------- helpers ---------------- */
const recentIds = new Set();
function normalizeError(e) {
    if ((0, errors_1.isAppError)(e)) {
        const err = e;
        const retryable = err instanceof errors_1.DifyApiError && ['timeout', 'network_error', 'server_error', 'too_many_requests'].includes(err.difyCode);
        return { status: err.status || 502, code: err.code, userMessage: err.userMessage, detail: err.detail || '', retryable };
    }
    return { status: 500, code: 'internal', userMessage: 'خطای داخلی سرور رخ داد.', detail: e?.message || 'unknown', retryable: false };
}
function handle(res, e, req) {
    const err = normalizeError(e);
    if (err.status >= 500)
        logger_1.logger.error('request failed', { code: err.code, detail: err.detail, userId: req.user?.id });
    else
        logger_1.logger.warn('request failed', { code: err.code, status: err.status });
    (0, db_1.logEvent)({ level: err.status >= 500 ? 'error' : 'warn', type: `api_${err.code}`, userId: req.user?.id, requestId: String(res.getHeader('x-request-id') || ''), detail: err.detail });
    res.status(err.status >= 400 && err.status < 600 ? err.status : 500).json({
        error: { code: err.code.replace(/^dify_/, ''), message: err.userMessage, requestId: res.getHeader('x-request-id') },
    });
}
//# sourceMappingURL=chat.js.map