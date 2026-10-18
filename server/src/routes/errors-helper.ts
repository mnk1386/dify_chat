/**
 * Shared route error handling: maps AppError to safe JSON responses.
 * Never exposes stack traces or secrets.
 */

import { Response } from 'express';
import { isAppError, AppError, DifyApiError } from '../utils/errors';
import { logger } from '../utils/logger';
import { logEvent } from '../db';
import { AuthedRequest } from '../middleware/auth';

export function handleRouteError(res: Response, e: unknown, req?: AuthedRequest) {
  let status = 500;
  let code = 'internal';
  let message = 'خطای داخلی سرور رخ داد.';
  let detail = (e as Error)?.message || 'unknown';

  if (isAppError(e)) {
    const err = e as AppError;
    status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    code = err.code.replace(/^dify_/, '');
    message = err.userMessage;
    if (err instanceof DifyApiError && err.status === 404) status = 404;
  } else {
    const anyErr = e as { status?: number; code?: string; message?: string };
    if (anyErr?.status) {
      status = anyErr.status;
      code = anyErr.code || 'invalid_input';
      message = anyErr.message || 'ورودی نامعتبر است.';
    }
  }

  if (status >= 500) logger.error('route failed', { code, detail, userId: req?.user?.id });
  else logger.warn('route failed', { code, status });
  logEvent({
    level: status >= 500 ? 'error' : 'warn', type: `api_${code}`,
    userId: req?.user?.id ?? null, requestId: String(res.getHeader('x-request-id') || ''), detail: detail.slice(0, 300),
  });

  res.status(status).json({ error: { code, message, requestId: res.getHeader('x-request-id') } });
}
