/**
 * Conversation management routes.
 * Dify is the source of truth; backend proxies official endpoints and keeps a local index
 * (names, timestamps) which powers search + pagination fallbacks.
 */

import { Router, Response } from 'express';
import { AuthedRequest, requireCsrf } from '../middleware/auth';
import { validate, renameSchema, conversationIdSchema, variableUpdateSchema } from '../utils/validation';
import * as dify from '../dify/client';
import { upsertConversationIndex, markConversationDeleted, renameConversationIndex, searchConversationIndex, listConversationIndex, logEvent } from '../db';
import { assertConversationOwnership } from '../middleware/ownership';
import { handleRouteError } from './errors-helper';

export const conversationsRouter = Router();

/* GET /api/conversations?lastId=&limit=&q=  */
conversationsRouter.get('/', async (req: AuthedRequest, res: Response) => {
  try {
    const user = req.user!;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);
    const lastId = typeof req.query.lastId === 'string' ? req.query.lastId : undefined;

    // Local search path: Dify's app API has no conversation-search endpoint —
    // we search our own index (titles + message previews). Clearly documented, not fake.
    if (q) {
      const rows = searchConversationIndex(user.id, q, limit);
      res.json({
        mode: 'local_index_search',
        data: rows.map(r => ({ id: r.dify_conversation_id, name: r.name, created_at: r.last_activity_at })),
        has_more: false,
      });
      return;
    }

    const result = await dify.listConversations(user.dify_user_id, lastId, limit);
    // Sync into local index for offline-tolerant listing/search.
    for (const c of result.data) {
      upsertConversationIndex({ userId: user.id, difyConversationId: c.id, name: c.name, lastActivityAt: c.created_at });
    }
    res.json(result);
  } catch (e) {
    // Fallback to local index when Dify is unreachable so history remains browsable.
    const user = req.user!;
    const rows = listConversationIndex(user.id);
    logEvent({ level: 'warn', type: 'conversations_fallback_local', userId: user.id, detail: String((e as Error).message).slice(0, 200) });
    res.json({ mode: 'local_index_fallback', data: rows.map(r => ({ id: r.dify_conversation_id, name: r.name, created_at: r.last_activity_at })), has_more: false });
  }
});

/* GET /api/conversations/:id/messages?firstId=&limit= */
conversationsRouter.get('/:id/messages', async (req: AuthedRequest, res: Response) => {
  try {
    const id = validate(conversationIdSchema, req.params.id);
    const user = req.user!;
    if (!assertConversationOwnership(req, res, () => undefined, id)) return;
    const firstId = typeof req.query.firstId === 'string' ? req.query.firstId : undefined;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);
    const result = await dify.getMessages(id, user.dify_user_id, firstId, limit);
    // cache previews for search
    for (const m of result.data) {
      if (m.answer) {
        try {
          require('../db').cacheMessagePreview({ userId: user.id, difyConversationId: id, difyMessageId: m.id, role: 'assistant', content: m.answer });
          if (m.query) require('../db').cacheMessagePreview({ userId: user.id, difyConversationId: id, difyMessageId: m.id + '-q', role: 'user', content: m.query });
        } catch { /* non-critical */ }
      }
    }
    res.json(result);
  } catch (e) { handleRouteError(res, e, req); }
});

/* POST /api/conversations/:id/rename */
conversationsRouter.post('/:id/rename', requireCsrf, async (req: AuthedRequest, res: Response) => {
  try {
    const id = validate(conversationIdSchema, req.params.id);
    const body = validate(renameSchema, req.body);
    const user = req.user!;
    if (!assertConversationOwnership(req, res, () => undefined, id)) return;
    const conv = await dify.renameConversation(id, user.dify_user_id, body.name);
    renameConversationIndex(user.id, id, body.name);
    res.json({ ok: true, conversation: conv });
  } catch (e) { handleRouteError(res, e, req); }
});

/* DELETE /api/conversations/:id */
conversationsRouter.delete('/:id', requireCsrf, async (req: AuthedRequest, res: Response) => {
  try {
    const id = validate(conversationIdSchema, req.params.id);
    const user = req.user!;
    if (!assertConversationOwnership(req, res, () => undefined, id)) return;
    await dify.deleteConversation(id, user.dify_user_id);
    markConversationDeleted(user.id, id); // sync local cache with deletion
    res.json({ ok: true });
  } catch (e) { handleRouteError(res, e, req); }
});

/* GET /api/conversations/:id/variables */
conversationsRouter.get('/:id/variables', async (req: AuthedRequest, res: Response) => {
  try {
    const id = validate(conversationIdSchema, req.params.id);
    const user = req.user!;
    if (!assertConversationOwnership(req, res, () => undefined, id)) return;
    const data = await dify.getConversationVariables(id, user.dify_user_id);
    res.json(data);
  } catch (e) { handleRouteError(res, e, req); }
});

/* PUT /api/conversations/:id/variables/:variableId */
conversationsRouter.put('/:id/variables/:variableId', requireCsrf, async (req: AuthedRequest, res: Response) => {
  try {
    const id = validate(conversationIdSchema, req.params.id);
    const user = req.user!;
    if (!assertConversationOwnership(req, res, () => undefined, id)) return;
    const body = validate(variableUpdateSchema, req.body);
    const v = await dify.updateConversationVariable(id, req.params.variableId, user.dify_user_id, body.value);
    res.json({ ok: true, variable: v });
  } catch (e) { handleRouteError(res, e, req); }
});
