/**
 * Chat routes: streaming send (SSE relay), stop, feedback, suggested questions,
 * TTS/STT audio endpoints. Browser talks ONLY to these backend endpoints;
 * the Dify API key never reaches the client.
 */

import { Router, Response } from 'express';
import multer from 'multer';
import { AuthedRequest, requireCsrf } from '../middleware/auth';
import { validate, chatSendSchema, stopSchema, feedbackSchema, ttsSchema, validateFileMeta, classifyFileType } from '../utils/validation';
import * as dify from '../dify/client';
import { isAppError, AppError, DifyApiError } from '../utils/errors';
import { logger } from '../utils/logger';
import { upsertConversationIndex, cacheMessagePreview, logEvent } from '../db';
import { assertConversationOwnership } from '../middleware/ownership';
import crypto from 'crypto';

export const chatRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

/* In-flight task registry so a disconnected browser stream can be cleaned up. */
interface ActiveStream {
  taskId?: string;
  abort: AbortController;
  userId: string;
  conversationIdSeen?: string;
  messageIdSeen?: string;
}
const activeStreams = new Map<string, ActiveStream>(); // local streamId -> state

/* ---------------- POST /api/chat/send — relays SSE from Dify to browser ---------------- */
chatRouter.post('/send', requireCsrf, async (req: AuthedRequest, res: Response) => {
  let body;
  try {
    body = validate(chatSendSchema, req.body);
  } catch (e) {
    const err = e as { status?: number; message?: string; code?: string };
    res.status(err.status || 400).json({ error: { code: err.code || 'invalid_input', message: err.message || 'ورودی نامعتبر است.' } });
    return;
  }

  const user = req.user!;
  const difyUser = user.dify_user_id; // stable unguessable per-user id

  if (body.conversationId && !assertConversationOwnership(req, res, () => undefined, body.conversationId)) return;

  // Idempotency: reject duplicate clientMsgId within a short window (prevents double sends).
  const dedupeKey = body.clientMsgId ? `idem:${user.id}:${body.clientMsgId}` : null;
  if (dedupeKey) {
    if (recentIds.has(dedupeKey)) {
      res.status(409).json({ error: { code: 'duplicate_request', message: 'این پیام پیش‌تر ارسال شده است.' } });
      return;
    }
    recentIds.add(dedupeKey);
    setTimeout(() => recentIds.delete(dedupeKey), 60_000);
  }

  const streamId = crypto.randomUUID();
  const abort = new AbortController();
  const state: ActiveStream = { abort, userId: user.id };
  activeStreams.set(streamId, state);

  // SSE headers toward the browser
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const sendFrame = (obj: unknown) => {
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* connection closed */ }
  };

  // Accumulate assistant text for preview cache + dedupe safety.
  let accumulated = '';
  let sawMessageEnd = false;

  const onEvent = (ev: dify.StreamEvent) => {
    if (ev.task_id) state.taskId = ev.task_id;
    if (ev.conversation_id) state.conversationIdSeen = ev.conversation_id;
    if (ev.message_id) state.messageIdSeen = ev.message_id;
    if (ev.event === 'message' || ev.event === 'agent_message') {
      const chunk = ev.answer ?? '';
      // Deduplication guard: if a variant of the API repeats full text instead of deltas,
      // only forward the suffix we haven't sent yet.
      let delta = chunk;
      if (chunk.length > accumulated.length && chunk.startsWith(accumulated)) {
        delta = chunk.slice(accumulated.length);
        accumulated = chunk;
      } else {
        accumulated += chunk;
      }
      if (delta) sendFrame({ event: 'delta', answer: delta, conversation_id: ev.conversation_id, message_id: ev.message_id, task_id: ev.task_id });
    } else if (ev.event === 'message_file' || ev.event === 'message_replace') {
      sendFrame(ev);
    } else if (ev.event === 'message_end') {
      sawMessageEnd = true;
      const meta = (ev.data || {}) as Record<string, unknown>;
      sendFrame({
        event: 'end',
        conversation_id: ev.conversation_id,
        message_id: ev.message_id,
        // Only forward usage/retriever info that Dify actually returned:
        ...(meta.usage ? { usage: meta.usage } : {}),
        ...(meta.reference ? { reference: meta.reference } : {}),
        ...(Array.isArray(meta.retriever_resources) && meta.retriever_resources.length ? { retriever_resources: meta.retriever_resources } : {}),
      });
    } else if (ev.event === 'error') {
      sendFrame({ event: 'error', code: ev.code, message: ev.message });
    } else if (ev.event.startsWith('workflow_') || ev.event.startsWith('node_')) {
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
      await dify.streamCompletion({ inputs: (body.inputs || { query: body.query }) as Record<string, unknown>, user: difyUser, conversationId: body.conversationId || undefined, onEvent, signal: abort.signal } as never);
    } else if (cfgType === 'workflow') {
      await dify.streamWorkflow({ inputs: { ...(body.inputs || {}), query: body.query }, user: difyUser, onEvent, signal: abort.signal });
    } else {
      await dify.streamChat({
        query: body.query, user: difyUser, conversationId: body.conversationId || null,
        files: files.length ? files : undefined, inputs: body.inputs, onEvent, signal: abort.signal,
      });
    }
    if (!sawMessageEnd) sendFrame({ event: 'end', note: 'stream_closed_without_end' });

    // Index & preview caching (source of truth stays in Dify; we keep only metadata/previews)
    if (state.conversationIdSeen) {
      upsertConversationIndex({ userId: user.id, difyConversationId: state.conversationIdSeen, lastActivityAt: Math.floor(Date.now() / 1000) });
    }
    if (state.messageIdSeen && accumulated) {
      cacheMessagePreview({ userId: user.id, difyConversationId: state.conversationIdSeen || '', difyMessageId: state.messageIdSeen, role: 'assistant', content: accumulated });
      cacheMessagePreview({ userId: user.id, difyConversationId: state.conversationIdSeen || '', difyMessageId: state.messageIdSeen + '-q', role: 'user', content: body.query });
    }
    sendFrame({ event: 'stream_end', stream_id: streamId });
  } catch (e) {
    const err = normalizeError(e);
    logEvent({ level: 'error', type: 'chat_stream_error', userId: user.id, detail: `${err.code}: ${err.detail}`.slice(0, 500) });
    logger.warn('chat stream error', { code: err.code, status: err.status });
    sendFrame({ event: 'app_error', code: err.code.replace(/^dify_/, ''), message: err.userMessage, retryable: err.retryable });
  } finally {
    cleanup();
    res.end();
  }
});

