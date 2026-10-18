/**
 * useChat — the heart of the frontend.
 * Owns: message list, streaming state machine, conversation id, stop task id,
 * error recovery (keeps original query), duplicate-send prevention (clientMsgId +
 * in-flight lock), auto-scroll with user override, suggested questions, feedback.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, chatApi, streamSend } from '../api/client';
import type { StreamFrame, UiFile, UiMessage } from '../types';
import { frameAs } from '../types';

let seq = 0;
const uid = () => `m${Date.now().toString(36)}_${(seq++).toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export interface ChatState {
  messages: UiMessage[];
  conversationId: string | null;
  isStreaming: boolean;
  activeLocalId: string | null;
  send: (text: string, files?: UiFile[]) => Promise<void>;
  resend: (message: UiMessage) => Promise<void>;
  stop: () => Promise<void>;
  reset: (conversationId?: string | null, history?: UiMessage[]) => void;
  setFeedback: (localId: string, rating: 'like' | 'dislike' | null, content?: string) => Promise<void>;
  getSuggested: (localId: string) => Promise<string[]>;
}

export function useChat(onConversationChanged?: (convId: string | null) => void): ChatState {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeLocalId, setActiveLocalId] = useState<string | null>(null);

  const convRef = useRef<string | null>(null);
  const taskIdRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const inflightRef = useRef(false); // hard lock against double sends
  const stoppedByUserRef = useRef(false);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const patch = useCallback((localId: string, p: Partial<UiMessage>) => {
    setMessages((ms) => ms.map((m) => (m.localId === localId ? { ...m, ...p } : m)));
  }, []);

  const finalizeActive = useCallback((localId: string, status: UiMessage['status'], errorText?: string, retryable?: boolean) => {
    patch(localId, { status, ...(errorText ? { errorText } : {}), ...(retryable !== undefined ? { retryable } : {}) });
    setIsStreaming(false);
    setActiveLocalId(null);
    inflightRef.current = false;
  }, [patch]);

  const handleFrame = useCallback((localId: string, frame: StreamFrame) => {
    const ev = String(frame.event || '');
    const delta = ev === 'delta' ? frameAs(frame, 'delta') : null;
    const end = ev === 'end' ? frameAs(frame, 'end') : null;
    const mfile = ev === 'message_file' ? frameAs(frame, 'message_file') : null;
    const serr = ev === 'error' ? frameAs(frame, 'error') : null;
    const aerr = ev === 'app_error' ? frameAs(frame, 'app_error') : null;

    if (delta) {
      const answer = String(delta.answer || '');
      if (!answer) return;
      setMessages((ms) => ms.map((m) => (m.localId === localId ? { ...m, content: m.content + answer, status: 'streaming', difyMessageId: delta.message_id || m.difyMessageId } : m)));
      if (delta.task_id) taskIdRef.current = String(delta.task_id);
      if (delta.conversation_id && !convRef.current) { convRef.current = String(delta.conversation_id); setConversationId(String(delta.conversation_id)); onConversationChanged?.(convRef.current); }
    } else if (end) {
      if (end.conversation_id && !convRef.current) { convRef.current = String(end.conversation_id); setConversationId(convRef.current); onConversationChanged?.(convRef.current); }
      setMessages((ms) => ms.map((m) => (m.localId === localId
        ? {
            ...m,
            difyMessageId: end.message_id || m.difyMessageId,
            usage: end.usage || m.usage,
            retrieverResources: end.retriever_resources || m.retrieverResources,
          }
        : m)));
    } else if (mfile) {
      const url = mfile.url;
      const type = String(mfile.type || 'data');
      if (url) {
        setMessages((ms) => ms.map((m) => (m.localId === localId
          ? { ...m, files: [...(m.files || []), { id: uid(), name: 'فایل پیوست پاسخ', size: 0, mime: type, fileType: 'custom', uploading: false, progress: 100, previewUrl: type.startsWith('image/') ? url : undefined }] }
          : m)));
      }
    } else if (serr) {
      // Dify-level error event inside the stream
      patch(localId, { status: 'error', errorText: String(serr.message || 'خطا در پردازش پاسخ.'), retryable: true });
      setIsStreaming(false); setActiveLocalId(null); inflightRef.current = false;
    } else if (aerr) {
      patch(localId, { status: 'error', errorText: String(aerr.message || 'خطای سرویس.'), retryable: Boolean(aerr.retryable) });
      setIsStreaming(false); setActiveLocalId(null); inflightRef.current = false;
    }
    // stream_end / workflow_* events: no direct UI text effect (progress shown via indicator)
  }, [onConversationChanged, patch]);

  const runSend = useCallback(async (query: string, files: UiFile[], existingUserLocalId?: string) => {
    if (inflightRef.current) return; // prevent accidental multiple submissions
    const readyFiles = files.filter((f) => f.difyId && !f.error);
    if (files.some((f) => f.uploading)) return; // wait for uploads

    inflightRef.current = true;
    stoppedByUserRef.current = false;
    taskIdRef.current = undefined;

    const userMsg: UiMessage = {
      localId: existingUserLocalId || uid(), role: 'user', content: query, query,
      status: 'done', createdAt: Date.now(), files: files.length ? files : undefined,
    };
    const assistantLocalId = uid();
    const assistantMsg: UiMessage = {
      localId: assistantLocalId, role: 'assistant', content: '', status: 'sending',
      createdAt: Date.now(), query,
    };

    setMessages((ms) => (existingUserLocalId
      ? [...ms.filter((m) => m.localId !== existingUserLocalId), userMsg, assistantMsg]
      : [...ms, userMsg, assistantMsg]));
    setIsStreaming(true);
    setActiveLocalId(assistantLocalId);

    const controller = new AbortController();
    abortRef.current = controller;

    await streamSend(
      {
        query,
        conversationId: convRef.current,
        clientMsgId: assistantLocalId, // idempotency key
        files: readyFiles.length ? readyFiles.map((f) => ({ type: f.fileType, transfer_method: 'local_file', upload_file_id: f.difyId })) : undefined,
      },
      {
        signal: controller.signal,
        onFrame: (fr) => handleFrame(assistantLocalId, fr as unknown as StreamFrame),
        onNetworkError: (err) => {
          patch(assistantLocalId, { status: 'error', errorText: err.message, retryable: true });
          setIsStreaming(false); setActiveLocalId(null); inflightRef.current = false;
        },
      },
    );

    // Stream finished (or aborted). Recover state consistently.
    if (controller.signal.aborted) {
      if (stoppedByUserRef.current) {
        setMessages((ms) => ms.map((m) => (m.localId === assistantLocalId && m.status !== 'error' ? { ...m, status: 'stopped', errorText: undefined } : m)));
      } else {
        patch(assistantLocalId, { status: 'error', errorText: 'ارتباط قطع شد.', retryable: true });
      }
    } else {
      setMessages((ms) => ms.map((m) => (m.localId === assistantLocalId ? (m.status === 'error' ? m : { ...m, status: 'done' }) : m)));
    }
    setIsStreaming(false);
    setActiveLocalId(null);
    inflightRef.current = false;
  }, [handleFrame, patch]);

  const send = useCallback(async (text: string, files: UiFile[] = []) => {
    const trimmed = text.trim();
    if (!trimmed && files.length === 0) return;
    await runSend(trimmed, files);
  }, [runSend]);

  const resend = useCallback(async (message: UiMessage) => {
    // Regenerate: Dify has no direct regenerate endpoint → re-send the stored query
    // as a NEW request in the same conversation (documented behavior to the user).
    if (!message.query) return;
    await runSend(message.query, message.files || [], message.role === 'user' ? message.localId : undefined);
  }, [runSend]);

  const stop = useCallback(async () => {
    stoppedByUserRef.current = true;
    const taskId = taskIdRef.current;
    abortRef.current?.abort();
    if (taskId) {
      try { await chatApi.stop(taskId); } catch { /* best-effort: relay already aborted */ }
    }
  }, []);

  const reset = useCallback((newConvId: string | null = null, history: UiMessage[] = []) => {
    abortRef.current?.abort();
    convRef.current = newConvId;
    setConversationId(newConvId);
    setMessages(history);
    setIsStreaming(false);
    setActiveLocalId(null);
    inflightRef.current = false;
    taskIdRef.current = undefined;
  }, []);

  const setFeedback = useCallback(async (localId: string, rating: 'like' | 'dislike' | null, content?: string) => {
    const msg = messages.find((m) => m.localId === localId);
    if (!msg?.difyMessageId) throw new ApiError('شناسه پیام در دسترس نیست.', 'no_message_id', 400);
    await chatApi.feedback(msg.difyMessageId, rating ?? 'null', content);
    patch(localId, { feedback: rating });
  }, [messages, patch]);

  const getSuggested = useCallback(async (localId: string): Promise<string[]> => {
    const msg = messages.find((m) => m.localId === localId);
    if (!msg?.difyMessageId) return [];
    try {
      const res = await chatApi.suggested(msg.difyMessageId);
      return Array.isArray(res.data) ? res.data : [];
    } catch {
      return []; // endpoint may be unsupported by this app version — degrade silently
    }
  }, [messages]);

  return { messages, conversationId, isStreaming, activeLocalId, send, resend, stop, reset, setFeedback, getSuggested };
}
