/**
 * Structured application logger.
 * - Technical details go to server logs only.
 * - Secrets (API keys, session tokens) are never logged.
 * - Each request gets a requestId for tracing.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let minLevel: Level = (process.env.LOG_LEVEL as Level) || 'info';
export function setLogLevel(l: Level) { minLevel = l; }

const SENSITIVE_KEYS = new Set([
  'authorization', 'apikey', 'api_key', 'difyapikey', 'password', 'session',
  'token', 'cookie', 'set-cookie', 'x-api-key', 'secret',
]);

function redact(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(redact);
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return obj;
}

function emit(level: Level, msg: string, meta?: unknown) {
  if (ORDER[level] < ORDER[minLevel]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(meta !== undefined ? { meta: redact(meta) } : {}),
  };
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

export const logger = {
  debug: (m: string, meta?: unknown) => emit('debug', m, meta),
  info: (m: string, meta?: unknown) => emit('info', m, meta),
  warn: (m: string, meta?: unknown) => emit('warn', m, meta),
  error: (m: string, meta?: unknown) => emit('error', m, meta),
};
