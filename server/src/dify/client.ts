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

import { runtimeSettings } from '../config';
import { logger } from '../utils/logger';
import { DifyApiError } from '../utils/errors';
import crypto from 'crypto';

function base(): string {
  const cfg = runtimeSettings.get();
  if (!cfg.difyBaseUrl || !cfg.difyApiKey) {
    throw new DifyApiError(503, 'not_configured', 'تنظیمات اتصال به Dify کامل نیست.');
  }
  return cfg.difyBaseUrl;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const cfg = runtimeSettings.get();
  return {
    Authorization: `Bearer ${cfg.difyApiKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const cfg = runtimeSettings.get();
  const timeoutMs = init.timeoutMs ?? cfg.difyTimeoutMs;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err: unknown) {
    const name = (err as Error)?.name;
    if (name === 'AbortError') throw new DifyApiError(504, 'timeout', 'ارتباط با سرویس هوش مصنوعی قطع شد (Timeout).');
    throw new DifyApiError(0, 'network_error', 'خطای شبکه در ارتباط با سرویس هوش مصنوعی.');
  } finally {
    clearTimeout(t);
  }
}

async function jsonRequest<T>(method: string, pathAndQuery: string, body?: unknown, timeoutMs?: number): Promise<T> {
  const url = base() + pathAndQuery;
  const res = await fetchWithTimeout(url, {
    method,
    headers: headers(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    timeoutMs,
  });
  return parseJsonResponse<T>(res, pathAndQuery);
}

async function parseJsonResponse<T>(res: Response, ctx: string): Promise<T> {
  let payload: unknown = null;
  const text = await res.text().catch(() => '');
  try { payload = text ? JSON.parse(text) : null; } catch { /* non-json error page */ }

  if (!res.ok) {
    const p = payload as { code?: string; message?: string; status?: number } | null;
    const code = p?.code || httpCodeToName(res.status);
    logger.warn('dify api error', { status: res.status, code, ctx });
    throw new DifyApiError(res.status, code, p?.message || undefined);
  }
  if (!payload) throw new DifyApiError(502, 'invalid_response', 'پاسخ نامعتبر از سرویس دریافت شد.');
  return payload as T;
}

function httpCodeToName(status: number): string {
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

/* ---------------- Types (subset of official response shapes) ---------------- */

export interface DifyAppInfo { name: string; description: string; tags: string[]; }
export interface DifySite { title: string; icon: string; app_id: string; description: string; copyright: string; }
export interface DifyFileUploadLimit {
  file_size_limit: number | null; image_file_size_limit: number | null; audio_file_size_limit: number | null;
  video_file_size_limit: number | null; file_upload_limit: number | null; image_file_upload_limit: number | null;
}
export interface DifyParameters extends DifyFileUploadLimit {
  opening_statement: string; suggested_questions: string[];
  pre_prompt: string | null; user_input_form: unknown[] | null;
  dataset_process_rule: unknown | null; llm_setting: unknown | null;
  file_upload: { enabled: boolean; number_limits?: number; transfer_methods?: string[] } | null;
  system_parameters: { file_upload: DifyFileUploadLimit } | null;
}
export interface DifyMeta { usage: unknown; retried: boolean; }
export interface DifyConversation { id: string; name: string; inputs: Record<string, unknown>; created_at: number; updated_at?: number; }
export interface DifyMessage {
  id: string; conversation_id: string; query: string; answer: string;
  message_files?: Array<{ type: string; url: string; belongs_to: string }>;
  feedback: { rating: string; content?: string } | null;
  created_at: number; agent_thoughts?: unknown[]; retrieved_resources?: unknown[];
}
export interface DifyVariable { id: string; name: string; value: string; description: string | null; selector?: string[]; }

/* ---------------- Simple endpoints ---------------- */

export async function getAppInfo(): Promise<DifyAppInfo> { return jsonRequest('GET', '/info'); }
export async function getSite(): Promise<DifySite> { return jsonRequest('GET', '/site'); }
export async function getParameters(user: string): Promise<DifyParameters> {
  return jsonRequest('GET', `/parameters?user=${encodeURIComponent(user)}`);
}
export async function getMeta(user: string): Promise<DifyMeta> {
  return jsonRequest('GET', `/meta?user=${encodeURIComponent(user)}`); // requires meta from last message workflow runs
}

export async function checkConnection(): Promise<{ ok: boolean; info?: DifyAppInfo; site?: DifySite; error?: string; errorCode?: string }> {
  try {
    const [info, site] = await Promise.all([getAppInfo(), getSite()]);
    return { ok: true, info, site };
  } catch (e) {
    const err = e as DifyApiError;
    return { ok: false, error: err.userMessage, errorCode: err.code };
  }
}

export async function listConversations(user: string, lastId?: string, limit = 20): Promise<{
  limit: number; has_more: boolean; data: DifyConversation[];
}> {
  const q = new URLSearchParams({ user, limit: String(limit) });
  if (lastId) q.set('last_id', lastId);
  return jsonRequest('GET', `/conversations?${q.toString()}`);
}

export async function getMessages(conversationId: string, user: string, firstId?: string, limit = 20): Promise<{
  limit: number; has_more: boolean; data: DifyMessage[];
}> {
  const q = new URLSearchParams({ conversation_id: conversationId, user, limit: String(limit) });
  if (firstId) q.set('first_id', firstId);
  return jsonRequest('GET', `/messages?${q.toString()}`);
}

export async function renameConversation(conversationId: string, user: string, name: string): Promise<DifyConversation> {
  return jsonRequest('POST', `/conversations/${encodeURIComponent(conversationId)}/name`, { name, user });
}

export async function deleteConversation(conversationId: string, user: string): Promise<{ result: string }> {
  return jsonRequest('DELETE', `/conversations/${encodeURIComponent(conversationId)}?user=${encodeURIComponent(user)}`);
}

export async function getConversationVariables(conversationId: string, user: string): Promise<{ data: DifyVariable[] }> {
  return jsonRequest('GET', `/conversations/${encodeURIComponent(conversationId)}/variables?user=${encodeURIComponent(user)}`);
}

export async function updateConversationVariable(conversationId: string, variableId: string, user: string, value: string): Promise<DifyVariable> {
  return jsonRequest('PUT', `/conversations/${encodeURIComponent(conversationId)}/variables/${encodeURIComponent(variableId)}`, { value, user });
}

export async function feedback(messageId: string, user: string, rating: 'like' | 'dislike' | null, content?: string): Promise<{ result: string }> {
  return jsonRequest('POST', `/messages/${encodeURIComponent(messageId)}/feedbacks`, { rating, user, content: content || null });
}

export async function suggestedQuestions(messageId: string, user: string): Promise<{ data: string[] }> {
  return jsonRequest('GET', `/messages/${encodeURIComponent(messageId)}/suggested?user=${encodeURIComponent(user)}`);
}

export async function stopTask(taskId: string, user: string): Promise<{ result: string }> {
  return jsonRequest('POST', `/chat-messages/${encodeURIComponent(taskId)}/stop`, { user });
}

export async function audioToText(fileBuffer: Buffer, filename: string, user: string): Promise<{ text: string }> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(fileBuffer)], { type: guessMime(filename) });
  form.append('file', blob, filename);
  form.append('user', user);
  const cfg = runtimeSettings.get();
  const res = await fetchWithTimeout(base() + '/audio-to-text', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.difyApiKey}` },
    body: form as never,
  });
  return parseJsonResponse<{ text: string }>(res, '/audio-to-text');
}

