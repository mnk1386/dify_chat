/**
 * Safe Markdown renderer.
 * - marked for parsing, DOMPurify for sanitization (XSS protection).
 * - Links: forced https/http/mailto only, target=_blank + rel=noopener noreferrer nofollow.
 * - Code blocks: LTR direction, monospace; copy buttons are wired by the React component
 *   after render (via data attributes), not by injecting scripts.
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
  gfm: true,          // tables, strikethrough, task lists
  breaks: true,       // single newline -> <br> (chat-friendly)
});

const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$)/i;

export function renderMarkdown(md: string): string {
  const rawHtml = marked.parse(md ?? '', { async: false }) as string;
  const clean = DOMPurify.sanitize(rawHtml, {
    ALLOWED_URI_REGEXP,
    FORBID_TAGS: ['style', 'form', 'input', 'textarea', 'select', 'button', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'formaction', 'srcdoc'],
    ADD_ATTR: ['target', 'rel', 'dir'],
  });
  return decorate(clean);
}

/** Post-processing on sanitized DOM: harden links, mark code blocks for copy UI. */
function decorate(html: string): string {
  const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html');
  const root = doc.getElementById('r')!;

  root.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (!/^(https?:|mailto:|tel:|#)/i.test(href)) { a.removeAttribute('href'); return; }
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer nofollow');
  });

  root.querySelectorAll('pre').forEach((pre, i) => {
    pre.setAttribute('data-code-block', String(i));
    const code = pre.querySelector('code');
    if (code) {
      // code content must stay LTR regardless of page RTL
      code.setAttribute('dir', 'ltr');
      const m = /language-([\w+#-]+)/.exec(code.className || '');
      if (m) pre.setAttribute('data-lang', m[1]);
    }
  });

  // Wide tables get a scroll wrapper class handled in CSS via .md table
  return root.innerHTML;
}

/** Extract plain text of a rendered container's code blocks (for copy buttons). */
export function extractCodeBlocks(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('pre[data-code-block]'))
    .map((pre) => (pre.querySelector('code')?.textContent || '').replace(/\n$/, ''));
}
