/**
 * Conversation ownership guard.
 * Dify scopes conversations by the `user` id we send; but a malicious client could
 * pass another conversation id while still being scoped to their own user id.
 * We additionally verify against the local index that the conversation belongs to
 * this user (indexed at creation/list time) — defense in depth, checked on backend.
 */

import { Response, NextFunction } from 'express';
import { getDb, logEvent } from '../db';
import { AuthedRequest } from './auth';

export function assertConversationOwnership(req: AuthedRequest, res: Response, next: NextFunction, difyConversationId: string) {
  const user = req.user!;
  const row = getDb().prepare(
    'SELECT * FROM conversations_index WHERE dify_conversation_id = ? AND user_id = ? AND deleted = 0'
  ).get(difyConversationId, user.id);
  if (!row) {
    logEvent({
      level: 'security', type: 'foreign_conversation_access', userId: user.id,
      requestId: String(res.getHeader('x-request-id') || ''), detail: `conv=${difyConversationId}`,
    });
    res.status(403).json({ error: { code: 'forbidden_conversation', message: 'این مکالمه متعلق به شما نیست.' } });
    return false;
  }
  next();
  return true;
}