export async function textToAudio(text: string, user: string): Promise<{ buffer: Buffer; contentType: string }> {
  const cfg = runtimeSettings.get();
  const res = await fetchWithTimeout(base() + '/text-to-audio', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ text, user }),
  });
  if (!res.ok) {
    let payload: { code?: string; message?: string } | null = null;
    try { payload = (await res.json()) as { code?: string; message?: string }; } catch { /* ignore */ }
    throw new DifyApiError(res.status, payload?.code || httpCodeToName(res.status), payload?.message);
  }
  const ct = res.headers.get('content-type') || 'audio/mp3';
  const ab = await res.arrayBuffer();
  return { buffer: Buffer.from(ab), contentType: ct };
}

export async function uploadFile(fileBuffer: Buffer, filename: string, mimeType: string, user: string): Promise<{
  id: string; name: string; size: number; extension: string; mime_type: string; created_at: number;
}> {
  const cfg = runtimeSettings.get();
  const form = new FormData();
  const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
  form.append('file', blob, filename);
  form.append('user', user);
  const res = await fetchWithTimeout(base() + '/files/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.difyApiKey}` },
    body: form as never,
  });
  return parseJsonResponse<{ id: string; name: string; size: number; extension: string; mime_type: string; created_at: number }>(res, '/files/upload');
}

/* ---------------- Chat streaming (SSE) ---------------- */

export interface StreamEvent {
  event: string;            // message | agent_message | message_end | message_file | error | ping | workflow_* | node_*
  conversation_id?: string;
  message_id?: string;
  task_id?: string;
  answer?: string;          // incremental chunk
  audio?: string;           // base64 tts chunk (if enabled)
  data?: Record<string, unknown>;
  code?: string;
  message?: string;
  status?: number;
}

