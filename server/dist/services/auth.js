"use strict";
/**
 * Auth providers + server-side sessions.
 * - LocalProvider: username/password (scrypt) — default, no insecure fallback.
 * - HeaderProvider: for connecting to an organizational IdP/SSO gateway that
 *   injects a signed header (e.g. reverse-proxy OIDC). Enable with AUTH_PROVIDER=header
 *   and AUTH_HEADER_SECRET (shared secret for HMAC-signed user header).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
exports.ensureUser = ensureUser;
exports.authenticateCredentials = authenticateCredentials;
exports.authenticateSignedHeader = authenticateSignedHeader;
exports.bootstrapAdminFromEnv = bootstrapAdminFromEnv;
exports.currentConfiguredProvider = currentConfiguredProvider;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
const db_1 = require("../db");
const logger_1 = require("../utils/logger");
function hashPassword(password) {
    const salt = crypto_1.default.randomBytes(16).toString('hex');
    const hash = crypto_1.default.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
    if (!stored)
        return false;
    const [salt, hash] = stored.split(':');
    if (!salt || !hash)
        return false;
    const candidate = crypto_1.default.scryptSync(password, salt, 64).toString('hex');
    try {
        return crypto_1.default.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
    }
    catch {
        return false;
    }
}
/** Ensure the user row exists; returns it. Auto-provision on first login via SSO. */
function ensureUser(identity) {
    let user = (0, db_1.findUserByUsername)(identity.username);
    if (!user) {
        const role = identity.role === 'admin' ? 'admin' : 'user';
        user = (0, db_1.createUser)(identity.username, identity.displayName || identity.username, role, null);
        logger_1.logger.info('user provisioned', { userId: user.id });
    }
    else if (identity.role && identity.role !== user.role) {
        // Role updates come only from the trusted IdP mapping.
        const { getDb } = require('../db');
        getDb().prepare('UPDATE users SET role = ? WHERE id = ?').run(identity.role, user.id);
        user.role = identity.role;
    }
    return user;
}
/** Verify credentials against the configured provider. Returns identity or null. */
async function authenticateCredentials(payload) {
    const provider = process.env.AUTH_PROVIDER || 'local';
    if (provider === 'local') {
        const username = String(payload.username || '').trim();
        const password = String(payload.password || '');
        if (!username || !password)
            return null;
        const user = (0, db_1.findUserByUsername)(username);
        if (!user || !verifyPassword(password, user.password_hash))
            return null;
        return { username: user.username, displayName: user.display_name || undefined, role: user.role };
    }
    // Header/SSO provider does not use password login here.
    return null;
}
/**
 * Verify a signed identity header from an organizational gateway:
 *   X-Auth-User: <username>
 *   X-Auth-Sign: hex(hmac_sha256(secret, username))
 */
function authenticateSignedHeader(usernameHeader, signatureHeader) {
    const provider = process.env.AUTH_PROVIDER || 'local';
    if (provider !== 'header')
        return null;
    const secret = process.env.AUTH_HEADER_SECRET || '';
    if (!usernameHeader || !signatureHeader || !secret)
        return null;
    const expected = crypto_1.default.createHmac('sha256', secret).update(usernameHeader).digest('hex');
    try {
        if (!crypto_1.default.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader)))
            return null;
    }
    catch {
        return null;
    }
    const adminList = (process.env.ADMIN_USERNAMES || '').split(',').map(s => s.trim()).filter(Boolean);
    return {
        username: usernameHeader,
        displayName: usernameHeader,
        role: adminList.includes(usernameHeader) ? 'admin' : 'user',
    };
}
/** Bootstrap admin from env so the system never starts without an admin path. */
function bootstrapAdminFromEnv() {
    const provider = process.env.AUTH_PROVIDER || 'local';
    if (provider !== 'local')
        return; // org auth manages roles itself
    const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (!username || !password)
        return;
    const existing = (0, db_1.findUserByUsername)(username);
    if (!existing) {
        (0, db_1.createUser)(username, 'مدیر سامانه', 'admin', hashPassword(password));
        logger_1.logger.info('bootstrap admin created', { username });
    }
    else if (!existing.password_hash) {
        const { getDb } = require('../db');
        getDb().prepare('UPDATE users SET password_hash = ?, role = ? WHERE id = ?')
            .run(hashPassword(password), 'admin', existing.id);
    }
}
function currentConfiguredProvider() {
    return process.env.AUTH_PROVIDER || 'local';
}
// Keep settings module import referenced for tree-shakers / clarity
void config_1.runtimeSettings;
//# sourceMappingURL=auth.js.map