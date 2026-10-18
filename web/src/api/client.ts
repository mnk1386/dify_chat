/**
 * API client for the app's OWN backend (never talks to Dify directly).
 * - Sends session cookie (same-origin) and CSRF header on mutations.
 * - Provides fetch-based SSE streaming via ReadableStream (POST + streaming response),
 *   which EventSource cannot do — required by Dify chat-messages streaming contract.
 */

import type {
  ApiErrorBody, AppParameters, AppStatus, AdminSettings, ConversationListResponse,
  EventRow, MessagesResponse, TestConnectionResult, UploadedFile, UserInfo,
} from '../types';

let csrfToken = '';

export function setCsrfToken(token: string) { csrfToken = token; }
export function getCsrfToken() { return csrfToken; }

export class ApiError extends Error {
  code: string;
  status: number;
  requestId?: string;
  constructor(message: string, code: string, status: number, requestId?: string) {
    super(message);
    this.code = code; this.status = status; this.requestId = requestId;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null;
  try { body = await res.json(); } catch { /* non-json */ }
  const msg = body?.error?.message || defaultMessageForStatus(res.status);
  return new ApiError(msg, body?.error?.code || 'http_error', res.status, body?.error?.requestId);
}

function defaultMessageForStatus(status: number): string {
  switch (status) {
    case 400: return 'درخواست نامعتبر است.';
    case 401: return 'برای ادامه باید وارد سامانه شوید.';
    case 403: return 'اجازه دسترسی به این عملیات را ندارید.';
    case 404: return 'مورد موردنظر یافت نشد.';
    case 409: return 'این درخواست پیش‌تر انجام شده است.';
    case 413: return 'حجم درخواست بیش از حد مجاز است.';
    case 429: return 'تعداد درخواست‌ها بیش از حد مجاز است. لحظی صبر کنید.';
    default:
      if (status >= 500) return 'سرویس در دسترس نیست. کمی بعد تلاش کنید.';
      return 'خطای نامشخص رخ داد.';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())) {
    headers.set('X-CSRF-Token', csrfToken);
  }
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init, headers });
  } catch {
    throw new ApiError('ارتباط با سرور برقرار نشد. اتصال شبکه خود را بررسی کنید.', 'network_error', 0);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ---------------- Auth ---------------- */

export const authApi = {
  provider: () => request<{ provider: string }>('/api/auth/provider'),
  login: (username: string, password: string) =>
    request<{ ok: boolean }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: UserInfo; csrfToken: string }>('/api/auth/me'),
};

/* ---------------- App meta ---------------- */

export const appApi = {
  status: () => request<AppStatus>('/api/app/status'),
  parameters: () => request<AppParameters>('/api/app/parameters'),
};

/* ---------------- Conversations ---------------- */

