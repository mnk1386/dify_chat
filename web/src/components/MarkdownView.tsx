/**
 * Markdown message renderer with copy-all and per-code-block copy buttons.
 * Content is sanitized in renderMarkdown (DOMPurify) before injection.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { renderMarkdown } from './markdown';
import { t } from '../i18n/fa';

interface Props { content: string; streaming?: boolean; onRendered?: (root: HTMLElement) => void; }

export function MarkdownView({ content, streaming, onRendered }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(content), [content]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const timersRef = useRef<number[]>([]);

  useEffect(() => () => { timersRef.current.forEach((id) => window.clearTimeout(id)); }, []);

  // Wire copy buttons into each code block after render (React-safe: no injected JS).
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const pres = Array.from(root.querySelectorAll('pre[data-code-block]'));
    pres.forEach((pre, i) => {
      if (pre.querySelector('.code-copy-btn')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy-btn';
      btn.textContent = t.chat.copyCode;
      btn.setAttribute('aria-label', t.chat.copyCode);
      btn.addEventListener('click', async () => {
        const text = pre.querySelector('code')?.textContent || '';
        const ok = await copyText(text);
        btn.textContent = ok ? t.chat.copied : 'خطا';
        const id = window.setTimeout(() => { btn.textContent = t.chat.copyCode; setCopiedIdx(null); }, 1500);
        timersRef.current.push(id);
        if (ok) setCopiedIdx(i);
      });
      pre.appendChild(btn);
    });
    onRendered?.(root);
  }, [html, onRendered]);

  return (
    <div className="relative">
      <div
        ref={ref}
        dir="rtl"
        className={`md ${streaming ? 'streaming-caret' : ''}`}
        // html is sanitized via DOMPurify in renderMarkdown — safe against XSS
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {copiedIdx !== null && (
        <span className="sr-only" role="status">{t.chat.copied}</span>
      )}
    </div>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall back below (http intranet) */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
