/**
 * Database layer (SQLite via better-sqlite3).
 * DATABASE_URL is a file path (e.g. ./data/app.db) or :memory: for tests.
 *
 * The source of truth for messages/conversations remains Dify.
 * Local DB stores only: users, sessions, user<->dify id mapping,
 * conversation index metadata (for search/pagination), non-secret app settings,
 * and technical/error events.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function initDb(databaseUrl: string): Database.Database {
  if (databaseUrl !== ':memory:') {
    const dir = path.dirname(databaseUrl);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  db = new Database(databaseUrl);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,                -- internal stable uuid
      username TEXT UNIQUE NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'user',  -- user | admin
      dify_user_id TEXT NOT NULL,         -- stable unguessable id sent to Dify as "user"
      password_hash TEXT,                 -- scrypt hash (local auth provider)
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,        -- sha256 of session token; raw token never stored
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations_index (
      id TEXT PRIMARY KEY,                -- local uuid
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      dify_conversation_id TEXT NOT NULL,
      name TEXT,
      last_activity_at INTEGER,           -- unix seconds reported by Dify
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations_index(user_id, deleted, last_activity_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_dify ON conversations_index(dify_conversation_id, user_id);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      is_secret INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      level TEXT NOT NULL,                -- info | warn | error | security
      type TEXT NOT NULL,                 -- e.g. login_failed, dify_error, forbidden_access
      user_id TEXT,
      request_id TEXT,
      detail TEXT                         -- sanitized technical detail, no secrets / no chat content
    );

    CREATE TABLE IF NOT EXISTS message_cache (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      dify_conversation_id TEXT NOT NULL,
      dify_message_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content_preview TEXT,               -- short preview only (used for local search), not full text
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_msgcache_conv ON message_cache(dify_conversation_id);
  `);
}

/* ---------------- users ---------------- */

export interface UserRow {
  id: string; username: string; display_name: string | null; role: string;
  dify_user_id: string; password_hash: string | null; created_at: string;
}

export function createUser(username: string, displayName: string, role: 'user' | 'admin', passwordHash: string | null): UserRow {
  const d = getDb();
  const row: UserRow = {
    id: crypto.randomUUID(),
    username,
    display_name: displayName || username,
    role,
    dify_user_id: crypto.randomBytes(16).toString('hex'), // stable, unguessable per-user id
    password_hash: passwordHash,
    created_at: new Date().toISOString(),
  };
  d.prepare(`INSERT INTO users (id, username, display_name, role, dify_user_id, password_hash, created_at)
              VALUES (@id, @username, @display_name, @role, @dify_user_id, @password_hash, @created_at)`)
    .run(row);
  return row;
}

export function findUserByUsername(username: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
}

export function findUserById(id: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

/* ---------------- sessions ---------------- */

export interface SessionRow {
  token_hash: string; user_id: string; csrf_token: string; created_at: string; expires_at: string;
}

export function createSession(userId: string, ttlMs: number): { token: string; session: SessionRow } {
  const token = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  const token_hash = hashToken(token);
  const now = Date.now();
  const row: SessionRow = {
    token_hash,
    user_id: userId,
    csrf_token: csrf,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlMs).toISOString(),
  };
  getDb().prepare(`INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at)
                   VALUES (@token_hash, @user_id, @csrf_token, @created_at, @expires_at)`).run(row);
  return { token, session: row };
}

export function getSession(token: string): SessionRow | undefined {
  const h = hashToken(token);
  const row = getDb().prepare('SELECT * FROM sessions WHERE token_hash = ?').get(h) as SessionRow | undefined;
  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    deleteSessionByToken(token);
    return undefined;
  }
  return row;
}