export interface ChatStreamParams {
  query: string;
  user: string;
  conversationId?: string | null;
  files?: Array<{ type: 'image' | 'audio' | 'video' | 'document' | 'custom'; transfer_method: 'local_file' | 'remote_url'; url?: string; upload_file_id?: string }>;
  inputs?: Record<string, unknown>;
  autoGenerateName?: boolean;
  onEvent: (ev: StreamEvent) => void;
  signal?: AbortSignal;
}

/**
 * POST /chat-messages with response_mode=streaming and parses the SSE stream.
 * Deduplication note: Dify sends incremental "message" events whose `answer` is a DELTA.
 * We forward deltas; the caller accumulates them. If an endpoint variant returns full text
 * per event (older versions), the caller's accumulation logic tolerates it by tracking length.
 */
export async function streamChat(p: ChatStreamParams): Promise<void> {
  const cfg = runtimeSettings.get();
  const body: Record<string, unknown> = {
    inputs: p.inputs || {},
    query: p.query,
    response_mode: 'streaming',
    user: p.user,
    auto_generate_name: p.autoGenerateName ?? true,
  };
  if (p.conversationId) body.conversation_id = p.conversationId;
  if (p.files && p.files.length) body.files = p.files;

  const res = await fetchWithTimeout(base() + '/chat-messages', {
    method: 'POST',
    headers: headers({ Accept: 'text/event-stream' }),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let payload: { code?: string; message?: string } | null = null;
    try { payload = (await res.json()) as { code?: string; message?: string }; } catch { /* ignore */ }
    throw new DifyApiError(res.status, payload?.code || httpCodeToName(res.status), payload?.message);
  }
  if (!res.body) throw new DifyApiError(502, 'no_stream', 'جریان پاسخ قابل خواندن نیست.');

  await consumeSse(res.body, p.onEvent, p.signal);
}

/** Completion apps: POST /completion-messages (streaming) */
export async function streamCompletion(p: Omit<ChatStreamParams, 'query'> & { inputs: Record<string, unknown> }): Promise<void> {
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
    let payload: { code?: string; message?: string } | null = null;
    try { payload = (await res.json()) as { code?: string; message?: string }; } catch { /* ignore */ }
    throw new DifyApiError(res.status, payload?.code || httpCodeToName(res.status), payload?.message);
  }
  if (!res.body) throw new DifyApiError(502, 'no_stream', 'جریان پاسخ قابل خواندن نیست.');
  await consumeSse(res.body, p.onEvent, p.signal);
}

/** Workflow apps: POST /workflows/run — different input contract (inputs only, no query/conversation). */
export async function streamWorkflow(p: { inputs: Record<string, unknown>; user: string; onEvent: (ev: StreamEvent) => void; signal?: AbortSignal }): Promise<void> {
  const body = { inputs: p.inputs, response_mode: 'streaming', user: p.user };
  const res = await fetchWithTimeout(base() + '/workflows/run', {
    method: 'POST', headers: headers({ Accept: 'text/event-stream' }), body: JSON.stringify(body),
  });
  if (!res.ok) {
    let payload: { code?: string; message?: string } | null = null;
    try { payload = (await res.json()) as { code?: string; message?: string }; } catch { /* ignore */ }
    throw new DifyApiError(res.status, payload?.code || httpCodeToName(res.status), payload?.message);
  }
  if (!res.body) throw new DifyApiError(502, 'no_stream', 'جریان پاسخ قابل خواندن نیست.');
  await consumeSse(res.body, p.onEvent, p.signal);
}

/** Generic SSE line parser (compatible across Node 18+ undici streams). */
async function consumeSse(stream: ReadableStream<Uint8Array>, onEvent: (ev: StreamEvent) => void, signal?: AbortSignal): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  const flushFrame = (frame: string) => {
    // A frame may contain multiple "data:" lines; join them.
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      const l = line.trimEnd();
      if (l.startsWith('data:')) dataLines.push(l.slice(5).trim());
      else if (l.startsWith(':')) continue; // comment / keep-alive
    }
    if (!dataLines.length) return;
    const joined = dataLines.join('\n');
    if (!joined || joined === '[DONE]') return;
    try {
      const obj = JSON.parse(joined) as StreamEvent;
      if (obj.event === 'ping') return;
      onEvent(obj);
    } catch {
      logger.debug('unparseable sse frame', { preview: joined.slice(0, 120) });
    }
  };

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        flushFrame(frame);
      }
    }
    if (buf.trim()) flushFrame(buf);
  } finally {
    try { reader.cancel().catch(() => undefined); } catch { /* ignore */ }
  }
}

function guessMime(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  const map: Record<string, string> = {
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac',
  };
  return map[ext] || 'application/octet-stream';
}

export function newRequestId(): string {
  return crypto.randomUUID();
}
