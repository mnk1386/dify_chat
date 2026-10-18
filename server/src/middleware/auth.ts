/**
 * Session authentication + CSRF protection middleware.
 * - Session cookie: HttpOnly, SameSite=Lax (Strict when SECURE_COOKIES), Secure in prod.
 * - CSRF: double-submit pattern — session-bound token delivered via /api/auth/me,
 *   required in X-CSRF-Token header on state-changing methods.
 * - Authorization checks happen here (backend), never only in the UI.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { runtimeSettings } from '../config';
import { getSession, findUserById, UserRow, logEvent } from '../db';
import { authenticateSignedHeader } from '../services/auth';
import { AppError } from '../utils/errors';

export interface AuthedRequest extends Request {
  user?: UserRow;
  sessionToken?: string;
  csrfToken?: string;
}

export const SESSION_COOKIE = 'dchat_session';
export const CSRF_HEADER = 'x-csrf-token';

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie || '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function setSessionCookie(res: Response, token: string) {
  const cfg = runtimeSettings.get();
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    `SameSite=${cfg.secureCookies ? 'Strict' : 'Lax'}`,
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (cfg.secureCookies) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(res: Response) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

function resolveUser(req: AuthedRequest): UserRow | null {
  // 1) organizational signed-header provider
  const identity = authenticateSignedHeader(
    req.headers['x-auth-user'] as string | undefined,
    req.headers['x-auth-sign'] as string | undefined,
  );
  if (identity) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ensureUser } = require('../services/auth');
    return ensureUser(identity);
  }
  // 2) local session cookie
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const sess = getSession(token);
  if (!sess) return null;
  const user = findUserById(sess.user_id);
  if (!user) return null;
  req.sessionToken = token;
  req.csrfToken = sess.csrf_token;
  return user;
}

export function attachUser(req: AuthedRequest, _res: Response, next: NextFunction) {
  req.user = resolveUser(req) || undefined;
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    logEvent({ level: 'security', type: 'unauthorized_api', requestId: res.getHeader('x-request-id') as string });
    res.status(401).json({ error: { code: 'unauthenticated', message: 'برای ادامه باید وارد سامانه شوید.' } });
    return;
  }
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: { code: 'unauthenticated', message: 'برای ادامه باید وارد سامانه شوید.' } });
    return;
  }
  if (req.user.role !== 'admin') {
    logEvent({ level: 'security', type: 'admin_access_denied', userId: req.user.id, requestId: res.getHeader('x-request-id') as string });
    res.status(403).json({ error: { code: 'forbidden', message: 'این بخش فقط برای مدیر سامانه است.' } });
    return;
  }
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireCsrf(req: AuthedRequest, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.user) return next(); // unauthenticated handled by requireAuth ordering
  const provided = String(req.headers[CSRF_HEADER] || '');
  const expected = req.csrfToken || '';
  let ok = false;
  try {
    ok = provided.length > 0 && expected.length > 0 &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch { ok = false; }
  if (!ok) {
    logEvent({ level: 'security', type: 'csrf_failure', userId: req.user?.id, requestId: res.getHeader('x-request-id') as string });
    res.status(403).json({ error: { code: 'csrf_failed', message: 'اعتبار درخواست (CSRF) تأیید نشد. صفحه را بازخوانی کنید.' } });
    return;
  }
  next();
}

export function sessionTtlMs(): number { return SESSION_TTL_MS; }

void AppError; // keep import graph stable
