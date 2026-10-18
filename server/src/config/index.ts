/**
 * Central configuration loaded from environment variables.
 * All Dify connection settings come from the environment; nothing is hard-coded.
 */

export type DifyAppType = 'chat' | 'completion' | 'workflow';

export interface AppConfig {
  appPort: number;
  databaseUrl: string;          // sqlite file path (or :memory:)
  sessionSecret: string;
  difyBaseUrl: string;          // e.g. http://dify.internal/v1  (overridable at runtime by admin)
  difyApiKey: string;           // overridable at runtime by admin (stored hashed-masked in DB, plain only server-side)
  difyTimeoutMs: number;
  difyAppType: DifyAppType;
  nodeEnv: string;
  secureCookies: boolean;
  maxUploadSizeMb: number;      // backend-side guard (Dify limits are also enforced from /files/upload config)
  rateLimitWindowMs: number;
  rateLimitMax: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function envStr(name: string, def: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}

function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function normalizeBaseUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  url = url.replace(/\/+$/, '');
  // Dify app API base conventionally ends with /v1 — append it when missing.
  if (!/\/v\d+$/i.test(url)) url = url + '/v1';
  return url;
}

export function loadConfig(overrides?: Partial<AppConfig>): AppConfig {
  const nodeEnv = envStr('NODE_ENV', 'development');
  const secret = envStr('SESSION_SECRET', '');
  if (!secret && nodeEnv === 'production') {
    // Never allow an insecure default in production.
    throw new Error('SESSION_SECRET must be set in production');
  }

  const cfg: AppConfig = {
    appPort: envInt('APP_PORT', 3000),
    databaseUrl: envStr('DATABASE_URL', './data/app.db'),
    sessionSecret: secret || 'dev-only-insecure-secret-change-me',
    difyBaseUrl: normalizeBaseUrl(envStr('DIFY_BASE_URL', '')),
    difyApiKey: envStr('DIFY_API_KEY', ''),
    difyTimeoutMs: envInt('DIFY_TIMEOUT', 120000),
    difyAppType: (envStr('DIFY_APP_TYPE', 'chat') as DifyAppType),
    nodeEnv,
    secureCookies: (process.env.SECURE_COOKIES !== undefined ? process.env.SECURE_COOKIES === 'true' : nodeEnv === 'production'),
    maxUploadSizeMb: envInt('MAX_UPLOAD_SIZE_MB', 15),
    rateLimitWindowMs: envInt('RATE_LIMIT_WINDOW_MS', 60000),
    rateLimitMax: envInt('RATE_LIMIT_MAX', 120),
    logLevel: envStr('LOG_LEVEL', 'info') as AppConfig['logLevel'],
  };
  if (!['chat', 'completion', 'workflow'].includes(cfg.difyAppType)) cfg.difyAppType = 'chat';
  return { ...cfg, ...(overrides || {}) };
}

/** Mutable runtime settings (admin can change Dify URL/key/type without redeploy). */
class RuntimeSettings {
  private current: AppConfig;
  constructor(initial: AppConfig) { this.current = initial; }
  get(): AppConfig { return this.current; }
  update(partial: Partial<AppConfig>): AppConfig {
    this.current = { ...this.current, ...partial };
    if (partial.difyBaseUrl !== undefined) {
      this.current.difyBaseUrl = normalizeBaseUrl(partial.difyBaseUrl);
    }
    return this.current;
  }
}

export const runtimeSettings = new RuntimeSettings(loadConfig());
export { normalizeBaseUrl };
