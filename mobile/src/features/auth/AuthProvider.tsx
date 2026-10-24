import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { api, ApiError, setUnauthorizedHandler } from '@/api/client';
import { getBaseUrl, getToken, loadSession, setBaseUrl, setToken } from '@/api/config';
import { queryClient, queryKeys } from '@/api/queryClient';
import { realtime } from '@/api/realtime';
import type { AuthResponse, Me, RegisterRequest } from '@/api/types';
import { kvStorage } from '@/lib/storage';

/**
 * Auth state for the whole app.
 *
 *   const { status, user, signIn, signOut } = useAuth();
 *
 * - status: 'loading' (restoring the session) | 'signedOut' | 'signedIn'
 * - Login/register/OAuth send `X-Auth-Mode: token`; the token goes to
 *   SecureStore and every request sends it as a Bearer token.
 * - Any 401 on an authenticated request signs out (root layout then shows login).
 */

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export interface AuthContextValue {
  status: AuthStatus;
  /** Cached /api/me of the signed-in user (live copy: `useMe()`). */
  user: Me | null;
  serverUrl: string;
  signIn: (login: string, password: string) => Promise<Me>;
  register: (data: RegisterRequest) => Promise<Me>;
  /** POST /api/oauth/google {idToken} or /api/oauth/facebook {accessToken} */
  signInWithOAuth: (provider: 'google' | 'facebook', payload: Record<string, string>) => Promise<Me>;
  forgotPassword: (email: string) => Promise<string>;
  signOut: () => Promise<void>;
  /** Change the API server (signs out when it actually changes). */
  changeServer: (url: string | null) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const USER_KEY = 'bebetter.me';
const TOKEN_MODE = { 'X-Auth-Mode': 'token' };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<Me | null>(null);
  const [serverUrl, setServerUrl] = useState(getBaseUrl());
  const signingOut = useRef(false);

  const applySignedIn = useCallback(async (me: Me) => {
    queryClient.setQueryData(queryKeys.me, me);
    setUser(me);
    setStatus('signedIn');
    void kvStorage.setJSON(USER_KEY, me);
    realtime.start();
  }, []);

  const clearLocal = useCallback(async () => {
    realtime.stop();
    await setToken(null);
    await kvStorage.remove(USER_KEY);
    queryClient.clear();
    setUser(null);
    setStatus('signedOut');
  }, []);

  // Restore the session on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { baseUrl, token } = await loadSession();
      if (cancelled) return;
      setServerUrl(baseUrl);
      if (!token) {
        setStatus('signedOut');
        return;
      }
      const cached = await kvStorage.getJSON<Me>(USER_KEY);
      try {
        const me = await api.get<Me>('/api/me');
        if (!cancelled) await applySignedIn(me);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          await clearLocal();
        } else if (cached) {
          // offline / server down: keep the session, screens show their own errors
          await applySignedIn(cached);
        } else {
          setStatus('signedOut');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySignedIn, clearLocal]);

  // Global 401 → back to login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (signingOut.current || !getToken()) return;
      signingOut.current = true;
      void clearLocal().finally(() => {
        signingOut.current = false;
      });
    });
    return () => setUnauthorizedHandler(null);
  }, [clearLocal]);

  const finishTokenLogin = useCallback(
    async (res: AuthResponse) => {
      if (!res?.token) throw new ApiError(500, 'The server did not return a session token. Is it up to date?');
      const { token, ...me } = res;
      await setToken(token);
      await applySignedIn(me);
      return me as Me;
    },
    [applySignedIn],
  );

  const signIn = useCallback(
    async (login: string, password: string) => {
      const res = await api.post<AuthResponse>(
        '/api/login',
        { username: login.trim(), password },
        { anonymous: true, headers: TOKEN_MODE },
      );
      return finishTokenLogin(res);
    },
    [finishTokenLogin],
  );

  const register = useCallback(
    async (data: RegisterRequest) => {
      const res = await api.post<AuthResponse>('/api/register', data, { anonymous: true, headers: TOKEN_MODE });
      return finishTokenLogin(res);
    },
    [finishTokenLogin],
  );

  const signInWithOAuth = useCallback(
    async (provider: 'google' | 'facebook', payload: Record<string, string>) => {
      const res = await api.post<AuthResponse>(`/api/oauth/${provider}`, payload, {
        anonymous: true,
        headers: TOKEN_MODE,
      });
      return finishTokenLogin(res);
    },
    [finishTokenLogin],
  );

  const forgotPassword = useCallback(async (email: string) => {
    const res = await api.post<{ ok: boolean; message: string }>(
      '/api/password/forgot',
      { email: email.trim() },
      { anonymous: true },
    );
    return res.message;
  }, []);

  const signOut = useCallback(async () => {
    if (getToken()) {
      // revokes the token server-side; ignore network errors
      await api.post('/api/logout', {}, { timeoutMs: 5000 }).catch(() => undefined);
    }
    await clearLocal();
  }, [clearLocal]);

  const changeServer = useCallback(
    async (url: string | null) => {
      const before = getBaseUrl();
      await setBaseUrl(url);
      const after = getBaseUrl();
      setServerUrl(after);
      if (after !== before && getToken()) await clearLocal();
    },
    [clearLocal],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, serverUrl, signIn, register, signInWithOAuth, forgotPassword, signOut, changeServer }),
    [status, user, serverUrl, signIn, register, signInWithOAuth, forgotPassword, signOut, changeServer],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