export const conversationsApi = {
  list: (opts: { lastId?: string; limit?: number; q?: string } = {}) => {
    const p = new URLSearchParams();
    if (opts.lastId) p.set('lastId', opts.lastId);
    if (opts.limit) p.set('limit', String(opts.limit));
    if (opts.q) p.set('q', opts.q);
    return request<ConversationListResponse>(`/api/conversations?${p.toString()}`);
  },
  messages: (id: string, opts: { firstId?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (opts.firstId) p.set('firstId', opts.firstId);
    if (opts.limit) p.set('limit', String(opts.limit));
    return request<MessagesResponse>(`/api/conversations/${encodeURIComponent(id)}/messages?${p.toString()}`);
  },
  rename: (id: string, name: string) =>
    request<{ ok: boolean }>(`/api/conversations/${encodeURIComponent(id)}/rename`, { method: 'POST', body: JSON.stringify({ name }) }),
  remove: (id: string) =>
    request<{ ok: boolean }>(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  variables: (id: string) =>
    request<{ data: unknown[] }>(`/api/conversations/${encodeURIComponent(id)}/variables`),
  updateVariable: (id: string, variableId: string, value: string) =>
    request<{ ok: boolean }>(`/api/conversations/${encodeURIComponent(id)}/variables/${encodeURIComponent(variableId)}`, {
      method: 'PUT', body: JSON.stringify({ value }),
    }),
};

/* ---------------- Chat ---------------- */

export interface SendPayload {
  query: string;
  conversationId: string | null;
  files?: Array<{ type: string; transfer_method: string; upload_file_id?: string; url?: string }>;
  inputs?: Record<string, string | number | boolean>;
  clientMsgId: string;
}

export const chatApi = {
  stop: (taskId: string) =>
    request<{ ok: boolean }>('/api/chat/stop', { method: 'POST', body: JSON.stringify({ taskId }) }),
  feedback: (messageId: string, rating: 'like' | 'dislike' | 'null', content?: string) =>
    request<{ ok: boolean }>(`/api/chat/feedback/${encodeURIComponent(messageId)}`, {
      method: 'POST', body: JSON.stringify({ rating, ...(content ? { content } : {}) }),
    }),
  suggested: (messageId: string) =>
    request<{ result: string; data: string[] }>(`/api/chat/suggested/${encodeURIComponent(messageId)}`),
  uploadFile: (file: File, onProgress?: (pct: number) => void): Promise<UploadedFile> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const fd = new FormData();
      fd.append('file', file);
      xhr.open('POST', '/api/chat/files/upload');
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-CSRF-Token', csrfToken);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new ApiError('پاسخ نامعتبر سرور.', 'bad_response', xhr.status)); }
        } else {
          let msg = t_files_error();
          let code = 'upload_failed';
          try { const b = JSON.parse(xhr.responseText); msg = b?.error?.message || msg; code = b?.error?.code || code; } catch { /* keep defaults */ }
          reject(new ApiError(msg, code, xhr.status));
        }
      };
      xhr.onerror = () => reject(new ApiError('ارتباط شبکه در زمان بارگذاری فایل قطع شد.', 'network_error', 0));
      xhr.send(fd);
    });
  },
  audioToText: (blob: Blob): Promise<{ text: string }> => {
    const fd = new FormData();
    fd.append('audio', blob, 'speech.webm');
    return request('/api/chat/audio/to-text', { method: 'POST', body: fd });
  },
  textToAudioUrl: async (text: string, messageId?: string): Promise<string> => {
    const res = await fetch('/api/chat/audio/from-text', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ text, ...(messageId ? { messageId } : {}) }),
    });
    if (!res.ok) throw await parseError(res);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
};

function t_files_error() { return 'بارگذاری فایل ناموفق بود.'; }

/* ---------------- Admin ---------------- */

export const adminApi = {
  settings: () => request<AdminSettings>('/api/admin/settings'),
  saveSettings: (body: Partial<AdminSettings> & { difyApiKey?: string }) =>
    request<{ ok: boolean }>('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) }),
  testConnection: (draft?: { difyBaseUrl?: string; difyApiKey?: string }) =>
    request<TestConnectionResult>('/api/admin/test-connection', { method: 'POST', body: JSON.stringify(draft || {}) }),
  events: (limit = 100) => request<{ data: EventRow[] }>(`/api/admin/events?limit=${limit}`),
};

/* ---------------- SSE streaming send ---------------- */

export interface StreamHandlers {
  onFrame: (frame: Record<string, unknown>) => void;
  onNetworkError: (err: ApiError) => void;
  signal: AbortSignal;
}

/**
 * POST /api/chat/send and consume the SSE stream manually.
 * Parses `data: {...}\n\n` frames; tolerates chunk boundaries splitting frames.
 */
export async function streamSend(payload: SendPayload, h: StreamHandlers): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/chat/send', {
      method: 'POST',
      credentials: 'same-origin',
      signal: h.signal,
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    h.onNetworkError(new ApiError('ارتباط با سرور برقرار نشد.', 'network_error', 0));
    return;
  }

  if (!res.ok || !res.body) {
    // Non-streaming error response (validation, auth, rate limit…)
    try { throw await parseError(res); }
    catch (err) { h.onNetworkError(err instanceof ApiError ? err : new ApiError('خطای نامشخص', 'unknown', res.status)); }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const flushBuffer = () => {
    // Split complete SSE frames separated by a blank line
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const rawFrame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of rawFrame.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        try { h.onFrame(JSON.parse(jsonStr)); } catch { /* ignore malformed frame */ }
      }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      flushBuffer();
    }
    buffer += decoder.decode();
    flushBuffer();
  } catch (e) {
    if ((e as Error).name === 'AbortError') return; // user pressed stop / navigation
    h.onNetworkError(new ApiError('جریان پاسخ قطع شد.', 'stream_interrupted', 0));
  }
}
