"use strict";
/**
 * Database layer (SQLite via better-sqlite3).
 * DATABASE_URL is a file path (e.g. ./data/app.db) or :memory: for tests.
 *
 * The source of truth for messages/conversations remains Dify.
 * Local DB stores only: users, sessions, user<->dify id mapping,
 * conversation index metadata (for search/pagination), non-secret app settings,
 * and technical/error events.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.initDb = initDb;
exports.createUser = createUser;
exports.findUserByUsername = findUserByUsername;
exports.findUserById = findUserById;
exports.createSession = createSession;
exports.getSession = getSession;
exports.deleteSessionByToken = deleteSessionByToken;
exports.hashToken = hashToken;
exports.setSetting = setSetting;
exports.getSetting = getSetting;
exports.upsertConversationIndex = upsertConversationIndex;
exports.renameConversationIndex = renameConversationIndex;
exports.markConversationDeleted = markConversationDeleted;
exports.searchConversationIndex = searchConversationIndex;
exports.listConversationIndex = listConversationIndex;
exports.cacheMessagePreview = cacheMessagePreview;
exports.logEvent = logEvent;
exports.recentEvents = recentEvents;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
let db = null;
function getDb() {
    if (!db)
        throw new Error('Database not initialized');
    return db;
}
function initDb(databaseUrl) {
    if (databaseUrl !== ':memory:') {
        const dir = path_1.default.dirname(databaseUrl);
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
    }
    db = new better_sqlite3_1.default(databaseUrl);
    db.pragma('journal_mode = WAL');
    migrate(db);
    return db;
}
function migrate(d) {
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
function createUser(username, displayName, role, passwordHash) {
    const d = getDb();
    const row = {
        id: crypto_1.default.randomUUID(),
        username,
        display_name: displayName || username,
        role,
        dify_user_id: crypto_1.default.randomBytes(16).toString('hex'), // stable, unguessable per-user id
        password_hash: passwordHash,
        created_at: new Date().toISOString(),
    };
    d.prepare(`INSERT INTO users (id, username, display_name, role, dify_user_id, password_hash, created_at)
              VALUES (@id, @username, @display_name, @role, @dify_user_id, @password_hash, @created_at)`)
        .run(row);
    return row;
}
function findUserByUsername(username) {
    return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}
function findUserById(id) {
    return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}
function createSession(userId, ttlMs) {
    const token = crypto_1.default.randomBytes(32).toString('hex');
    const csrf = crypto_1.default.randomBytes(24).toString('hex');
    const token_hash = hashToken(token);
    const now = Date.now();
    const row = {
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
function getSession(token) {
    const h = hashToken(token);
    const row = getDb().prepare('SELECT * FROM sessions WHERE token_hash = ?').get(h);
    if (!row)
        return undefined;
    if (new Date(row.expires_at).getTime() < Date.now()) {
        deleteSessionByToken(token);
        return undefined;
    }
    return row;
}
function deleteSessionByToken(token) {
    getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}
function hashToken(token) {
    return crypto_1.default.createHash('sha256').update(token).digest('hex');
}
/* ---------------- settings ---------------- */
function setSetting(key, value, isSecret = false) {
    getDb().prepare(`INSERT INTO app_settings (key, value, is_secret, updated_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret, updated_at = excluded.updated_at`)
        .run(key, value, isSecret ? 1 : 0, new Date().toISOString());
}
function getSetting(key) {
    const r = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    return r?.value;
}
function upsertConversationIndex(p) {
    const d = getDb();
    const existing = d.prepare('SELECT * FROM conversations_index WHERE dify_conversation_id = ? AND user_id = ?')
        .get(p.difyConversationId, p.userId);
    const now = new Date().toISOString();
    if (existing) {
        d.prepare(`UPDATE conversations_index SET name = COALESCE(?, name), last_activity_at = COALESCE(?, last_activity_at),
               updated_at = ?, deleted = 0 WHERE id = ?`)
            .run(p.name ?? null, p.lastActivityAt ?? null, now, existing.id);
        return { ...existing, name: p.name ?? existing.name, last_activity_at: p.lastActivityAt ?? existing.last_activity_at, deleted: 0 };
    }
    const row = {
        id: crypto_1.default.randomUUID(),
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
function renameConversationIndex(userId, difyConversationId, name) {
    getDb().prepare('UPDATE conversations_index SET name = ?, updated_at = ? WHERE user_id = ? AND dify_conversation_id = ?')
        .run(name, new Date().toISOString(), userId, difyConversationId);
}
function markConversationDeleted(userId, difyConversationId) {
    // Local cache sync on deletion: rows are flagged deleted then purged (privacy + consistency).
    getDb().prepare('UPDATE conversations_index SET deleted = 1, updated_at = ? WHERE user_id = ? AND dify_conversation_id = ?')
        .run(new Date().toISOString(), userId, difyConversationId);
    getDb().prepare('DELETE FROM message_cache WHERE user_id = ? AND dify_conversation_id = ?')
        .run(userId, difyConversationId);
}
function searchConversationIndex(userId, query, limit = 50) {
    const like = `%${query.replace(/[%_]/g, '')}%`;
    return getDb().prepare(`SELECT * FROM conversations_index
                          WHERE user_id = ? AND deleted = 0 AND (name LIKE ? OR dify_conversation_id IN
                            (SELECT dify_conversation_id FROM message_cache WHERE user_id = ? AND content_preview LIKE ?))
                          ORDER BY COALESCE(last_activity_at, 0) DESC LIMIT ?`)
        .all(userId, like, userId, like, limit);
}
function listConversationIndex(userId) {
    return getDb().prepare('SELECT * FROM conversations_index WHERE user_id = ? AND deleted = 0')
        .all(userId);
}
function cacheMessagePreview(p) {
    const preview = p.content.slice(0, 400);
    getDb().prepare(`INSERT OR REPLACE INTO message_cache (id, user_id, dify_conversation_id, dify_message_id, role, content_preview, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(crypto_1.default.randomUUID(), p.userId, p.difyConversationId, p.difyMessageId, p.role, preview, new Date().toISOString());
}
/* ---------------- events ---------------- */
function logEvent(p) {
    getDb().prepare(`INSERT INTO events (id, ts, level, type, user_id, request_id, detail)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(crypto_1.default.randomUUID(), new Date().toISOString(), p.level, p.type, p.userId ?? null, p.requestId ?? null, (p.detail || '').slice(0, 2000));
}
function recentEvents(limit = 100) {
    return getDb().prepare('SELECT * FROM events ORDER BY ts DESC LIMIT ?').all(limit);
}
//# sourceMappingURL=index.js.map