/** 运行时配置：全部来自 Vite 环境变量，缺省即开发可用 */
const env = import.meta.env;

export const API_BASE_URL = (env.VITE_API_BASE_URL as string | undefined) ?? '';

/**
 * Mock 数据层只在显式配置 VITE_USE_MOCK=true 时开启。
 * 默认通过 Vite/Nginx 的同源反代连接真实后端。
 *
 * 这里刻意写成「只用 import.meta.env 字面量比较」的表达式：Vite 会在构建期把
 * `import.meta.env.*` 替换成常量，Rollup 随即折叠 `if (USE_MOCK)` 分支并删除
 * 对应的 `import('@/mocks')`。若改成函数调用（如 bool(...)），常量传播就失效，
 * Mock 适配层会作为懒加载块留在生产产物里。
 */
export const USE_MOCK =
  env.VITE_USE_MOCK === undefined || env.VITE_USE_MOCK === ''
    ? env.MODE === 'test'
    : env.VITE_USE_MOCK === 'true' || env.VITE_USE_MOCK === '1';

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
