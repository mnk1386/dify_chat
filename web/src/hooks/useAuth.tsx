/**
 * Auth context: loads current user via /api/auth/me, exposes login/logout.
 * On 401 the app shows the login page. CSRF token is stored in memory only.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authApi, setCsrfToken, ApiError } from '../api/client';
import type { UserInfo } from '../types';

interface AuthState {
  user: UserInfo | null;
  loading: boolean;
  provider: string;
  error: string | null;
  login: (u: string, p: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null, loading: true, provider: 'local', error: null,
  login: async () => false, logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState('local');
  const [error, setError] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    try {
      const me = await authApi.me();
      setCsrfToken(me.csrfToken);
      setUser(me.user);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setUser(null);
      else setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    authApi.provider().then((p) => setProvider(p.provider)).catch(() => {});
    loadMe();
  }, [loadMe]);

  const login = useCallback(async (username: string, password: string) => {
    setError(null);
    try {
      await authApi.login(username, password);
      await loadMe();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'خطای نامشخص در ورود.');
      return false;
    }
  }, [loadMe]);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    setCsrfToken('');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, provider, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
