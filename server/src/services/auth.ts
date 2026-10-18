/**
 * Auth providers + server-side sessions.
 * - LocalProvider: username/password (scrypt) — default, no insecure fallback.
 * - HeaderProvider: for connecting to an organizational IdP/SSO gateway that
 *   injects a signed header (e.g. reverse-proxy OIDC). Enable with AUTH_PROVIDER=header
 *   and AUTH_HEADER_SECRET (shared secret for HMAC-signed user header).
 */

import crypto from 'crypto';
import { runtimeSettings } from '../config';
import { findUserByUsername, createUser, UserRow } from '../db';
import { logger } from '../utils/logger';

export interface Identity { username: string; displayName?: string; role?: 'user' | 'admin'; }

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
  } catch { return false; }
}

/** Ensure the user row exists; returns it. Auto-provision on first login via SSO. */
export function ensureUser(identity: Identity): UserRow {
  let user = findUserByUsername(identity.username);
  if (!user) {
    const role = identity.role === 'admin' ? 'admin' : 'user';
    user = createUser(identity.username, identity.displayName || identity.username, role, null);
    logger.info('user provisioned', { userId: user.id });
  } else if (identity.role && identity.role !== user.role) {
    // Role updates come only from the trusted IdP mapping.
    const { getDb } = require('../db');
    getDb().prepare('UPDATE users SET role = ? WHERE id = ?').run(identity.role, user.id);
    user.role = identity.role;
  }
  return user;
}

/** Verify credentials against the configured provider. Returns identity or null. */
export async function authenticateCredentials(payload: Record<string, unknown>): Promise<Identity | null> {
  const provider = process.env.AUTH_PROVIDER || 'local';
  if (provider === 'local') {
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    if (!username || !password) return null;
    const user = findUserByUsername(username);
    if (!user || !verifyPassword(password, user.password_hash)) return null;
    return { username: user.username, displayName: user.display_name || undefined, role: user.role as 'user' | 'admin' };
  }
  // Header/SSO provider does not use password login here.
  return null;
}

/**
 * Verify a signed identity header from an organizational gateway:
 *   X-Auth-User: <username>
 *   X-Auth-Sign: hex(hmac_sha256(secret, username))
 */
export function authenticateSignedHeader(usernameHeader: string | undefined, signatureHeader: string | undefined): Identity | null {
  const provider = process.env.AUTH_PROVIDER || 'local';
  if (provider !== 'header') return null;
  const secret = process.env.AUTH_HEADER_SECRET || '';
  if (!usernameHeader || !signatureHeader || !secret) return null;
  const expected = crypto.createHmac('sha256', secret).update(usernameHeader).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader))) return null;
  } catch { return null; }
  const adminList = (process.env.ADMIN_USERNAMES || '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    username: usernameHeader,
    displayName: usernameHeader,
    role: adminList.includes(usernameHeader) ? 'admin' : 'user',
  };
}

/** Bootstrap admin from env so the system never starts without an admin path. */
export function bootstrapAdminFromEnv() {
  const provider = process.env.AUTH_PROVIDER || 'local';
  if (provider !== 'local') return; // org auth manages roles itself
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!username || !password) return;
  const existing = findUserByUsername(username);
  if (!existing) {
    createUser(username, 'مدیر سامانه', 'admin', hashPassword(password));
    logger.info('bootstrap admin created', { username });
  } else if (!existing.password_hash) {
    const { getDb } = require('../db');
    getDb().prepare('UPDATE users SET password_hash = ?, role = ? WHERE id = ?')
      .run(hashPassword(password), 'admin', existing.id);
  }
}

export function currentConfiguredProvider(): string {
  return process.env.AUTH_PROVIDER || 'local';
}

// Keep settings module import referenced for tree-shakers / clarity
void runtimeSettings;