/* ---------------- POST /api/chat/stop ---------------- */
chatRouter.post('/stop', requireCsrf, async (req: AuthedRequest, res: Response) => {
  try {
    const body = validate(stopSchema, req.body);
    const user = req.user!;
    const result = await dify.stopTask(body.taskId, user.dify_user_id);
    // Abort our relay side too so UI state recovers cleanly.
    for (const [, st] of activeStreams) {
      if (st.userId === user.id && st.taskId === body.taskId) st.abort.abort();
    }
    res.json({ ok: true, result });
  } catch (e) {
    handle(res, e, req);
  }
});

/* ---------------- POST /api/chat/feedback/:messageId ---------------- */
chatRouter.post('/feedback/:messageId', requireCsrf, async (req: AuthedRequest, res: Response) => {
  try {
    const body = validate(feedbackSchema, req.body);
    const user = req.user!;
    const rating = body.rating === 'null' ? null : body.rating;
    const result = await dify.feedback(req.params.messageId, user.dify_user_id, rating as 'like' | 'dislike' | null, body.content);
    res.json({ ok: true, result });
  } catch (e) { handle(res, e, req); }
});

/* ---------------- GET /api/chat/suggested/:messageId ---------------- */
chatRouter.get('/suggested/:messageId', async (req: AuthedRequest, res: Response) => {
  try {
    const user = req.user!;
    const data = await dify.suggestedQuestions(req.params.messageId, user.dify_user_id);
    res.json(data);
  } catch (e) { handle(res, e, req); }
});

