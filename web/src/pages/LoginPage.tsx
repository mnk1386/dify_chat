/**
 * Login page: minimal RTL form. Works with the local demo provider; if the backend
 * reports a different provider, shows an informational message instead of the form.
 */

import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { t } from '../i18n/fa';

export function LoginPage() {
  const { login, error, provider } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !username.trim() || !password) return;
    setBusy(true);
    await login(username.trim(), password);
    setBusy(false);
  };

  return (
    <div className="grid min-h-full place-items-center bg-gradient-to-b from-slate-100 to-slate-200 px-4 dark:from-slate-950 dark:to-slate-900">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-2xl font-bold text-white shadow-lg" aria-hidden="true">AI</span>
          <h1 className="text-xl font-bold">{t.auth.login}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t.app.subtitle}</p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {provider !== 'local' ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {t.auth.signedHeaderHint} ({provider})
            </p>
          ) : (
            <>
              <div>
                <label htmlFor="login-user" className="mb-1 block text-sm font-medium">{t.auth.username}</label>
                <input id="login-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username"
                  dir="ltr" required
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm outline-none transition-colors focus:border-brand-400 dark:border-slate-600 dark:bg-slate-800" />
              </div>
              <div>
                <label htmlFor="login-pass" className="mb-1 block text-sm font-medium">{t.auth.password}</label>
                <input id="login-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
                  dir="ltr" required
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm outline-none transition-colors focus:border-brand-400 dark:border-slate-600 dark:bg-slate-800" />
              </div>
            </>
          )}

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              ⚠ {error}
            </p>
          )}

          <button type="submit" disabled={busy || (provider !== 'local')}
            className="w-full rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? t.auth.loggingIn : t.auth.submit}
          </button>
        </form>
        <p className="mt-4 text-center text-[11px] text-slate-400">نسخه ۱.۰.۰ — سامانه داخلی</p>
      </div>
    </div>
  );
}
