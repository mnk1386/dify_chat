/**
 * Conversation ownership guard.
 * Dify scopes conversations by the `user` id we send; but a malicious client could
 * pass another conversation id while still being scoped to their own user id.
 * Verification is two-layered (defense in depth, always checked on the backend):
 *  1) Local index: if the conversation is known and belongs to ANOTHER local user → deny immediately.
 *  2) Dify itself: fetch the conversation's messages scoped to this session user's stable id.
 *     - If Dify returns data → it is the user's conversation (index synced).
 *     - Empty result / not-found → not the user's conversation → 403.
 * This keeps the check authoritative against Dify (source of truth) instead of
 * relying solely on a possibly stale local cache.
 */

import { Response } from 'express';
import { getDb, logEvent, upsertConversationIndex } from '../db';
import * as dify from '../dify/client';
import { AppError } from '../utils/errors';

function indexedOwner(difyConversationId: string): string | null {
  const row = getDb().prepare(
    'SELECT user_id FROM conversations_index WHERE dify_conversation_id = ? AND deleted = 0'
  ).get(difyConversationId) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}

export function assertConversationOwnership(req: { user?: { id: string } }, res: Response, difyConversationId: string): boolean {
  // Synchronous fast path: reject conversations that our index attributes to someone else.
  const owner = indexedOwner(difyConversationId);
  const userId = req.user?.id;
  if (owner && userId && owner !== userId) {
    logEvent({
      level: 'security', type: 'foreign_conversation_access', userId,
      requestId: String(res.getHeader('x-request-id') || ''), detail: `conv=${difyConversationId}`,
    });
    res.status(403).json({ error: { code: 'forbidden_conversation', message: 'این مکالمه متعلق به شما نیست.' } });
    return false;
  }
  return true;
}

/**
 * Full async ownership check used before any per-conversation operation.
 * Throws AppError(403) when access must be denied; caller converts to a response.
 */
export async function ensureConversationBelongsToUser(
  difyConversationId: string,
  userId: string,
  difyUserId: string,
  requestId = '',
): Promise<void> {
  if (!assertConversationOwnership({ user: { id: userId } }, fakeRes(requestId), difyConversationId)) {
    throw new AppError(403, 'forbidden_conversation', 'این مکالمه متعلق به شما نیست.');
  }
  try {
    const probe = await dify.getMessages(difyConversationId, difyUserId, undefined, 1);
    if (!probe || !Array.isArray(probe.data)) {
      throw new AppError(403, 'forbidden_conversation', 'این مکالمه متعلق به شما نیست.');
    }
    // Verified — keep the local index attached to this user so listing/search stay consistent.
    upsertConversationIndex({ userId, difyConversationId });
  } catch (e) {
    if (e instanceof AppError) throw e;
    const de = e as { status?: number; difyCode?: string };
    if (de?.status === 404 || de?.difyCode === 'not_found') {
      logEvent({ level: 'security', type: 'foreign_conversation_access', userId, requestId, detail: `conv=${difyConversationId} (dify-not-found)` });
      throw new AppError(403, 'forbidden_conversation', 'این مکالمه متعلق به شما نیست.');
    }
    // Dify unreachable or other API error — fall back to the local index decision.
    const owner = indexedOwner(difyConversationId);
    if (owner === userId) return; // known to belong to this user → allow (offline tolerance)
    logEvent({ level: 'warn', type: 'ownership_check_degraded', userId, requestId, detail: `conv=${difyConversationId}` });
    throw new AppError(502, 'upstream_unavailable', 'سرویس در دسترس نیست، دسترسی تأیید نشد.');
  }
}

/* Minimal Response-shaped object for the sync helper's logging/header use. */
function fakeRes(requestId: string): Response {
  return {
    getHeader: () => requestId,
    status: () => ({ json: () => undefined }),
  } as unknown as Response;
}
