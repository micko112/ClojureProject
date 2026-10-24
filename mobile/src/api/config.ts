import { kvStorage, secureStorage } from '@/lib/storage';

/**
 * Server URL and auth token, kept in memory for synchronous access by the
 * HTTP client and persisted in storage. `loadSession()` must run once at
 * startup (AuthProvider does it) before any request.
 */

export const DEFAULT_API_URL = normalizeBaseUrl(
  process.env.EXPO_PUBLIC_API_URL || 'https://bebetter.quest',
);

const SERVER_KEY = 'bebetter.serverUrl';
const TOKEN_KEY = 'bebetter.token';

let baseUrl = DEFAULT_API_URL;
let token: string | null = null;

/** "192.168.1.20:3000" -> "http://192.168.1.20:3000"; trims trailing slashes and "/api". */
export function normalizeBaseUrl(input: string): string {
  let url = input.trim();
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) {
    const isLocal = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[\w-]+\.local)/i.test(url);
    url = `${isLocal ? 'http' : 'https'}://${url}`;
  }
  return url.replace(/\/+$/, '').replace(/\/api$/i, '');
}

export function isValidBaseUrl(input: string): boolean {
  try {
    const u = new URL(normalizeBaseUrl(input));
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}

export function getBaseUrl(): string {
  return baseUrl;
}

export function isCustomBaseUrl(): boolean {
  return baseUrl !== DEFAULT_API_URL;
}

/** Persists a custom server; pass null to go back to the default. */
export async function setBaseUrl(url: string | null): Promise<void> {
  if (url === null || normalizeBaseUrl(url) === DEFAULT_API_URL) {
    baseUrl = DEFAULT_API_URL;
    await kvStorage.remove(SERVER_KEY);
  } else {
    baseUrl = normalizeBaseUrl(url);
    await kvStorage.set(SERVER_KEY, baseUrl);
  }
}

export function getToken(): string | null {
  return token;
}

export async function setToken(value: string | null): Promise<void> {
  token = value;
  if (value) await secureStorage.set(TOKEN_KEY, value);
  else await secureStorage.remove(TOKEN_KEY);
}

/** Loads the persisted server URL and token into memory. */
export async function loadSession(): Promise<{ baseUrl: string; token: string | null }> {
  const [savedUrl, savedToken] = await Promise.all([
    kvStorage.get(SERVER_KEY),
    secureStorage.get(TOKEN_KEY),
  ]);
  baseUrl = savedUrl ? normalizeBaseUrl(savedUrl) : DEFAULT_API_URL;
  token = savedToken;
  return { baseUrl, token };
}

/**
 * Media URLs from a local-disk backend are relative ("/uploads/x.jpg");
 * make them absolute against the current server.
 */
export function resolveUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|data:|blob:|file:)/i.test(url)) return url;
  return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** ws(s)://host/api/ws?access_token=... */
export function realtimeUrl(): string | null {
  if (!token) return null;
  const ws = baseUrl.replace(/^http/i, 'ws');
  return `${ws}/api/ws?access_token=${encodeURIComponent(token)}`;
}
