import { API_BASE_URL, BIZ_CODE, REQUEST_TIMEOUT, USE_MOCK } from './config';
import { authBridge } from './authBridge';
import type { ApiEnvelope } from './types';

export class ApiError extends Error {
  readonly code: number;
  readonly status: number;
  readonly timestamp?: number;

  constructor(message: string, code: number, status = 200, timestamp?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.timestamp = timestamp;
  }

  get isUnauthorized(): boolean {
    return this.status === 401 || this.code === BIZ_CODE.UNAUTHORIZED;
  }

  get isForbidden(): boolean {
    return this.status === 403 || this.code === BIZ_CODE.FORBIDDEN;
  }

  get isNotFound(): boolean {
    return this.status === 404 || this.code === BIZ_CODE.NOT_FOUND;
  }

  get isRateLimited(): boolean {
    return this.status === 429 || this.code === BIZ_CODE.TOO_MANY_REQUESTS;
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, unknown>;
  /** 需要登录：无 Token 时直接抛出 401，不发请求 */
  auth?: boolean;
  /** 非天然幂等接口自动附带 Idempotency-Key（文档 6.3） */
  idempotent?: boolean;
  timeout?: number;
}

function buildUrl(path: string, query?: Record<string, unknown>): string {
  const base = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      value.forEach((v) => params.append(key, String(v)));
    } else {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  if (!qs) return base;
  return base.includes('?') ? `${base}&${qs}` : `${base}?${qs}`;
}

let refreshPromise: Promise<string | null> | null = null;

/** 单飞刷新：并发 401 只触发一次 /auth/refresh */
function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = authBridge
      .refresh()
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function dispatch(url: string, init: RequestInit): Promise<Response> {
  if (USE_MOCK) {
    const { mockFetch } = await import('@/mocks');
    return mockFetch(url, init);
  }
  return fetch(url, init);
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ApiError('响应解析失败', BIZ_CODE.SERVER_ERROR, response.status);
  }

  const envelope = payload as ApiEnvelope<T>;
  if (typeof envelope?.code === 'number') {
    if (envelope.code !== BIZ_CODE.OK) {
      throw new ApiError(envelope.message || '请求失败', envelope.code, response.status, envelope.timestamp);
    }
    return envelope.data;
  }
  return payload as T;
}

async function execute<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = false, idempotent = false, timeout, ...rest } = options;
  const url = buildUrl(path, query);
  const token = authBridge.getToken();

  if (auth && !token) {
    throw new ApiError('请先登录', BIZ_CODE.UNAUTHORIZED, 401);
  }

  const headers = new Headers(rest.headers);
  headers.set('Accept', 'application/json');
  // CSRF 双重防御：自定义头校验（文档 13.1）
  headers.set('X-Requested-With', 'XMLHttpRequest');
  const rawBody =
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof URLSearchParams;
  if (body !== undefined && !rawBody) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (idempotent && !headers.has('Idempotency-Key')) {
    headers.set('Idempotency-Key', crypto.randomUUID());
  }

  const controller = new AbortController();
  const timeoutMs = timeout ?? REQUEST_TIMEOUT;
  const timer = window.setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  const signal = rest.signal ? AbortSignal.any([rest.signal, controller.signal]) : controller.signal;

  const init: RequestInit = {
    ...rest,
    method,
    headers,
    signal,
    // Refresh Token 走 httpOnly Cookie，跨域场景必须携带凭证
    credentials: 'include',
    body: body === undefined ? undefined : rawBody ? (body as BodyInit) : JSON.stringify(body),
  };

  let response: Response;
  try {
    response = await dispatch(url, init);
  } catch (error) {
    window.clearTimeout(timer);
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ApiError('请求超时，请检查网络后重试', BIZ_CODE.SERVER_ERROR, 408);
    }
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('网络连接失败，请稍后重试', BIZ_CODE.SERVER_ERROR, 0);
  }
  window.clearTimeout(timer);

  // 401：静默刷新一次后重试（旋转 + 复用检测在服务端）
  if (response.status === 401 && auth) {
    const newToken = await refreshAccessToken();
    if (!newToken) {
      authBridge.expire('expired');
      throw new ApiError('登录状态已过期，请重新登录', BIZ_CODE.UNAUTHORIZED, 401);
    }
    headers.set('Authorization', `Bearer ${newToken}`);
    const retry = await dispatch(url, { ...init, headers });
    return parseEnvelope<T>(retry);
  }

  return parseEnvelope<T>(response);
}

export const http = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    execute<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    execute<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    execute<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    execute<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    execute<T>(path, { ...options, method: 'DELETE', body }),
};

export { buildUrl };
