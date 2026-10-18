/**
 * Chat page: header + sidebar + message list + composer.
 * - Auto-scroll to bottom on new content unless user scrolled up (with "scroll to end" button).
 * - Connection status polling with exponential backoff when disconnected.
 * - Opening statements & suggested questions from Dify /parameters (via backend).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { MessageBubble } from '../components/MessageBubble';
import { Composer } from '../components/Composer';
import { useChat } from '../hooks/useChat';
import { useConversations } from '../hooks/useConversations';
import { useAuth } from '../hooks/useAuth';
import { appApi, ApiError } from '../api/client';
import type { AppParameters, AppStatus, UiFile, UiMessage } from '../types';
import { t } from '../i18n/fa';
import type { Theme } from '../hooks/useTheme';

interface Props {
  status: AppStatus | null;
  statusLoading: boolean;
  onRecheckStatus: () => void;
  theme: Theme;
  onCycleTheme: () => void;
  parameters: AppParameters | null;
  onOpenAdmin: () => void;
}

export function ChatPage({ status, statusLoading, onRecheckStatus, theme, onCycleTheme, parameters, onOpenAdmin }: Props) {
  const { user, logout } = useAuth();
  const convos = useConversations();
  const [activeConvId, setActiveConvId] = useState<string | null>(null);

  const handleConvChanged = useCallback((convId: string | null) => {
    if (convId) {
      setActiveConvId(convId);
      convos.load(''); // refresh history so the new conversation appears
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chat = useChat(handleConvChanged);
  const [files, setFiles] = useState<UiFile[]>([]);
  const [draft, setDraft] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  /* ---------- auto scroll ---------- */
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
    setShowScrollBtn(distanceFromBottom > 240);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    stickToBottomRef.current = true;
    setShowScrollBtn(false);
  }, []);

  // follow streaming output only while user is at bottom
  const lastContentLen = chat.messages.length
    ? chat.messages.reduce((n, m) => n + m.content.length, 0) : 0;
  useEffect(() => {
    if (stickToBottomRef.current) scrollToBottom(false);
  }, [lastContentLen, chat.messages.length, scrollToBottom]);

  /* ---------- TTS player (single audio element) ---------- */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [ttsPlayingId, setTtsPlayingId] = useState<string | null>(null);
  const [ttsNote, setTtsNote] = useState<string | null>(null);

  const playTts = useCallback(async (m: UiMessage) => {
    stopTts();
    setTtsNote(t.chat.ttsLoading);
    try {
      const url = await appApiTts(m);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); setTtsPlayingId(null); };
      setTtsPlayingId(m.localId);
      await audio.play();
    } catch (e) {
      setTtsNote(e instanceof ApiError ? e.message : t.chat.ttsUnavailable);
      window.setTimeout(() => setTtsNote(null), 3000);
    } finally {
      window.setTimeout(() => setTtsNote((n) => (n === t.chat.ttsLoading ? null : n)), 1500);
    }
    async function appApiTts(msg: UiMessage) {
      const { chatApi } = await import('../api/client');
      return chatApi.textToAudioUrl(msg.content, msg.difyMessageId);
    }
  }, []);

  const stopTts = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setTtsPlayingId(null);
  }, []);

  useEffect(() => () => { stopTts(); }, [stopTts]);

  /* ---------- actions ---------- */
  const newChat = useCallback(() => {
    stopTts();
    chat.reset(null, []);
    setActiveConvId(null);
    setFiles([]);
    setDraft('');
    setHistoryError(null);
  }, [chat, stopTts]);

  const openConversation = useCallback(async (id: string) => {
    if (chat.isStreaming) await chat.stop();
    stopTts();
    setHistoryError(null);
    try {
      const history = await convos.openConversation(id);
      chat.reset(id, history);
      setActiveConvId(id);
      requestAnimationFrame(() => scrollToBottom(false));
    } catch (e) {
      setHistoryError(e instanceof ApiError ? e.message : t.sidebar.loadError);
    }
  }, [chat, convos, scrollToBottom, stopTts]);

  const onDelete = useCallback(async (id: string) => {
    await convos.remove(id);
    if (activeConvId === id) newChat();
  }, [convos, activeConvId, newChat]);

  const onSend = useCallback((text: string, sentFiles: UiFile[]) => {
    chat.send(text, sentFiles);
    setFiles([]);
    stickToBottomRef.current = true;
  }, [chat]);

  const onRegenerate = useCallback((m: UiMessage) => {
    const target = m.role === 'assistant'
      ? chat.messages.find((x) => x.role === 'user' && x.query === m.query) || m
      : m;
    chat.resend(target);
    stickToBottomRef.current = true;
  }, [chat]);

  const sttAvailable = Boolean(parameters?.file_upload?.enabled) && typeof navigator !== 'undefined' && !!navigator.mediaDevices;
  const composerDisabled = !status || !status.connected;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header
        status={status} statusLoading={statusLoading} onRecheck={onRecheckStatus}
        theme={theme} onCycleTheme={onCycleTheme}
        user={user!} onLogout={logout} onOpenAdmin={onOpenAdmin}
      />

      <div className="relative flex min-h-0 flex-1">
        <Sidebar
          convos={convos} activeId={activeConvId} collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          onOpen={openConversation} onNewChat={newChat}
          onDelete={onDelete} onRename={convos.rename}
        />

        <main className="flex min-w-0 flex-1 flex-col bg-slate-100 dark:bg-slate-950" aria-label={t.nav.chat}>
          {/* offline banner */}
          {status && !status.connected && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 no-print" role="alert">
              {status.configured
                ? <>📡 {t.chat.connectionDown} — {status.error || ''} <button type="button" onClick={onRecheckStatus} className="mx-1 rounded-md bg-amber-100 px-2 py-0.5 font-medium underline dark:bg-amber-900/50">{t.chat.retry}</button></>
                : <>⚠️ {t.chat.notConfigured}</>}
            </div>
          )}
          {historyError && (
            <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-center text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
              {historyError} <button type="button" onClick={() => activeConvId && openConversation(activeConvId)} className="underline">{t.chat.retry}</button>
            </div>
          )}
          {ttsNote && <p className="px-4 pt-2 text-center text-[11px] text-slate-500" role="status">{ttsNote}</p>}

          {/* messages */}
          <div ref={scrollRef} onScroll={onScroll} className="nice-scroll flex-1 overflow-y-auto" tabIndex={0} aria-label="پیام‌ها">
            <div className="mx-auto flex max-w-4xl flex-col gap-5 px-3 py-6 sm:px-6">
              {chat.messages.length === 0 && (
                <EmptyState
                  openingStatement={parameters?.opening_statement || ''}
                  suggestions={(parameters?.suggested_questions || []).slice(0, 6)}
                  onAsk={(q) => { setDraft(q); }}
                  onSendNow={(q) => { onSend(q, []); }}
                />
              )}
              {chat.messages.map((m) => (
                <MessageBubble
                  key={m.localId}
                  message={m}
                  isStreamingActive={chat.activeLocalId === m.localId}
                  ttsEnabled={Boolean(parameters?.tts_available)}
                  onFeedback={chat.setFeedback}
                  onRegenerate={onRegenerate}
                  onGetSuggested={chat.getSuggested}
                  onAskSuggested={(q) => onSend(q, [])}
                  onPlayTts={playTts}
                  onStopTts={stopTts}
                  ttsPlayingId={ttsPlayingId}
                />
              ))}
              <div className="h-2" />
            </div>
          </div>

          {/* scroll-to-end floating button */}
          {showScrollBtn && (
            <button type="button" onClick={() => scrollToBottom()}
              className="absolute bottom-28 left-1/2 z-20 grid h-10 w-10 -translate-x-1/2 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-lg transition-colors hover:text-brand-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              title={t.chat.scrollToEnd} aria-label={t.chat.scrollToEnd}>
              ↓
            </button>
          )}

          <Composer
            disabled={composerDisabled}
            streaming={chat.isStreaming}
            limits={parameters?.file_upload || null}
            sttAvailable={sttAvailable}
            files={files}
            onFilesChange={setFiles}
            onSend={onSend}
            onStop={chat.stop}
            draft={draft}
            onDraftChange={setDraft}
          />
        </main>
      </div>
    </div>
  );
}

/* ---------- empty state with opening statement & suggestions ---------- */
function EmptyState({ openingStatement, suggestions, onAsk, onSendNow }: {
  openingStatement: string; suggestions: string[]; onAsk: (q: string) => void; onSendNow: (q: string) => void;
}) {
  return (
    <section className="flex flex-col items-center gap-4 py-10 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-brand-500 to-brand-700 text-3xl text-white shadow-lg" aria-hidden="true">✨</span>
      <div>
        <h2 className="text-lg font-bold">{t.chat.emptyTitle}</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{openingStatement || t.chat.emptyHint}</p>
      </div>
      {suggestions.length > 0 && (
        <div className="w-full max-w-xl">
          <p className="mb-2 text-xs font-medium text-slate-400">{t.chat.suggested}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {suggestions.map((q, i) => (
              <button key={i} type="button" onClick={() => onSendNow(q)} onFocus={() => onAsk(q)}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-brand-900/30">
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
