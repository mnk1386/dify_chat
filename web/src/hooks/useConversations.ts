/**
 * Conversation list management: load (with pagination), search (local index on backend),
 * open a conversation (loads messages from Dify via backend proxy), rename, delete.
 * Sorted by last activity (Dify returns newest-first; local fallback also sorted).
 */

import { useCallback, useRef, useState } from 'react';
import { ApiError, conversationsApi } from '../api/client';
import type { ConversationSummary, DifyMessageRecord, UiMessage } from '../types';

export interface ConversationsState {
  items: ConversationSummary[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  mode: string | null; // set when served from local index (search/fallback)
  load: (q?: string) => Promise<void>;
  loadMore: () => Promise<void>;
  openConversation: (id: string) => Promise<UiMessage[]>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  removeLocal: (id: string) => void;
}

function recordsToMessages(records: DifyMessageRecord[]): UiMessage[] {
  // Dify returns newest-first; reverse to chronological order for the UI.
  const ordered = [...records].reverse();
  const out: UiMessage[] = [];
  for (const r of ordered) {
    if (r.query) {
      out.push({
        localId: `${r.id}-q`, role: 'user', content: r.query, query: r.query,
        status: 'done', createdAt: (r.created_at || 0) * 1000, difyMessageId: r.id,
      });
    }
    if (r.answer) {
      out.push({
        localId: r.id, role: 'assistant', content: r.answer, status: 'done',
        createdAt: (r.created_at || 0) * 1000, difyMessageId: r.id,
        query: r.query || undefined,
        feedback: r.feedback?.rating || null,
        retrieverResources: Array.isArray(r.retriever_resources) ? r.retriever_resources : undefined,
      });
    }
  }
  return out;
}

export function useConversations(): ConversationsState {
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const lastIdRef = useRef<string | undefined>(undefined);
  const hasMoreRef = useRef(false);
  const queryRef = useRef('');

  const load = useCallback(async (q = '') => {
    setLoading(true);
    setError(null);
    queryRef.current = q;
    lastIdRef.current = undefined;
    try {
      const res = await conversationsApi.list({ limit: 20, q: q || undefined });
      setItems(res.data || []);
      hasMoreRef.current = Boolean(res.has_more) && !res.mode;
      setMode(res.mode || null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'خطای نامشخص در بارگذاری تاریخچه.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!hasMoreRef.current || loadingMore) return;
    setLoadingMore(true);
    try {
      const last = items[items.length - 1];
      const res = await conversationsApi.list({ limit: 20, lastId: last?.id, q: queryRef.current || undefined });
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...(res.data || []).filter((c) => !seen.has(c.id))];
      });
      hasMoreRef.current = Boolean(res.has_more);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'خطا در بارگذاری ادامه تاریخچه.');
    } finally {
      setLoadingMore(false);
    }
  }, [items, loadingMore]);

  const openConversation = useCallback(async (id: string): Promise<UiMessage[]> => {
    const res = await conversationsApi.messages(id, { limit: 100 });
    return recordsToMessages(res.data || []);
  }, []);

  const rename = useCallback(async (id: string, name: string) => {
    await conversationsApi.rename(id, name);
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
  }, []);

  const remove = useCallback(async (id: string) => {
    await conversationsApi.remove(id);
    setItems((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const removeLocal = useCallback((id: string) => {
    setItems((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return { items, loading, loadingMore, error, mode, load, loadMore, openConversation, rename, remove, removeLocal };
}
