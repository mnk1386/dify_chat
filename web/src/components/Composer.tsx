/**
 * Chat composer: textarea (Enter=send, Shift+Enter=newline), attachments,
 * mic recording (only when STT is available), send/stop buttons, status line.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FilePicker } from './FilePicker';
import { chatApi } from '../api/client';
import type { FileUploadLimits, UiFile } from '../types';
import { t } from '../i18n/fa';

interface Props {
  disabled: boolean;
  streaming: boolean;
  limits: FileUploadLimits | null;
  sttAvailable: boolean;
  files: UiFile[];
  onFilesChange: (f: UiFile[]) => void;
  onSend: (text: string, files: UiFile[]) => void;
  onStop: () => void;
  draft: string;
  onDraftChange: (v: string) => void;
}

const MAX_LEN = 30000;

export function Composer({
  disabled, streaming, limits, sttAvailable, files, onFilesChange,
  onSend, onStop, draft, onDraftChange,
}: Props) {
  const text = draft;
  const setText = onDraftChange;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const mediaRef = useRef<{ rec: MediaRecorder; stream: MediaStream } | null>(null);

  // auto-grow textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [text]);

  const uploading = files.some((f) => f.uploading);
  const hasInvalid = files.some((f) => Boolean(f.error));
  const canSend = !disabled && !streaming && !uploading &&
    (text.trim().length > 0 || files.some((f) => Boolean(f.difyId))) && !hasInvalid;

  const submit = useCallback(() => {
    if (!canSend) return;
    onSend(text, files.filter((f) => f.difyId));
    setText('');
  }, [canSend, onSend, text, files, setText]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline; IME composition respected.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  /* ---------- microphone (STT) ---------- */
  const startRecording = async () => {
    setMicError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMicError(t.chat.micUnsupported);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (ev) => { if (ev.data.size > 0) chunks.push(ev.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(chunks, { type: mime });
        setRecording(false);
        if (blob.size < 1000) return; // clip too short — ignore silently
        setTranscribing(true);
        try {
          const out = await chatApi.audioToText(blob);
          const spoken = (out.text || '').trim();
          if (spoken) setText((prev) => (prev ? `${prev} ${spoken}` : spoken));
          taRef.current?.focus();
        } catch (e) {
          setMicError(e instanceof Error ? e.message : t.chat.sttUnavailable);
        } finally {
          setTranscribing(false);
        }
      };
      mediaRef.current = { rec, stream };
      rec.start();
      setRecording(true);
    } catch {
      setMicError(t.chat.micDenied);
      setRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRef.current?.rec.state === 'recording') mediaRef.current.rec.stop();
    mediaRef.current = null;
  };

  useEffect(() => () => {
    if (mediaRef.current?.rec.state === 'recording') mediaRef.current.rec.stop();
  }, []);

  return (
    <div className="border-t border-slate-200 bg-white/80 px-3 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80 no-print">
      <div className="mx-auto max-w-4xl space-y-2">
        {/* Attachment area stays mounted so the 📎 control and drag-drop always work */}
        <div className={files.length === 0 ? '[&>*:last-child]:mb-0' : ''}>
          <FilePicker files={files} onChange={onFilesChange} limits={limits} disabled={disabled || streaming} />
        </div>

        {micError && (
          <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" role="alert">
            🎤 {micError}
            <button type="button" onClick={() => setMicError(null)} className="ms-2 underline">پنهان‌سازی</button>
          </p>
        )}
        {transcribing && <p className="px-1 text-xs text-brand-600 dark:text-brand-300" role="status">🎙 {t.chat.transcribing}</p>}

        <div className="flex items-end gap-2 rounded-2xl border border-slate-300 bg-white p-2 shadow-sm transition-colors focus-within:border-brand-400 dark:border-slate-700 dark:bg-slate-800">
          {sttAvailable && (
            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              disabled={disabled || streaming || transcribing}
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors disabled:opacity-40 ${recording ? 'animate-pulse bg-red-500 text-white hover:bg-red-600' : 'text-slate-400 hover:bg-slate-100 hover:text-brand-500 dark:hover:bg-slate-700'}`}
              title={recording ? t.chat.micStop : t.chat.micStart}
              aria-label={recording ? t.chat.micStop : t.chat.micStart}
              aria-pressed={recording}
            >🎤</button>
          )}

          <textarea
            ref={taRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
            onKeyDown={onKeyDown}
            placeholder={t.chat.placeholder}
            aria-label={t.chat.placeholder}
            disabled={disabled}
            className="max-h-[200px] min-h-[38px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-7 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
          />

          {streaming ? (
            <button type="button" onClick={onStop}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-500 text-white shadow-sm transition-colors hover:bg-red-600"
              title={t.chat.stop} aria-label={t.chat.stop}>⏹</button>
          ) : (
            <button type="button" onClick={submit} disabled={!canSend}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white shadow-sm transition-all hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
              title={t.chat.send} aria-label={t.chat.send}>➤</button>
          )}
        </div>

        <div className="flex items-center justify-between px-2 text-[11px] text-slate-400">
          <span>
            {uploading ? `⏳ ${t.files.uploading}` : streaming ? `✳ ${t.chat.generating}` : disabled ? t.chat.connectionDown : ''}
            {hasInvalid && <span className="ms-2 text-red-500">⚠ ابتدا فایل نامعتبر را حذف کنید.</span>}
          </span>
          {text.length > MAX_LEN - 2000 && <span>{text.length.toLocaleString('fa-IR')} / ۳۰٬۰۰۰</span>}
        </div>
      </div>
    </div>
  );
}
