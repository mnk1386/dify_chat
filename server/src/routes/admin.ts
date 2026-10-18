/**
 * Admin settings routes.
 * - Only role=admin can read/write (checked in middleware).
 * - API key is write-only: stored server-side (env default or DB override), never returned.
 * - Connection test endpoint returns understandable Persian errors.
 */

import { Router, Response } from 'express';
import { AuthedRequest, requireAdmin, requireCsrf } from '../middleware/auth';
import { validate, adminSettingsSchema } from '../utils/validation';
import { runtimeSettings } from '../config';
import { setSetting, getSetting, recentEvents } from '../db';
import * as dify from '../dify/client';
import { handleRouteError } from './errors-helper';
import { logger } from '../utils/logger';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/* GET /api/admin/settings — no secret values are ever included */
adminRouter.get('/settings', (_req: AuthedRequest, res: Response) => {
  const cfg = runtimeSettings.get();
  res.json({
    difyBaseUrl: cfg.difyBaseUrl,
    apiKeySet: Boolean(cfg.difyApiKey),
    apiKeyMasked: maskKey(cfg.difyApiKey),
    difyTimeoutMs: cfg.difyTimeoutMs,
    difyAppType: cfg.difyAppType,
    maxUploadSizeMb: cfg.maxUploadSizeMb,
    uiFont: getSetting('ui_font') || 'vazirmatn',
    uiThemeDefault: getSetting('ui_theme_default') || 'auto',
    authProvider: process.env.AUTH_PROVIDER || 'local',
    versions: { node: process.version, server: '1.0.0' },
  });
});

/* PUT /api/admin/settings */
adminRouter.put('/settings', requireCsrf, (req: AuthedRequest, res: Response) => {
  try {
    const body = validate(adminSettingsSchema, req.body);
    const updates: Record<string, unknown> = {};
    if (body.difyBaseUrl !== undefined) {
      updates.difyBaseUrl = body.difyBaseUrl;
      setSetting('dify_base_url', body.difyBaseUrl);
    }
    if (body.difyApiKey !== undefined && body.difyApiKey !== '') {
      updates.difyApiKey = body.difyApiKey;
      setSetting('dify_api_key', body.difyApiKey, true); // stored server-side only
      logger.info('dify api key updated by admin', { userId: req.user!.id });
    }
    if (body.difyTimeoutMs !== undefined) { updates.difyTimeoutMs = body.difyTimeoutMs; setSetting('dify_timeout_ms', String(body.difyTimeoutMs)); }
    if (body.difyAppType !== undefined) { updates.difyAppType = body.difyAppType; setSetting('dify_app_type', body.difyAppType); }
    if (body.maxUploadSizeMb !== undefined) { updates.maxUploadSizeMb = body.maxUploadSizeMb; setSetting('max_upload_size_mb', String(body.maxUploadSizeMb)); }
    if (body.uiFont !== undefined) setSetting('ui_font', body.uiFont);
    if (body.uiThemeDefault !== undefined) setSetting('ui_theme_default', body.uiThemeDefault);
    runtimeSettings.update(updates as never);
    res.json({ ok: true });
  } catch (e) { handleRouteError(res, e, req); }
});

/* POST /api/admin/test-connection — uses current settings (or draft values passed in) */
adminRouter.post('/test-connection', requireCsrf, async (req: AuthedRequest, res: Response) => {
  try {
    const draft = (req.body || {}) as { difyBaseUrl?: string; difyApiKey?: string };
    let restore: (() => void) | null = null;
    if (draft.difyBaseUrl || draft.difyApiKey) {
      const before = { ...runtimeSettings.get() };
      runtimeSettings.update({
        ...(draft.difyBaseUrl ? { difyBaseUrl: draft.difyBaseUrl } : {}),
        ...(draft.difyApiKey ? { difyApiKey: draft.difyApiKey } : {}),
      });
      restore = () => runtimeSettings.update(before);
    }
    const result = await dify.checkConnection();
    if (restore) restore();
    res.json({
      ok: result.ok,
      appName: result.info?.name || null,
      appDescription: result.info?.description || null,
      siteTitle: result.site?.title || null,
      error: result.error || null,       // already human-readable Persian
      errorCode: result.errorCode || null,
    });
  } catch (e) { handleRouteError(res, e, req); }
});

/* GET /api/admin/events — technical/error events for diagnostics (sanitized) */
adminRouter.get('/events', (req: AuthedRequest, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit || '100'), 10) || 100, 500);
  res.json({ data: recentEvents(limit) });
});
