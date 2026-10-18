/**
 * Admin settings page (role=admin). Backend stores everything in SQLite; the API key
 * is write-only (never returned — only a masked hint). Includes connection test,
 * technical event log viewer and app version info.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, ApiError } from '../api/client';
import type { AdminSettings, EventRow, TestConnectionResult } from '../types';
import { t, formatTime } from '../i18n/fa';
import { useFont, useTheme, type FontPref, type Theme } from '../hooks/useTheme';

interface Props { onBack: () => void; }

export function SettingsPage({ onBack }: Props) {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // form draft
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [appType, setAppType] = useState<'chat' | 'completion' | 'workflow'>('chat');
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [maxUploadMb, setMaxUploadMb] = useState(10);
  const [fontPref, setFontPref] = useState<FontPref>('vazirmatn');
  const [themePref, setThemePref] = useState<Theme>('auto');
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [eventsBusy, setEventsBusy] = useState(false);
  const { setFont } = useFont();
  const { setTheme } = useTheme();

  useEffect(() => {
    adminApi.settings()
      .then((s) => {
        setSettings(s);
        setBaseUrl(s.difyBaseUrl);
        setAppType(s.difyAppType);
        setTimeoutMs(s.difyTimeoutMs);
        setMaxUploadMb(s.maxUploadSizeMb);
        setFontPref(s.uiFont);
        setThemePref(s.uiThemeDefault);
      })
      .catch((e: unknown) => setLoadError(e instanceof ApiError ? e.message : 'خطای بارگذاری تنظیمات.'));
  }, []);

  const loadEvents = useCallback(async () => {
    setEventsBusy(true);
    try {
      const res = await adminApi.events(50);
      setEvents(res.data);
    } catch { setEvents([]); }
    finally { setEventsBusy(false); }
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const runTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await adminApi.testConnection({ difyBaseUrl: baseUrl.trim() || undefined, difyApiKey: apiKey.trim() || undefined });
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, appName: null, appDescription: null, siteTitle: null, error: e instanceof ApiError ? e.message : 'خطای نامشخص', errorCode: 'unknown' });
    } finally { setTesting(false); }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setSaveNote(null);
    try {
      await adminApi.saveSettings({
        difyBaseUrl: baseUrl.trim(),
        ...(apiKey.trim() ? { difyApiKey: apiKey.trim() } : {}),
        difyAppType: appType,
        difyTimeoutMs: timeoutMs,
        maxUploadSizeMb: maxUploadMb,
        uiFont: fontPref,
        uiThemeDefault: themePref,
      });
      setSaveNote(`✓ ${t.admin.saved}`);
      setApiKey('');
      const s = await adminApi.settings();
      setSettings(s);
      // apply appearance immediately for own session too
      setFont(fontPref); setTheme(themePref);
      window.setTimeout(() => setSaveNote(null), 2500);
    } catch (err) {
      setSaveNote(`⚠ ${err instanceof ApiError ? err.message : 'ذخیره ناموفق بود.'}`);
    } finally { setSaving(false); }
  };

  if (loadError) {
    return (
      <div className="grid min-h-full place-items-center p-6">
        <div className="max-w-sm rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-300">{loadError}</p>
          <button type="button" onClick={onBack} className="mt-4 rounded-lg bg-white px-4 py-2 text-sm shadow-sm dark:bg-slate-800">{t.common.close}</button>
        </div>
      </div>
    );
  }

  if (!settings) {
    return <div className="grid min-h-full place-items-center text-sm text-slate-400" role="status">{t.app.loading}</div>;
  }

  return (
    <div className="min-h-full overflow-y-auto nice-scroll bg-slate-100 dark:bg-slate-950">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <button type="button" onClick={onBack} className="rounded-lg px-2.5 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800">→ بازگشت به گفت‌وگو</button>
        <h1 className="text-base font-bold">{t.admin.title}</h1>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 p-4 md:grid-cols-2">
        {/* ---- Dify connection ---- */}
        <form onSubmit={save} className="md:col-span-2 space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h2 className="mb-4 text-sm font-bold text-slate-700 dark:text-slate-200">🔌 {t.admin.connection}</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.admin.baseUrl} hint={t.admin.baseUrlHint}>
                <input dir="ltr" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setTestResult(null); }}
                  placeholder="http://dify.internal/v1" required
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-brand-400 dark:border-slate-600 dark:bg-slate-800" />
              </Field>
              <Field label={t.admin.apiKey} hint={settings.apiKeySet ? t.admin.apiKeySet : t.admin.apiKeyNeverShown}>
                <input dir="ltr" type="password" value={apiKey} onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }}
                  placeholder={settings.apiKeyMasked || 'app-…'} autoComplete="new-password"
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-brand-400 dark:border-slate-600 dark:bg-slate-800" />
              </Field>
              <Field label={t.admin.appType}>
                <select value={appType} onChange={(e) => setAppType(e.target.value as typeof appType)}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-brand-400 dark:border-slate-600 dark:bg-slate-800">
                  <option value="chat">{t.admin.appTypes.chat}</option>
                  <option value="completion">{t.admin.appTypes.completion}</option>
                  <option value="workflow">{t.admin.appTypes.workflow}</option>
                </select>
              </Field>
              <Field label={t.admin.timeout}>
                <input type="number" min={5000} max={120000} step={1000} value={timeoutMs}
                  onChange={(e) => setTimeoutMs(clamp(Number(e.target.value) || 30000, 5000, 120000))}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-brand-400 dark:border-slate-600 dark:bg-slate-800" dir="ltr" />
              </Field>
              <Field label={t.admin.maxUpload}>
                <input type="number" min={1} max={100} value={maxUploadMb}
                  onChange={(e) => setMaxUploadMb(clamp(Number(e.target.value) || 10, 1, 100))}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-brand-400 dark:border-slate-600 dark:bg-slate-800" dir="ltr" />
              </Field>

              <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                <button type="button" onClick={runTest} disabled={testing}
                  className="rounded-xl border border-brand-300 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-100 disabled:opacity-50 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-300">
                  {testing ? t.admin.testing : `🧪 ${t.admin.testConnection}`}
                </button>
                {testResult && (
                  <span className={`text-sm ${testResult.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`} role="status">
                    {testResult.ok ? `✓ ${t.admin.testOk}${testResult.appName ? ` — ${testResult.appName}` : ''}` : `✗ ${testResult.error || t.chat.connectionDown}${testResult.errorCode ? ` (${testResult.errorCode})` : ''}`}
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* ---- Appearance ---- */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h2 className="mb-4 text-sm font-bold text-slate-700 dark:text-slate-200">🎨 {t.admin.appearance}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.admin.font}>
                <select value={fontPref} onChange={(e) => setFontPref(e.target.value as FontPref)}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-brand-400 dark:border-slate-600 dark:bg-slate-800">
                  <option value="vazirmatn">{t.admin.fonts.vazirmatn}</option>
                  <option value="local">{t.admin.fonts.local}</option>
                  <option value="system">{t.admin.fonts.system}</option>
                </select>
              </Field>
              <Field label={t.admin.theme}>
                <select value={themePref} onChange={(e) => setThemePref(e.target.value as Theme)}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-brand-400 dark:border-slate-600 dark:bg-slate-800">
                  <option value="auto">{t.admin.themes.auto}</option>
                  <option value="light">{t.admin.themes.light}</option>
                  <option value="dark">{t.admin.themes.dark}</option>
                </select>
              </Field>
            </div>
          </section>

          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving}
              className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50">
              {saving ? t.app.loading : `💾 ${t.admin.save}`}
            </button>
            {saveNote && <span className="text-sm" role="status">{saveNote}</span>}
          </div>
        </form>

        {/* ---- Events / status ---- */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">📋 {t.admin.events}</h2>
            <button type="button" onClick={loadEvents} disabled={eventsBusy}
              className="rounded-lg px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">{eventsBusy ? '…' : `↻ ${t.admin.refreshEvents}`}</button>
          </div>
          {!events ? (
            <p className="py-6 text-center text-xs text-slate-400">{t.app.loading}</p>
          ) : events.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">{t.admin.noEvents}</p>
          ) : (
            <ul className="nice-scroll max-h-80 space-y-2 overflow-y-auto pe-1">
              {events.map((ev) => (
                <li key={ev.id} className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs dark:border-slate-800 dark:bg-slate-800/60">
                  <div className="flex items-center justify-between">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${levelColor(ev.level)}`}>{ev.level}</span>
                    <time className="text-[10px] text-slate-400">{formatTime(ev.created_at)}</time>
                  </div>
                  <p className="mt-1 font-medium text-slate-600 dark:text-slate-300">{ev.type}</p>
                  <p className="mt-0.5 break-words text-slate-400" dir="auto">{ev.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-bold text-slate-700 dark:text-slate-200">ℹ️ {t.admin.apiStatus}</h2>
          <dl className="space-y-2 text-sm">
            <Row k="Dify Base URL" v={<code dir="ltr" className="text-xs">{settings.difyBaseUrl || '—'}</code>} />
            <Row k="API Key" v={<code dir="ltr" className="text-xs">{settings.apiKeyMasked || '—'}</code>} />
            <Row k="App Type" v={t.admin.appTypes[settings.difyAppType]} />
            <Row k="AuthProvider" v={settings.authProvider} />
            <Row k={t.admin.versions} v={<span dir="ltr" className="num-ltr text-xs">Node {settings.versions.node} · Server {settings.versions.server}</span>} />
          </dl>
        </section>
      </main>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-5 text-slate-400">{hint}</span>}
    </label>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dashed border-slate-100 pb-2 last:border-0 dark:border-slate-800">
      <dt className="text-xs text-slate-400">{k}</dt>
      <dd className="text-sm">{v}</dd>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, n)); }

function levelColor(level: string): string {
  switch (level) {
    case 'error': return 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300';
    case 'warn': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300';
    default: return 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300';
  }
}
