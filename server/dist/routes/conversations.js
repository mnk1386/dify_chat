"use strict";
/**
 * Conversation management routes.
 * Dify is the source of truth; backend proxies official endpoints and keeps a local index
 * (names, timestamps) which powers search + pagination fallbacks.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.conversationsRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const validation_1 = require("../utils/validation");
const dify = __importStar(require("../dify/client"));
const db_1 = require("../db");
const ownership_1 = require("../middleware/ownership");
const errors_helper_1 = require("./errors-helper");
exports.conversationsRouter = (0, express_1.Router)();
/* GET /api/conversations?lastId=&limit=&q=  */
exports.conversationsRouter.get('/', async (req, res) => {
    try {
        const user = req.user;
        const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        const limit = Math.min(Math.max(parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);
        const lastId = typeof req.query.lastId === 'string' ? req.query.lastId : undefined;
        // Local search path: Dify's app API has no conversation-search endpoint —
        // we search our own index (titles + message previews). Clearly documented, not fake.
        if (q) {
            const rows = (0, db_1.searchConversationIndex)(user.id, q, limit);
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
            (0, db_1.upsertConversationIndex)({ userId: user.id, difyConversationId: c.id, name: c.name, lastActivityAt: c.created_at });
        }
        res.json(result);
    }
    catch (e) {
        // Fallback to local index when Dify is unreachable so history remains browsable.
        const user = req.user;
        const rows = (0, db_1.listConversationIndex)(user.id);
        (0, db_1.logEvent)({ level: 'warn', type: 'conversations_fallback_local', userId: user.id, detail: String(e.message).slice(0, 200) });
        res.json({ mode: 'local_index_fallback', data: rows.map(r => ({ id: r.dify_conversation_id, name: r.name, created_at: r.last_activity_at })), has_more: false });
    }
});
/* GET /api/conversations/:id/messages?firstId=&limit= */
exports.conversationsRouter.get('/:id/messages', async (req, res) => {
    try {
        const id = (0, validation_1.validate)(validation_1.conversationIdSchema, req.params.id);
        const user = req.user;
        if (!(0, ownership_1.assertConversationOwnership)(req, res, () => undefined, id))
            return;
        const firstId = typeof req.query.firstId === 'string' ? req.query.firstId : undefined;
        const limit = Math.min(Math.max(parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);
        const result = await dify.getMessages(id, user.dify_user_id, firstId, limit);
        // cache previews for search
        for (const m of result.data) {
            if (m.answer) {
                try {
                    require('../db').cacheMessagePreview({ userId: user.id, difyConversationId: id, difyMessageId: m.id, role: 'assistant', content: m.answer });
                    if (m.query)
                        require('../db').cacheMessagePreview({ userId: user.id, difyConversationId: id, difyMessageId: m.id + '-q', role: 'user', content: m.query });
                }
                catch { /* non-critical */ }
            }
        }
        res.json(result);
    }
    catch (e) {
        (0, errors_helper_1.handleRouteError)(res, e, req);
    }
});
/* POST /api/conversations/:id/rename */
exports.conversationsRouter.post('/:id/rename', auth_1.requireCsrf, async (req, res) => {
    try {
        const id = (0, validation_1.validate)(validation_1.conversationIdSchema, req.params.id);
        const body = (0, validation_1.validate)(validation_1.renameSchema, req.body);
        const user = req.user;
        if (!(0, ownership_1.assertConversationOwnership)(req, res, () => undefined, id))
            return;
        const conv = await dify.renameConversation(id, user.dify_user_id, body.name);
        (0, db_1.renameConversationIndex)(user.id, id, body.name);
        res.json({ ok: true, conversation: conv });
    }
    catch (e) {
        (0, errors_helper_1.handleRouteError)(res, e, req);
    }
});
/* DELETE /api/conversations/:id */
exports.conversationsRouter.delete('/:id', auth_1.requireCsrf, async (req, res) => {
    try {
        const id = (0, validation_1.validate)(validation_1.conversationIdSchema, req.params.id);
        const user = req.user;
        if (!(0, ownership_1.assertConversationOwnership)(req, res, () => undefined, id))
            return;
        await dify.deleteConversation(id, user.dify_user_id);
        (0, db_1.markConversationDeleted)(user.id, id); // sync local cache with deletion
        res.json({ ok: true });
    }
    catch (e) {
        (0, errors_helper_1.handleRouteError)(res, e, req);
    }
});
/* GET /api/conversations/:id/variables */
exports.conversationsRouter.get('/:id/variables', async (req, res) => {
    try {
        const id = (0, validation_1.validate)(validation_1.conversationIdSchema, req.params.id);
        const user = req.user;
        if (!(0, ownership_1.assertConversationOwnership)(req, res, () => undefined, id))
            return;
        const data = await dify.getConversationVariables(id, user.dify_user_id);
        res.json(data);
    }
    catch (e) {
        (0, errors_helper_1.handleRouteError)(res, e, req);
    }
});
/* PUT /api/conversations/:id/variables/:variableId */
exports.conversationsRouter.put('/:id/variables/:variableId', auth_1.requireCsrf, async (req, res) => {
    try {
        const id = (0, validation_1.validate)(validation_1.conversationIdSchema, req.params.id);
        const user = req.user;
        if (!(0, ownership_1.assertConversationOwnership)(req, res, () => undefined, id))
            return;
        const body = (0, validation_1.validate)(validation_1.variableUpdateSchema, req.body);
        const v = await dify.updateConversationVariable(id, req.params.variableId, user.dify_user_id, body.value);
        res.json({ ok: true, variable: v });
    }
    catch (e) {
        (0, errors_helper_1.handleRouteError)(res, e, req);
    }
});
//# sourceMappingURL=conversations.js.map