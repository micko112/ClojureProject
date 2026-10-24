import { getBaseUrl, getToken } from './config';

/**
 * Typed fetch wrapper for the BeBetter REST API.
 *
 *   const post = await api.get<Post>(`/api/posts/${id}`);
 *   await api.post('/api/posts/1/like');
 *   const page = await api.get<Page<Post>>('/api/feed', { query: { cursor, limit: 10 } });
 *
 * - Prefixes the configured server URL, sends `Authorization: Bearer`.
 * - JSON in / JSON out; non-2xx responses throw `ApiError` with the
 *   backend's `{error}` message.
 * - A 401 on an authenticated request calls the handler registered with
 *   `setUnauthorizedHandler` (AuthProvider signs out and shows login).
 */

export class ApiError extends Error {
  readonly status: number;
  /** machine-readable code from the backend, e.g. "oauth-only" */
  readonly code?: string;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    const code = (body as { code?: unknown } | undefined)?.code;
    this.code = typeof code === 'string' ? code : undefined;
  }

  /** status 0 = the request never reached the server */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON-serialised unless it is FormData */
  body?: unknown;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Don't send the bearer token and don't trigger the global 401 handler. */
  anonymous?: boolean;
  /** Timeout in ms (default 20s). */
  timeoutMs?: number;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** Registered by AuthProvider. Called at most once per burst of 401s. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = /^https?:\/\//i.test(path) ? path : `${getBaseUrl()}${path.startsWith('/') ? '' : '/'}${path}`;
  if (!query) return url;
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url;
}

/** Headers every request carries (also used by the XHR uploader). */
export function authHeaders(anonymous = false): Record<string, string> {
  const token = anonymous ? null : getToken();
  return {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function errorMessageFor(status: number, body: unknown): string {
  const fromBody = (body as { error?: unknown; message?: unknown } | undefined) ?? {};
  if (typeof fromBody.error === 'string' && fromBody.error) return fromBody.error;
  if (typeof fromBody.message === 'string' && fromBody.message) return fromBody.message;
  if (status === 0) return "Can't reach the server. Check your connection.";
  if (status === 401) return 'Please log in again.';
  if (status === 403) return "You don't have access to this.";
  if (status === 404) return 'Not found.';
  if (status === 413) return 'File is too large.';
  if (status === 429) return 'Too many requests. Try again in a moment.';
  if (status >= 500) return 'Something went wrong on our side. Try again.';
  return 'Something went wrong.';
}

export function handleUnauthorized(): void {
  onUnauthorized?.();
}

export async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const { method = 'GET', body, query, headers, signal, anonymous = false, timeoutMs = 20_000 } = opts;
  const sentToken = !anonymous && !!getToken();
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers: {
        ...authHeaders(anonymous),
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    const timedOut = controller.signal.aborted;
    throw new ApiError(0, timedOut ? 'The server took too long to answer.' : errorMessageFor(0, undefined));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && sentToken) handleUnauthorized();
    throw new ApiError(res.status, errorMessageFor(res.status, data), data);
  }
  return { data: data as T, status: res.status, headers: res.headers };
}

async function json<T>(path: string, opts: RequestOptions): Promise<T> {
  return (await request<T>(path, opts)).data;
}

export const api = {
  get: <T = unknown>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    json<T>(path, { ...opts, method: 'GET' }),
  post: <T = unknown>(path: string, body: unknown = {}, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    json<T>(path, { ...opts, method: 'POST', body }),
  put: <T = unknown>(path: string, body: unknown = {}, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    json<T>(path, { ...opts, method: 'PUT', body }),
  delete: <T = unknown>(path: string, opts?: Omit<RequestOptions, 'method'>) =>
    json<T>(path, { ...opts, method: 'DELETE' }),
  /** Full response (status + headers), e.g. for X-Next-Before on notifications. */
  request,
};
