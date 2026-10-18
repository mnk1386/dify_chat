/**
 * App meta routes (available to authenticated users): app info/parameters/site,
 * connection status (non-secret), file-upload limits derived from Dify /parameters.
 */

import { Router, Response } from 'express';
import { AuthedRequest } from '../middleware/auth';
import * as dify from '../dify/client';
import { runtimeSettings } from '../config';
import { handleRouteError } from './errors-helper';

export const appRouter = Router();

/* GET /api/app/status — safe, non-secret connectivity snapshot for the UI badge */
appRouter.get('/status', async (req: AuthedRequest, res: Response) => {
  try {
    const cfg = runtimeSettings.get();
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
  } catch (e) { handleRouteError(res, e, req); }
});

/* GET /api/app/parameters — opening statement, suggested questions, upload limits, user input form */
appRouter.get('/parameters', async (req: AuthedRequest, res: Response) => {
  try {
    const user = req.user!;
    const p = await dify.getParameters(user.dify_user_id);
    // Normalize limits into a simple contract for the frontend.
    const sys = p.system_parameters?.file_upload || p;
    res.json({
      opening_statement: p.opening_statement || '',
      suggested_questions: Array.isArray(p.suggested_questions) ? p.suggested_questions : [],
      user_input_form: p.user_input_form || [],
      file_upload: {
        enabled: Boolean(p.file_upload?.enabled ?? (p.file_upload as unknown as boolean)),
        number_limits: p.file_upload?.number_limits ?? 1,
        image_file_size_limit_mb: toMb(sys.image_file_size_limit),
        audio_file_size_limit_mb: toMb(sys.audio_file_size_limit),
        video_file_size_limit_mb: toMb(sys.video_file_size_limit),
        file_size_limit_mb: toMb(sys.file_size_limit),
        file_upload_limit: sys.file_upload_limit ?? 10,
      },
      tts_available: Boolean((p as unknown as Record<string, unknown>).tts_config), // refined by actual call errors
    });
  } catch (e) { handleRouteError(res, e, req); }
});

function toMb(bytes: number | null | undefined): number | null {
  if (bytes === null || bytes === undefined) return null;
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}
