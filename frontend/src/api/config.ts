/** 运行时配置：全部来自 Vite 环境变量，缺省即开发可用 */
const env = import.meta.env;

function bool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value) === 'true' || String(value) === '1';
}

export const API_BASE_URL = (env.VITE_API_BASE_URL as string | undefined) ?? '';

/**
 * Mock 数据层开关：默认在后端未就绪时开启（开发环境 true）。
 * 生产构建若未显式配置 VITE_USE_MOCK，则默认关闭，直连真实后端。
 */
export const USE_MOCK = bool(env.VITE_USE_MOCK, env.DEV);

export const WS_URL =
  (env.VITE_WS_URL as string | undefined) ||
  (typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
    : '');

export const SSE_URL = (env.VITE_SSE_URL as string | undefined) || '/api/v1/sse';

export const DEMO_HLS_URL = (env.VITE_DEMO_HLS_URL as string | undefined) || '/demo/hls/master.m3u8';

export const REQUEST_TIMEOUT = 20_000;

/** 统一响应中的业务错误码（文档 6.3） */
export const BIZ_CODE = {
  OK: 0,
  PARAM_INVALID: 40001,
  RATE_LIMITED: 40002,
  UNAUTHORIZED: 40101,
  BAD_CREDENTIALS: 40102,
  BAD_SMS_CODE: 40103,
  FORBIDDEN: 40301,
  NOT_FOUND: 40401,
  TOO_MANY_REQUESTS: 42901,
  SERVER_ERROR: 50001,
} as const;
