/**
 * App shell: auth gate → chat page; admin route guarded by role.
 * Owns the shared connection-status polling (with exponential backoff when down)
 * and app parameters (opening statement, suggestions, upload limits, TTS flag).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { useTheme, useFont, type Theme } from './hooks/useTheme';
import { ChatPage } from './pages/ChatPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { appApi } from './api/client';
import type { AppParameters, AppStatus } from './types';

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

function Shell() {
  const { user, loading } = useAuth();
  const { theme, setTheme } = useTheme();
  const [route, setRoute] = useState<'chat' | 'admin'>('chat');
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [parameters, setParameters] = useState<AppParameters | null>(null);
  const backoffRef = useRef(5000);
  const timerRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);

  // seed font preference from admin default on first visit
  const [fontSeed, setFontSeed] = useState<'local' | 'vazirmatn' | 'system' | undefined>(undefined);
  useFont(fontSeed);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const checkStatus = useCallback(async () => {
    if (!user) return;
    setStatusLoading(true);
    let next: AppStatus | null = null;
    try {
      next = await appApi.status();
    } catch {
      next = null;
    }
    if (!mountedRef.current) return;
    setStatusLoading(false);
    if (next) {
      setStatus(next);
      // exponential backoff while disconnected: 5s → 10s → 20s → … max 60s; 30s when ok
      if (next.connected) {
        backoffRef.current = 30000;
        // load parameters once per connected session change
        try {
          const p = await appApi.parameters();
          if (mountedRef.current) setParameters(p);
        } catch { /* parameters optional — UI degrades gracefully */ }
      } else {
        backoffRef.current = Math.min(backoffRef.current * 2, 60000);
      }
    } else {
      backoffRef.current = Math.min(backoffRef.current * 2, 60000);
    }
    if (mountedRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(checkStatus, backoffRef.current);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    backoffRef.current = 5000;
    checkStatus();
    return () => window.clearTimeout(timerRef.current);
  }, [user, checkStatus]);

  // seed appearance defaults from server settings for admins (cheap: piggyback on status payload not available → fetch only for admin)
  useEffect(() => {
    if (user?.role === 'admin') {
      import('./api/client').then(({ adminApi }) => {
        adminApi.settings().then((s) => {
          setFontSeed(s.uiFont);
          if (!localStorage.getItem('dchat_theme')) {
            setTheme(s.uiThemeDefault as Theme);
          }
        }).catch(() => {});
      });
    }
  }, [user, setTheme]);

  const cycleTheme = useCallback(() => {
    const order: Theme[] = ['light', 'dark', 'auto'];
    setTheme(order[(order.indexOf(theme) + 1) % 3]);
  }, [theme, setTheme]);

  if (loading) {
    return (
      <div className="grid h-full place-items-center bg-slate-100 dark:bg-slate-950" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" aria-hidden="true" />
          <span className="text-sm">در حال بارگذاری…</span>
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <div className="h-full">
      {route === 'admin' && user.role === 'admin'
        ? <SettingsPage onBack={() => setRoute('chat')} />
        : <ChatPage
            status={status}
            statusLoading={statusLoading}
            onRecheckStatus={checkStatus}
            theme={theme}
            onCycleTheme={cycleTheme}
            parameters={parameters}
            onOpenAdmin={() => setRoute('admin')}
          />}
    </div>
  );
}