export function deleteSessionByToken(token: string) {
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/* ---------------- settings ---------------- */

export function setSetting(key: string, value: string, isSecret = false) {
  getDb().prepare(`INSERT INTO app_settings (key, value, is_secret, updated_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret, updated_at = excluded.updated_at`)
    .run(key, value, isSecret ? 1 : 0, new Date().toISOString());
}

export function getSetting(key: string): string | undefined {
  const r = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return r?.value;
}

/* ---------------- conversation index ---------------- */

export interface ConvIndexRow {
  id: string; user_id: string; dify_conversation_id: string; name: string | null;
  last_activity_at: number | null; created_at: string; updated_at: string; deleted: number;
}

export function upsertConversationIndex(p: {
  userId: string; difyConversationId: string; name?: string | null; lastActivityAt?: number | null;
}): ConvIndexRow {
  const d = getDb();
  const existing = d.prepare('SELECT * FROM conversations_index WHERE dify_conversation_id = ? AND user_id = ?')
    .get(p.difyConversationId, p.userId) as ConvIndexRow | undefined;
  const now = new Date().toISOString();
  if (existing) {
    d.prepare(`UPDATE conversations_index SET name = COALESCE(?, name), last_activity_at = COALESCE(?, last_activity_at),
               updated_at = ?, deleted = 0 WHERE id = ?`)
      .run(p.name ?? null, p.lastActivityAt ?? null, now, existing.id);
    return { ...existing, name: p.name ?? existing.name, last_activity_at: p.lastActivityAt ?? existing.last_activity_at, deleted: 0 } as ConvIndexRow;
  }
  const row: ConvIndexRow = {
    id: crypto.randomUUID(),
    user_id: p.userId,
    dify_conversation_id: p.difyConversationId,
    name: p.name ?? null,
    last_activity_at: p.lastActivityAt ?? null,
    created_at: now,
    updated_at: now,
    deleted: 0,
  };
  d.prepare(`INSERT INTO conversations_index (id, user_id, dify_conversation_id, name, last_activity_at, created_at, updated_at, deleted)
              VALUES (@id, @user_id, @dify_conversation_id, @name, @last_activity_at, @created_at, @updated_at, @deleted)`).run(row);
  return row;
}

export function renameConversationIndex(userId: string, difyConversationId: string, name: string) {
  getDb().prepare('UPDATE conversations_index SET name = ?, updated_at = ? WHERE user_id = ? AND dify_conversation_id = ?')
    .run(name, new Date().toISOString(), userId, difyConversationId);
}

export function markConversationDeleted(userId: string, difyConversationId: string) {
  // Local cache sync on deletion: rows are flagged deleted then purged (privacy + consistency).
  getDb().prepare('UPDATE conversations_index SET deleted = 1, updated_at = ? WHERE user_id = ? AND dify_conversation_id = ?')
    .run(new Date().toISOString(), userId, difyConversationId);
  getDb().prepare('DELETE FROM message_cache WHERE user_id = ? AND dify_conversation_id = ?')
    .run(userId, difyConversationId);
}

export function searchConversationIndex(userId: string, query: string, limit = 50): ConvIndexRow[] {
  const like = `%${query.replace(/[%_]/g, '')}%`;
  return getDb().prepare(`SELECT * FROM conversations_index
                          WHERE user_id = ? AND deleted = 0 AND (name LIKE ? OR dify_conversation_id IN
                            (SELECT dify_conversation_id FROM message_cache WHERE user_id = ? AND content_preview LIKE ?))
                          ORDER BY COALESCE(last_activity_at, 0) DESC LIMIT ?`)
    .all(userId, like, userId, like, limit) as ConvIndexRow[];
}

export function listConversationIndex(userId: string): ConvIndexRow[] {
  return getDb().prepare('SELECT * FROM conversations_index WHERE user_id = ? AND deleted = 0')
    .all(userId) as ConvIndexRow[];
}

export function cacheMessagePreview(p: {
  userId: string; difyConversationId: string; difyMessageId: string; role: string; content: string;
}) {
  const preview = p.content.slice(0, 400);
  getDb().prepare(`INSERT OR REPLACE INTO message_cache (id, user_id, dify_conversation_id, dify_message_id, role, content_preview, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), p.userId, p.difyConversationId, p.difyMessageId, p.role, preview, new Date().toISOString());
}

/* ---------------- events ---------------- */

export function logEvent(p: { level: string; type: string; userId?: string | null; requestId?: string | null; detail?: string }) {
  getDb().prepare(`INSERT INTO events (id, ts, level, type, user_id, request_id, detail)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), new Date().toISOString(), p.level, p.type, p.userId ?? null, p.requestId ?? null,
      (p.detail || '').slice(0, 2000));
}

export function recentEvents(limit = 100) {
  return getDb().prepare('SELECT * FROM events ORDER BY ts DESC LIMIT ?').all(limit) as Array<{
    id: string; ts: string; level: string; type: string; user_id: string | null; request_id: string | null; detail: string | null;
  }>;
}
