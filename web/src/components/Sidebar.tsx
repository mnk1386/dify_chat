/**
 * Sidebar: conversation history with search, pagination (load more), rename, delete
 * (with confirmation), collapse/expand, grouping by recency. RTL layout throughout.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationsState } from '../hooks/useConversations';
import { t, relativeTimeFa } from '../i18n/fa';

interface Props {
  convos: ConversationsState;
  activeId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpen: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
}

export function Sidebar({ convos, activeId, collapsed, onToggleCollapse, onOpen, onNewChat, onDelete, onRename }: Props) {
  const [search, setSearch] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => { convos.load(''); /* initial load */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2500);
  }, []);

  const onSearchChange = (v: string) => {
    setSearch(v);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => { convos.load(v.trim()); }, 350);
  };

  const doDelete = async (id: string) => {
    try {
      await onDelete(id);
      showToast(t.sidebar.deleted);
    } catch {
      showToast(t.sidebar.loadError);
    }
    setConfirmingId(null);
  };

  const submitRename = async (id: string) => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name) return;
    try {
      await onRename(id, name);
      showToast(t.sidebar.renamed);
    } catch {
      showToast(t.sidebar.loadError);
    }
  };

  if (collapsed) {
    return (
      <div className="flex h-full w-14 flex-col items-center gap-2 border-e border-slate-200 bg-white py-3 dark:border-slate-800 dark:bg-slate-900 no-print">
        <button type="button" onClick={onToggleCollapse} title={t.sidebar.expand} aria-label={t.sidebar.expand}
          className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800">⇄</button>
        <button type="button" onClick={onNewChat} title={t.chat.newChat} aria-label={t.chat.newChat}
          className="rounded-lg bg-brand-600 p-2 text-white hover:bg-brand-700">＋</button>
        <div className="mt-2 flex flex-col gap-1 overflow-y-auto nice-scroll">
          {convos.items.slice(0, 12).map((c) => (
            <button key={c.id} type="button" title={c.name} onClick={() => onOpen(c.id)}
              className={`h-2.5 w-2.5 rounded-full ${activeId === c.id ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-600 hover:bg-brand-300'}`}
              aria-label={c.name} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-e border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 no-print" aria-label={t.sidebar.history}>
      <div className="flex items-center justify-between gap-2 p-3 pb-2">
        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">{t.sidebar.history}</h2>
        <button type="button" onClick={onToggleCollapse} title={t.sidebar.collapse} aria-label={t.sidebar.collapse}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">⇄</button>
      </div>

      <div className="px-3 pb-2">
        <button type="button" onClick={onNewChat}
          className="w-full rounded-xl bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-brand-500">
          ＋ {t.chat.newChat}
        </button>
      </div>

      <div className="px-3 pb-2">
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t.sidebar.search}
          aria-label={t.sidebar.search}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-brand-400 dark:border-slate-700 dark:bg-slate-800"
        />
        {convos.mode && <p className="mt-1 text-[11px] text-slate-400">{t.sidebar.searchLocalNote}</p>}
      </div>

      <nav className="flex-1 overflow-y-auto nice-scroll px-2 pb-2" aria-live="polite">
        {convos.loading && <ListSkeleton />}
        {!convos.loading && convos.error && (
          <div className="m-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
            {convos.error}
            <button type="button" onClick={() => convos.load(search.trim())} className="mt-2 block rounded-md bg-red-100 px-2 py-1 font-medium hover:bg-red-200 dark:bg-red-900/50">{t.chat.retry}</button>
          </div>
        )}
        {!convos.loading && !convos.error && convos.items.length === 0 && (
          <p className="p-4 text-center text-sm text-slate-400">{t.sidebar.empty}</p>
        )}
        <ul className="space-y-0.5">
          {convos.items.map((c) => (
            <li key={c.id}>
              {renamingId === c.id ? (
                <form className="p-1" onSubmit={(e) => { e.preventDefault(); submitRename(c.id); }}>
                  <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                    aria-label={t.sidebar.rename}
                    onKeyDown={(e) => { if (e.key === 'Escape') setRenamingId(null); }}
                    className="w-full rounded-md border border-brand-400 bg-white px-2 py-1.5 text-sm dark:bg-slate-800" />
                  <div className="mt-1 flex gap-1">
                    <button type="submit" className="rounded-md bg-brand-600 px-2 py-1 text-xs text-white">{t.common.confirm}</button>
                    <button type="button" onClick={() => setRenamingId(null)} className="rounded-md bg-slate-200 px-2 py-1 text-xs dark:bg-slate-700">{t.common.cancel}</button>
                  </div>
                </form>
              ) : confirmingId === c.id ? (
                <div className="m-1 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-700 dark:bg-amber-950/40">
                  <p className="text-amber-800 dark:text-amber-200">{t.sidebar.deleteConfirm}</p>
                  <div className="mt-2 flex gap-1">
                    <button type="button" onClick={() => doDelete(c.id)} className="rounded-md bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700">{t.sidebar.delete}</button>
                    <button type="button" onClick={() => setConfirmingId(null)} className="rounded-md bg-slate-200 px-2 py-1 dark:bg-slate-700">{t.common.cancel}</button>
                  </div>
                </div>
              ) : (
                <div className={`group relative ${activeId === c.id ? 'bg-brand-50 dark:bg-brand-900/30' : ''} rounded-lg`}>
                  <button type="button" onClick={() => onOpen(c.id)}
                    className="block w-full rounded-lg px-3 py-2.5 text-start hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <span className={`block truncate text-sm ${activeId === c.id ? 'font-semibold text-brand-700 dark:text-brand-300' : 'text-slate-700 dark:text-slate-200'}`}>{c.name || 'گفت‌وگو'}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-400">{relativeTimeFa(c.created_at)}</span>
                  </button>
                  <div className="absolute left-1.5 top-1/2 -translate-y-1/2 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <button type="button" title={t.sidebar.rename} aria-label={t.sidebar.rename}
                      onClick={() => { setRenamingId(c.id); setRenameValue(c.name); }}
                      className="rounded-md p-1 text-xs text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700">✎</button>
                    <button type="button" title={t.sidebar.delete} aria-label={t.sidebar.delete}
                      onClick={() => setConfirmingId(c.id)}
                      className="rounded-md p-1 text-xs text-slate-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/40">🗑</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
        {!convos.loading && convos.items.length > 0 && (
          <div className="p-2 text-center">
            <button type="button" onClick={() => convos.loadMore()} disabled={convos.loadingMore || !convos.items.length}
              className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800">
              {convos.loadingMore ? t.app.loading : t.sidebar.loadMore}
            </button>
          </div>
        )}
      </nav>

      {toast && (
        <div className="pointer-events-none absolute bottom-20 right-1/2 z-30 translate-x-1/2 rounded-lg bg-slate-800 px-4 py-2 text-xs text-white shadow-lg dark:bg-slate-700" role="status">
          {toast}
        </div>
      )}
    </aside>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2 p-2" aria-hidden="true">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" style={{ animationDelay: `${i * 90}ms` }} />
      ))}
    </div>
  );
}
