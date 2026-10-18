"use strict";
/**
 * Dify REST API client (server-side only).
 * Implements the official App Service API contract (Dify >= 0.6):
 *   GET  /info, /parameters, /meta, /site, /conversations, /messages,
 *        /conversation/variables? Actually: GET /conversations/{id}/variables
 *   POST /chat-messages (streaming SSE), /chat-messages/{task_id}/stop,
 *        /completion-messages, /workflows/run, /files/upload,
 *        /messages/{id}/feedbacks, /messages/{id}/suggested,
 *        /audio-to-text, /text-to-audio
 *   PUT  /conversations/{id}/name, /conversations/{id}/variables/{var}
 *   DELETE /conversations/{id}?rename? -> POST .../name ; DELETE /conversations/{id}
 * Auth: Authorization: Bearer {API_KEY} — key never leaves the server.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAppInfo = getAppInfo;
exports.getSite = getSite;
exports.getParameters = getParameters;
exports.getMeta = getMeta;
exports.checkConnection = checkConnection;
exports.listConversations = listConversations;
exports.getMessages = getMessages;
exports.renameConversation = renameConversation;
exports.deleteConversation = deleteConversation;
exports.getConversationVariables = getConversationVariables;
exports.updateConversationVariable = updateConversationVariable;
exports.feedback = feedback;
exports.suggestedQuestions = suggestedQuestions;
exports.stopTask = stopTask;
exports.audioToText = audioToText;
exports.textToAudio = textToAudio;
exports.uploadFile = uploadFile;
exports.streamChat = streamChat;
exports.streamCompletion = streamCompletion;
exports.streamWorkflow = streamWorkflow;
exports.newRequestId = newRequestId;
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const errors_1 = require("../utils/errors");
const crypto_1 = __importDefault(require("crypto"));
function base() {
    const cfg = config_1.runtimeSettings.get();
    if (!cfg.difyBaseUrl || !cfg.difyApiKey) {
        throw new errors_1.DifyApiError(503, 'not_configured', 'تنظیمات اتصال به Dify کامل نیست.');
    }
    return cfg.difyBaseUrl;
}
function headers(extra = {}) {
    const cfg = config_1.runtimeSettings.get();
    return {
        Authorization: `Bearer ${cfg.difyApiKey}`,
        'Content-Type': 'application/json',
        ...extra,
    };
}
async function fetchWithTimeout(url, init = {}) {
    const cfg = config_1.runtimeSettings.get();
    const timeoutMs = init.timeoutMs ?? cfg.difyTimeoutMs;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: ctrl.signal });
    }
    catch (err) {
        const name = err?.name;
        if (name === 'AbortError')
            throw new errors_1.DifyApiError(504, 'timeout', 'ارتباط با سرویس هوش مصنوعی قطع شد (Timeout).');
        throw new errors_1.DifyApiError(0, 'network_error', 'خطای شبکه در ارتباط با سرویس هوش مصنوعی.');
    }
    finally {
        clearTimeout(t);
    }
}
async function jsonRequest(method, pathAndQuery, body, timeoutMs) {
    const url = base() + pathAndQuery;
    const res = await fetchWithTimeout(url, {
        method,
        headers: headers(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        timeoutMs,
    });
    return parseJsonResponse(res, pathAndQuery);
}
async function parseJsonResponse(res, ctx) {
    let payload = null;
    const text = await res.text().catch(() => '');
    try {
        payload = text ? JSON.parse(text) : null;
    }
    catch { /* non-json error page */ }
    if (!res.ok) {
        const p = payload;
        const code = p?.code || httpCodeToName(res.status);
        logger_1.logger.warn('dify api error', { status: res.status, code, ctx });
        throw new errors_1.DifyApiError(res.status, code, p?.message || undefined);
    }
    if (!payload)
        throw new errors_1.DifyApiError(502, 'invalid_response', 'پاسخ نامعتبر از سرویس دریافت شد.');
    return payload;
}
function httpCodeToName(status) {
    switch (status) {
        case 400: return 'bad_request';
        case 401: return 'unauthorized';
        case 403: return 'forbidden';
        case 404: return 'not_found';
        case 413: return 'file_too_large';
        case 429: return 'too_many_requests';
        default: return status >= 500 ? 'server_error' : 'unknown_error';
    }
}
/* ---------------- Simple endpoints ---------------- */
async function getAppInfo() { return jsonRequest('GET', '/info'); }
async function getSite() { return jsonRequest('GET', '/site'); }
async function getParameters(user) {
    return jsonRequest('GET', `/parameters?user=${encodeURIComponent(user)}`);
}
async function getMeta(user) {
    return jsonRequest('GET', `/meta?user=${encodeURIComponent(user)}`); // requires meta from last message workflow runs
}
async function checkConnection() {
    try {
        const [info, site] = await Promise.all([getAppInfo(), getSite()]);
        return { ok: true, info, site };
    }
    catch (e) {
        const err = e;
        return { ok: false, error: err.userMessage, errorCode: err.code };
    }
}
async function listConversations(user, lastId, limit = 20) {
    const q = new URLSearchParams({ user, limit: String(limit) });
    if (lastId)
        q.set('last_id', lastId);
    return jsonRequest('GET', `/conversations?${q.toString()}`);
}
async function getMessages(conversationId, user, firstId, limit = 20) {
    const q = new URLSearchParams({ conversation_id: conversationId, user, limit: String(limit) });
    if (firstId)
        q.set('first_id', firstId);
    return jsonRequest('GET', `/messages?${q.toString()}`);
}
async function renameConversation(conversationId, user, name) {
    return jsonRequest('POST', `/conversations/${encodeURIComponent(conversationId)}/name`, { name, user });
}
async function deleteConversation(conversationId, user) {
    return jsonRequest('DELETE', `/conversations/${encodeURIComponent(conversationId)}?user=${encodeURIComponent(user)}`);
}
async function getConversationVariables(conversationId, user) {
    return jsonRequest('GET', `/conversations/${encodeURIComponent(conversationId)}/variables?user=${encodeURIComponent(user)}`);
}
async function updateConversationVariable(conversationId, variableId, user, value) {
    return jsonRequest('PUT', `/conversations/${encodeURIComponent(conversationId)}/variables/${encodeURIComponent(variableId)}`, { value, user });
}
async function feedback(messageId, user, rating, content) {
    return jsonRequest('POST', `/messages/${encodeURIComponent(messageId)}/feedbacks`, { rating, user, content: content || null });
}
async function suggestedQuestions(messageId, user) {
    return jsonRequest('GET', `/messages/${encodeURIComponent(messageId)}/suggested?user=${encodeURIComponent(user)}`);
}
async function stopTask(taskId, user) {
    return jsonRequest('POST', `/chat-messages/${encodeURIComponent(taskId)}/stop`, { user });
}
async function audioToText(fileBuffer, filename, user) {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: guessMime(filename) });
    form.append('file', blob, filename);
    form.append('user', user);
    const cfg = config_1.runtimeSettings.get();
    const res = await fetchWithTimeout(base() + '/audio-to-text', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.difyApiKey}` },
        body: form,
    });
    return parseJsonResponse(res, '/audio-to-text');
}
async function textToAudio(text, user) {
    const cfg = config_1.runtimeSettings.get();
    const res = await fetchWithTimeout(base() + '/text-to-audio', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ text, user }),
    });
    if (!res.ok) {
        let payload = null;
        try {
            payload = (await res.json());
        }
        catch { /* ignore */ }
        throw new errors_1.DifyApiError(res.status, payload?.code || httpCodeToName(res.status), payload?.message);
    }
    const ct = res.headers.get('content-type') || 'audio/mp3';
    const ab = await res.arrayBuffer();
    return { buffer: Buffer.from(ab), contentType: ct };
}
async function uploadFile(fileBuffer, filename, mimeType, user) {
    const cfg = config_1.runtimeSettings.get();
    const form = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
    form.append('file', blob, filename);
    form.append('user', user);
    const res = await fetchWithTimeout(base() + '/files/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.difyApiKey}` },
        body: form,
    });
    return parseJsonResponse(res, '/files/upload');
}
/**
 * POST /chat-messages with response_mode=streaming and parses the SSE stream.
 * Deduplication note: Dify sends incremental "message" events whose `answer` is a DELTA.
 * We forward deltas; the caller accumulates them. If an endpoint variant returns full text
 * per event (older versions), the caller's accumulation logic tolerates it by tracking length.
 */