/* ---------------- Files ---------------- */
chatRouter.post('/files/upload', requireCsrf, upload.single('file'), async (req: AuthedRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) { res.status(400).json({ error: { code: 'no_file', message: 'فایلی ارسال نشده است.' } }); return; }
    const cfg = require('../config').runtimeSettings.get();
    const check = validateFileMeta(file.originalname, file.size, cfg.maxUploadSizeMb);
    if (!check.ok) {
      const messages: Record<string, string> = {
        unsupported_type: 'نوع این فایل پشتیبانی نمی‌شود.',
        blocked_type: 'این نوع فایل به دلایل امنیتی مجاز نیست.',
        too_large: `حجم فایل بیش از حد مجاز (${cfg.maxUploadSizeMb} مگابایت) است.`,
        empty_file: 'فایل خالی است.',
        file_no_extension: 'پسوند فایل مشخص نیست.',
      };
      res.status(400).json({ error: { code: check.reason || 'invalid_file', message: messages[check.reason || ''] || 'فایل نامعتبر است.' } });
      return;
    }
    const uploaded = await dify.uploadFile(file.buffer, file.originalname, file.mimetype, req.user!.dify_user_id);
    res.json({
      id: uploaded.id, name: uploaded.name, size: uploaded.size,
      mime_type: uploaded.mime_type, extension: uploaded.extension,
      file_type: classifyFileType(file.originalname),
    });
  } catch (e) { handle(res, e, req); }
});

/* ---------------- Audio ---------------- */
chatRouter.post('/audio/to-text', requireCsrf, upload.single('audio'), async (req: AuthedRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) { res.status(400).json({ error: { code: 'no_audio', message: 'فایل صوتی دریافت نشد.' } }); return; }
    const cfg = require('../config').runtimeSettings.get();
    if (file.size > cfg.maxUploadSizeMb * 1024 * 1024) {
      res.status(413).json({ error: { code: 'too_large', message: 'حجم فایل صوتی بیش از حد مجاز است.' } }); return;
    }
    const out = await dify.audioToText(file.buffer, file.originalname || 'audio.webm', req.user!.dify_user_id);
    res.json(out);
  } catch (e) { handle(res, e, req); }
});

chatRouter.post('/audio/from-text', requireCsrf, async (req: AuthedRequest, res: Response) => {
  try {
    const body = validate(ttsSchema, req.body);
    const out = await dify.textToAudio(body.text, req.user!.dify_user_id);
    res.setHeader('Content-Type', out.contentType);
    res.send(out.buffer);
  } catch (e) { handle(res, e, req); }
});

/* ---------------- helpers ---------------- */

const recentIds = new Set<string>();

interface NormalizedError { status: number; code: string; userMessage: string; detail: string; retryable: boolean; }

function normalizeError(e: unknown): NormalizedError {
  if (isAppError(e)) {
    const err = e as AppError;
    const retryable = err instanceof DifyApiError && ['timeout', 'network_error', 'server_error', 'too_many_requests'].includes((err as DifyApiError).difyCode);
    return { status: err.status || 502, code: err.code, userMessage: err.userMessage, detail: err.detail || '', retryable };
  }
  return { status: 500, code: 'internal', userMessage: 'خطای داخلی سرور رخ داد.', detail: (e as Error)?.message || 'unknown', retryable: false };
}

function handle(res: Response, e: unknown, req: AuthedRequest) {
  const err = normalizeError(e);
  if (err.status >= 500) logger.error('request failed', { code: err.code, detail: err.detail, userId: req.user?.id });
  else logger.warn('request failed', { code: err.code, status: err.status });
  logEvent({ level: err.status >= 500 ? 'error' : 'warn', type: `api_${err.code}`, userId: req.user?.id, requestId: String(res.getHeader('x-request-id') || ''), detail: err.detail });
  res.status(err.status >= 400 && err.status < 600 ? err.status : 500).json({
    error: { code: err.code.replace(/^dify_/, ''), message: err.userMessage, requestId: res.getHeader('x-request-id') },
  });
}
