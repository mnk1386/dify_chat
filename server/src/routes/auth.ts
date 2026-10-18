/**
 * Auth routes: login / logout / me.
 */

import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { validate, loginSchema } from '../utils/validation';
import { authenticateCredentials, ensureUser, currentConfiguredProvider } from '../services/auth';
import { createSession, deleteSessionByToken, logEvent } from '../db';
import { AuthedRequest, setSessionCookie, clearSessionCookie, requireAuth, sessionTtlMs } from '../middleware/auth';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'تعداد تلاش‌های ورود بیش از حد است. کمی صبر کنید.' } },
});

authRouter.get('/provider', (_req, res) => {
  // Expose only the provider name; no secrets.
  res.json({ provider: currentConfiguredProvider() });
});

authRouter.post('/login', loginLimiter, async (req: AuthedRequest, res: Response) => {
  try {
    const body = validate(loginSchema, req.body);
    const identity = await authenticateCredentials(body);
    if (!identity) {
      logEvent({ level: 'security', type: 'login_failed', detail: `user=${body.username}` });
      res.status(401).json({ error: { code: 'invalid_credentials', message: 'نام کاربری یا رمز عبور نادرست است.' } });
      return;
    }
    const user = ensureUser(identity);
    const { token } = createSession(user.id, sessionTtlMs());
    setSessionCookie(res, token);
    res.json({ ok: true });
  } catch (e) {
    next_error(res, e);
  }
});

authRouter.post('/logout', (req: AuthedRequest, res: Response) => {
  const cookies = require('../middleware/auth').parseCookies(req);
  const token = cookies[require('../middleware/auth').SESSION_COOKIE];
  if (token) deleteSessionByToken(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req: AuthedRequest, res: Response) => {
  const u = req.user!;
  res.json({
    user: {
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      role: u.role,
    },
    csrfToken: req.csrfToken, // CSRF double-submit token is safe to expose to its own session owner
  });
});

function next_error(res: Response, e: unknown) {
  const status = (e as { status?: number }).status || 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: { code: 'internal', message: 'خطای داخلی رخ داد.' },
  });
}
