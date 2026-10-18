/**
 * Express app factory — wires middleware, routes and static frontend.
 * Exported separately from index.ts so tests can create isolated instances.
 */

import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { runtimeSettings } from './config';
import { attachUser } from './middleware/auth';
import { authRouter } from './routes/auth';
import { chatRouter } from './routes/chat';
import { conversationsRouter } from './routes/conversations';
import { appRouter } from './routes/app';
import { adminRouter } from './routes/admin';
import { requireAuth } from './middleware/auth';
import { logger } from './utils/logger';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // trust proxy: only in production, and only behind an explicitly configured
  // trusted proxy CIDR list (never `true`, which would let anyone spoof XFF
  // and bypass IP-based rate limiting).
  if (process.env.NODE_ENV === 'production') {
    const cidrs = (process.env.TRUST_PROXY_CIDRS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (cidrs.length) app.set('trust proxy', cidrs);
  }

  // Security headers with CSP tuned for an internal app that ships all assets locally.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind/vite injects styles; inline needed for theme toggling
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false, // allow local blob images
  }));

  // request id for tracing errors (never contains secrets)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    res.setHeader('X-Request-Id', id);
    next();
  });

  app.use(express.json({ limit: '1mb' }));   // body size guard
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // Global rate limiting + stricter limiter for AI calls
  app.use('/api/', rateLimit({
    windowMs: runtimeSettings.get().rateLimitWindowMs,
    limit: runtimeSettings.get().rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path.startsWith('/auth/login'), // login has its own limiter
    message: { error: { code: 'rate_limited', message: 'تعداد درخواست‌ها بیش از حد مجاز است. لحظی صبر کنید.' } },
  }));
  app.use('/api/chat/send', rateLimit({
    windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'ارسال پیام سریع‌تر از حد مجاز است.' } },
  }));

  app.use(attachUser);

  app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
  app.use('/api/auth', authRouter);
  // All remaining /api routers require a valid session (backend-enforced).
  app.use('/api/chat', requireAuth, chatRouter);
  app.use('/api/conversations', requireAuth, conversationsRouter);
  app.use('/api/app', requireAuth, appRouter);
  app.use('/api/admin', requireAuth, adminRouter);

  // 404 for unknown API endpoints
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'مسیر موردنظر یافت نشد.' } }));

  // Static frontend build (single container deployment)
  const webDist = process.env.WEB_DIST_DIR || path.join(__dirname, '..', '..', 'web', 'dist');
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'), (err) => {
      if (err) {
        logger.debug('static fallback failed', { err: String(err) });
        res.status(200).type('html').send('<!doctype html><html dir="rtl"><body style="font-family:sans-serif;padding:2rem">فرانت‌اند ساخته نشده است. در محیط توسعه از Vite dev server استفاده کنید یا `npm run build` را اجرا کنید.</body></html>');
      }
    });
  });

  // Final error handler — never leaks stack traces.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('unhandled route error', { message: err.message });
    if (res.headersSent) return;
    const status = (err as Error & { status?: number }).status || 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: { code: 'internal', message: 'خطای داخلی سرور رخ داد.', requestId: res.getHeader('x-request-id') },
    });
  });

  return app;
}
