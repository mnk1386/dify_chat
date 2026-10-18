/**
 * Theme + font preferences.
 * - theme: light/dark/auto persisted in localStorage; applied by toggling `dark` class.
 * - font: vazirmatn/local/system persisted; admin default (uiFont) can seed first visit.
 */

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'auto';
export type FontPref = 'vazirmatn' | 'local' | 'system';

const THEME_KEY = 'dchat_theme';
const FONT_KEY = 'dchat_font';

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

function applyFont(font: FontPref) {
  const cls = { vazirmatn: 'font-vazir', local: 'font-local', system: 'font-system' }[font];
  document.documentElement.classList.remove('font-vazir', 'font-local', 'font-system');
  document.documentElement.classList.add(cls);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    try { return (localStorage.getItem(THEME_KEY) as Theme) || 'auto'; } catch { return 'auto'; }
  });

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'auto') return;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const handler = () => applyTheme('auto');
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, [theme]);

  const setTheme = useCallback((th: Theme) => {
    setThemeState(th);
    try { localStorage.setItem(THEME_KEY, th); } catch { /* private mode */ }
  }, []);

  return { theme, setTheme };
}

export function useFont(seedIfUnset?: FontPref) {
  const [font, setFontState] = useState<FontPref>(() => {
    try { return (localStorage.getItem(FONT_KEY) as FontPref) || 'vazirmatn'; } catch { return 'vazirmatn'; }
  });

  useEffect(() => {
    if (seedIfUnset) {
      let has = false;
      try { has = Boolean(localStorage.getItem(FONT_KEY)); } catch { has = true; }
      if (!has) {
        try { localStorage.setItem(FONT_KEY, seedIfUnset); } catch { /* noop */ }
        setFontState(seedIfUnset);
      }
    }
  }, [seedIfUnset]);

  useEffect(() => { applyFont(font); }, [font]);

  const setFont = useCallback((f: FontPref) => {
    setFontState(f);
    try { localStorage.setItem(FONT_KEY, f); } catch { /* noop */ }
  }, []);

  return { font, setFont };
}
