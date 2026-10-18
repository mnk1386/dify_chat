/**
 * Single chat message bubble: markdown content, attachments, per-message controls
 * (copy, like/dislike + optional comment, regenerate/retry, suggested questions, TTS).
 * Sources/retriever info rendered ONLY when Dify actually returned them.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { UiMessage } from '../types';
import { MarkdownView, copyText } from './MarkdownView';
import { t, formatTime, toFa } from '../i18n/fa';

interface Props {
  message: UiMessage;
  isStreamingActive: boolean;
  ttsEnabled: boolean;
  onFeedback: (localId: string, rating: 'like' | 'dislike' | null, content?: string) => Promise<void>;
  onRegenerate: (message: UiMessage) => void;
  onGetSuggested: (localId: string) => Promise<string[]>;
  onAskSuggested: (q: string) => void;
  onPlayTts: (message: UiMessage) => Promise<void>;
  onStopTts: () => void;
  ttsPlayingId: string | null;
}

export function MessageBubble({
  message: m, isStreamingActive, ttsEnabled, onFeedback, onRegenerate,
  onGetSuggested, onAskSuggested, onPlayTts, onStopTts, ttsPlayingId,
}: Props) {
  const isUser = m.role === 'user';
  const [copied, setCopied] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState('');
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackNote, setFeedbackNote] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<string[] | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => { if (copyTimer.current) window.clearTimeout(copyTimer.current); }, []);

  const doCopy = useCallback(async () => {
    const ok = await copyText(m.content);
    if (ok) {
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
    }
  }, [m.content]);

  const rate = useCallback(async (rating: 'like' | 'dislike') => {
    if (!m.difyMessageId || feedbackBusy) return;
    setFeedbackBusy(true);
    try {
      if (rating === 'dislike') {
        // dislike → open comment box; submit sends rating+content
        setShowComment((s) => !s);
        setFeedbackBusy(false);
        return;
      }
      await onFeedback(m.localId, m.feedback === 'like' ? null : 'like');
      setFeedbackNote(null);
    } catch (e) {
      setFeedbackNote(e instanceof Error ? e.message : 'ثبت بازخورد ناموفق بود.');
    } finally {
      setFeedbackBusy(false);
    }
  }, [m, feedbackBusy, onFeedback]);

  const submitDislike = useCallback(async () => {
    if (!m.difyMessageId) return;
    setFeedbackBusy(true);
    try {
      await onFeedback(m.localId, 'dislike', comment.trim() || undefined);
      setShowComment(false); setComment('');
      setFeedbackNote(t.chat.feedbackSaved);
      window.setTimeout(() => setFeedbackNote(null), 2000);
    } catch (e) {
      setFeedbackNote(e instanceof Error ? e.message : 'ثبت بازخورد ناموفق بود.');
    } finally {
      setFeedbackBusy(false);
    }
  }, [m, comment, onFeedback]);

  const loadSuggested = useCallback(async () => {
    if (suggested !== null) { setSuggested(null); return; }
    setSuggestBusy(true);
    const list = await onGetSuggested(m.localId);
    setSuggested(list); // empty array → show "no suggestions" quietly
    setSuggestBusy(false);
  }, [m.localId, onGetSuggested, suggested]);

  const streaming = m.status === 'streaming' || m.status === 'sending';

  return (
    <article className={`flex w-full animate-fade-in-up gap-3 ${isUser ? 'flex-row-reverse' : ''}`} aria-label={isUser ? 'پیام شما' : 'پاسخ دستیار'}>
      {/* avatar */}
      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-bold shadow-sm ${isUser ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200' : 'bg-gradient-to-br from-brand-500 to-brand-700 text-white'}`} aria-hidden="true">
        {isUser ? 'شما' : 'AI'}
      </div>

      <div className={`group flex min-w-0 max-w-[min(92%,46rem)] flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`relative rounded-2xl px-4 py-3 shadow-sm ${
          isUser
            ? 'rounded-tr-md bg-brand-600 text-white'
            : m.status === 'error'
              ? 'rounded-tl-md border border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'
              : 'rounded-tl-md border border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
        }`}>
          {/* attachments (user messages) */}
          {m.files && m.files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2" aria-label={t.chat.attachments}>
              {m.files.map((f) => (
                <div key={f.id} className={`max-w-[14rem] rounded-lg border p-1.5 text-xs ${isUser ? 'border-white/30 bg-white/10' : 'border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-700/50'}`}>
                  {f.previewUrl ? (
                    <a href={f.previewUrl} target="_blank" rel="noopener noreferrer nofollow" aria-label={f.name}>
                      <img src={f.previewUrl} alt={f.name} className="max-h-40 rounded-md" />
                    </a>
                  ) : (
                    <span className="flex items-center gap-1"><span aria-hidden="true">📎</span><span dir="ltr" className="truncate">{f.name}</span></span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* content */}
          {isUser ? (
            <p className="whitespace-pre-wrap break-words text-[15px] leading-7">{m.content}</p>
          ) : m.content ? (
            <MarkdownView content={m.content} streaming={streaming} />
          ) : streaming ? (
            <div className="flex items-center gap-2 py-1 text-sm text-slate-500 dark:text-slate-400" role="status">
              <span className="flex gap-1" aria-hidden="true">
                <Dot delay={0} /><Dot delay={150} /><Dot delay={300} />
              </span>
              {m.status === 'sending' ? t.chat.sending : t.chat.thinking}
            </div>
          ) : null}

          {m.status === 'stopped' && <p className="mt-2 text-xs italic text-slate-400">⏹ {t.chat.stopped}</p>}
          {m.status === 'error' && (
            <div className="mt-2 text-xs" role="alert">
              <p>⚠ {t.chat.errorPrefix} {m.errorText || 'خطای نامشخص'}</p>
              {m.retryable && (
                <button type="button" onClick={() => onRegenerate(m)} className="mt-1.5 rounded-md bg-red-100 px-2.5 py-1 font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/50 dark:text-red-300">
                  ↻ {t.chat.retry}
                </button>
              )}
            </div>
          )}

          {/* retriever sources — only if Dify returned them */}
          {!isUser && m.retrieverResources && m.retrieverResources.length > 0 && (
            <details className="mt-3 rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-700/50">
              <summary className="cursor-pointer select-none font-medium text-slate-600 dark:text-slate-300">📚 {t.chat.sources} ({toFa(m.retrieverResources.length)})</summary>
              <ul className="mt-2 space-y-1.5">
                {m.retrieverResources.map((r, i) => (
                  <li key={i} className="text-slate-500 dark:text-slate-400">
                    <span className="font-medium">{r.document_name || `منبع ${toFa(i + 1)}`}</span>
                    {r.dataset_name && <span> — {r.dataset_name}</span>}
                    {typeof r.score === 'number' && <span className="num-ltr ms-1">({(r.score * 100).toFixed(0)}٪)</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {/* meta row: time + status */}
        <div className={`flex items-center gap-2 px-1 text-[11px] text-slate-400 ${isUser ? 'flex-row-reverse' : ''}`}>
          <time dateTime={new Date(m.createdAt).toISOString()}>{formatTime(m.createdAt)}</time>
          {streaming && <span className="text-brand-500">{t.chat.generating}</span>}
        </div>

        {/* assistant controls */}
        {!isUser && !streaming && m.status !== 'error' && (
          <div className="flex flex-wrap items-center gap-0.5 px-1 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <CtrlButton title={copied ? t.chat.copied : t.chat.copy} onClick={doCopy}>{copied ? '✓' : '⧉'}</CtrlButton>
            {m.difyMessageId && (
              <>
                <CtrlButton title={t.chat.like} active={m.feedback === 'like'} onClick={() => rate('like')}>👍</CtrlButton>
                <CtrlButton title={t.chat.dislike} active={m.feedback === 'dislike'} onClick={() => rate('dislike')}>👎</CtrlButton>
                <CtrlButton title={t.chat.regenerate} hint={t.chat.regenerateHint} onClick={() => onRegenerate(m)}>↻</CtrlButton>
                <CtrlButton title={t.chat.suggested} onClick={loadSuggested} busy={suggestBusy}>💡</CtrlButton>
                {ttsEnabled && (
                  <CtrlButton title={ttsPlayingId === m.localId ? t.chat.ttsStop : t.chat.ttsPlay} active={ttsPlayingId === m.localId}
                    onClick={() => (ttsPlayingId === m.localId ? onStopTts() : onPlayTts(m))}>
                    {ttsPlayingId === m.localId ? '⏹' : '🔊'}
                  </CtrlButton>
                )}
              </>
            )}
          </div>
        )}

        {/* dislike comment box */}
        {showComment && (
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <p className="mb-1.5 text-xs font-medium text-slate-500">{t.chat.feedbackTitle}</p>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
              placeholder={t.chat.feedbackPlaceholder} aria-label={t.chat.feedbackPlaceholder}
              className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm outline-none focus:border-brand-400 dark:border-slate-600 dark:bg-slate-900" />
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={submitDislike} disabled={feedbackBusy}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {feedbackBusy ? t.app.loading : t.chat.feedbackSave}
              </button>
              <button type="button" onClick={() => setShowComment(false)}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs dark:bg-slate-700">{t.common.cancel}</button>
            </div>
          </div>
        )}

        {feedbackNote && <p className="px-1 text-[11px] text-emerald-600 dark:text-emerald-400" role="status">{feedbackNote}</p>}

        {/* suggested questions */}
        {suggested !== null && suggested.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {suggested.map((q, i) => (
              <button key={i} type="button" onClick={() => onAskSuggested(q)}
                className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs text-brand-700 transition-colors hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-300 dark:hover:bg-brand-900/50">
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function Dot({ delay }: { delay: number }) {
  return <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-brand-400" style={{ animationDelay: `${delay}ms` }} />;
}

function CtrlButton({ title, hint, onClick, children, active, busy }: {
  title: string; hint?: string; onClick: () => void; children: React.ReactNode; active?: boolean; busy?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} title={hint ? `${title} — ${hint}` : title} aria-label={title} aria-pressed={active} disabled={busy}
      className={`rounded-lg p-1.5 text-sm transition-colors ${active ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700'} ${busy ? 'animate-pulse' : ''}`}>
      {children}
    </button>
  );
}
