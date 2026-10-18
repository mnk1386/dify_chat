/**
 * Top bar: app title, live connection status indicator (polled by ChatPage),
 * theme toggle (light/dark/auto), user menu (name, admin link, logout).
 */

import React, { useState, useRef, useEffect } from 'react';
import type { AppStatus } from '../types';
import { t } from '../i18n/fa';
import type { Theme } from '../hooks/useTheme';
import type { UserInfo } from '../types';

interface Props {
  status: AppStatus | null;
  statusLoading: boolean;
  onRecheck: () => void;
  theme: Theme;
  onCycleTheme: () => void;
  user: UserInfo;
  onLogout: () => void;
  onOpenAdmin: () => void;
}

export function Header({ status, statusLoading, onRecheck, theme, onCycleTheme, user, onLogout, onOpenAdmin }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const connected = Boolean(status?.connected);
  const configured = status ? status.configured : true;
  const dotClass = statusLoading ? 'bg-amber-400' : connected ? 'bg-emerald-500' : 'bg-red-500';
  const label = statusLoading ? t.chat.statusChecking : connected ? t.chat.statusConnected : configured ? t.chat.statusDisconnected : t.chat.connectionDown;
  const themeIcon = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️';

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900 no-print">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-base font-bold text-white shadow-sm" aria-hidden="true">AI</span>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-bold sm:text-base">{t.app.title}</h1>
          <p className="hidden truncate text-[11px] text-slate-400 sm:block">{status?.appName || t.app.subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* connection pill */}
        <button type="button" onClick={onRecheck} title={label}
          className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-brand-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          aria-live="polite">
          <span className={`h-2 w-2 rounded-full ${dotClass} ${statusLoading ? 'animate-pulse' : ''}`} aria-hidden="true" />
          {label}
        </button>

        {/* theme cycle: light → dark → auto */}
        <button type="button" onClick={onCycleTheme}
          className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          title={`پوسته: ${t.admin.themes[theme]}`} aria-label={`تغییر پوسته (${t.admin.themes[theme]})`}>
          {themeIcon}
        </button>

        {/* user menu */}
        <div className="relative" ref={menuRef}>
          <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen}
            className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm transition-colors hover:bg-slate-100 dark:hover:bg-slate-800">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-200 text-xs font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200" aria-hidden="true">
              {(user.displayName || user.username).slice(0, 2)}
            </span>
            <span className="hidden max-w-[10rem] truncate md:block">{user.displayName || user.username}</span>
            <span className="text-[10px] text-slate-400" aria-hidden="true">▾</span>
          </button>
          {menuOpen && (
            <div role="menu" className="absolute left-0 top-full z-40 mt-1 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
              <p className="border-b border-slate-100 px-3 py-2 text-xs text-slate-400 dark:border-slate-700" dir="ltr">{user.username}</p>
              {user.role === 'admin' && (
                <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); onOpenAdmin(); }}
                  className="block w-full px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-700">
                  ⚙️ {t.nav.settings}
                </button>
              )}
              <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); onLogout(); }}
                className="block w-full px-3 py-2 text-start text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40">
                  ⏏ {t.auth.logout}
                </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