async function streamChat(p) {
    const cfg = config_1.runtimeSettings.get();
    const body = {
        inputs: p.inputs || {},
        query: p.query,
        response_mode: 'streaming',
        user: p.user,
        auto_generate_name: p.autoGenerateName ?? true,
    };
    if (p.conversationId)
        body.conversation_id = p.conversationId;
    if (p.files && p.files.length)
        body.files = p.files;
    const res = await fetchWithTimeout(base() + '/chat-messages', {
        method: 'POST',
        headers: headers({ Accept: 'text/event-stream' }),
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        let payload = null;
        try {
            payload = (await res.json());
        }
        catch { /* ignore */ }
        throw new errors_1.DifyApiError(res.status, payload?.code || httpCodeToName(res.status), payload?.message);
    }
    if (!res.body)
        throw new errors_1.DifyApiError(502, 'no_stream', 'جریان پاسخ قابل خواندن نیست.');
    await consumeSse(res.body, p.onEvent, p.signal);
}
/** Completion apps: POST /completion-messages (streaming) */
async function streamCompletion(p) {
    const body = {
        inputs: p.inputs,
        response_mode: 'streaming',
        user: p.user,
        auto_generate_name: p.autoGenerateName ?? true,
        ...(p.conversationId ? { conversation_id: p.conversationId } : {}),
    };
    const res = await fetchWithTimeout(base() + '/completion-messages', {
        method: 'POST', headers: headers({ Accept: 'text/event-stream' }), body: JSON.stringify(body),
    });
    if (!res.ok) {
        let payload = null;
        try {
            payload = (await res.json());
        }
        catch { /* ignore */ }
        throw new errors_1.DifyApiError(res.status, payload?.code || httpCodeToName(res.status), payload?.message);
    }
    if (!res.body)
        throw new errors_1.DifyApiError(502, 'no_stream', 'جریان پاسخ قابل خواندن نیست.');
    await consumeSse(res.body, p.onEvent, p.signal);
}
/** Workflow apps: POST /workflows/run — different input contract (inputs only, no query/conversation). */
async function streamWorkflow(p) {
    const body = { inputs: p.inputs, response_mode: 'streaming', user: p.user };
    const res = await fetchWithTimeout(base() + '/workflows/run', {
        method: 'POST', headers: headers({ Accept: 'text/event-stream' }), body: JSON.stringify(body),
    });
    if (!res.ok) {
        let payload = null;
        try {
            payload = (await res.json());
        }
        catch { /* ignore */ }
        throw new errors_1.DifyApiError(res.status, payload?.code || httpCodeToName(res.status), payload?.message);
    }
    if (!res.body)
        throw new errors_1.DifyApiError(502, 'no_stream', 'جریان پاسخ قابل خواندن نیست.');
    await consumeSse(res.body, p.onEvent, p.signal);
}
/** Generic SSE line parser (compatible across Node 18+ undici streams). */
async function consumeSse(stream, onEvent, signal) {
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    const flushFrame = (frame) => {
        // A frame may contain multiple "data:" lines; join them.
        const dataLines = [];
        for (const line of frame.split('\n')) {
            const l = line.trimEnd();
            if (l.startsWith('data:'))
                dataLines.push(l.slice(5).trim());
            else if (l.startsWith(':'))
                continue; // comment / keep-alive
        }
        if (!dataLines.length)
            return;
        const joined = dataLines.join('\n');
        if (!joined || joined === '[DONE]')
            return;
        try {
            const obj = JSON.parse(joined);
            if (obj.event === 'ping')
                return;
            onEvent(obj);
        }
        catch {
            logger_1.logger.debug('unparseable sse frame', { preview: joined.slice(0, 120) });
        }
    };
    try {
        while (true) {
            if (signal?.aborted)
                break;
            const { done, value } = await reader.read();
            if (done)
                break;
            buf += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) !== -1) {
                const frame = buf.slice(0, idx);
                buf = buf.slice(idx + 2);
                flushFrame(frame);
            }
        }
        if (buf.trim())
            flushFrame(buf);
    }
    finally {
        try {
            reader.cancel().catch(() => undefined);
        }
        catch { /* ignore */ }
    }
}
function guessMime(filename) {
    const ext = filename.toLowerCase().split('.').pop() || '';
    const map = {
        mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac',
    };
    return map[ext] || 'application/octet-stream';
}
function newRequestId() {
    return crypto_1.default.randomUUID();
}
//# sourceMappingURL=client.js.map