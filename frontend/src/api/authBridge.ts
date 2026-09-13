import type { Permission, UserProfile } from './types';

/**
 * 认证桥接层：避免 api/client 与 stores/authStore 之间的循环依赖。
 * Access Token 仅存内存（文档 5.1 / 13.1），页面刷新后由 refresh 静默换新。
 */
export interface AuthBridgeState {
  accessToken: string | null;
  user: UserProfile | null;
  permissions: Permission[];
}

const state: AuthBridgeState = {
  accessToken: null,
  user: null,
  permissions: [],
};

type RefreshHandler = () => Promise<string | null>;
type ExpireHandler = (reason: 'expired' | 'revoked') => void;

let refreshHandler: RefreshHandler | null = null;
let expireHandler: ExpireHandler | null = null;

export const authBridge = {
  getToken(): string | null {
    return state.accessToken;
  },
  getUser(): UserProfile | null {
    return state.user;
  },
  getPermissions(): Permission[] {
    return state.permissions;
  },
  setSession(accessToken: string | null, user: UserProfile | null): void {
    state.accessToken = accessToken;
    state.user = user;
    state.permissions = user?.permissions ?? [];
  },
  clear(): void {
    state.accessToken = null;
    state.user = null;
    state.permissions = [];
  },
  onRefresh(handler: RefreshHandler): void {
    refreshHandler = handler;
  },
  onExpire(handler: ExpireHandler): void {
    expireHandler = handler;
  },
  /** 由 client 在收到 401 时调用，单飞（single-flight）由调用方保证 */
  async refresh(): Promise<string | null> {
    if (!refreshHandler) return null;
    return refreshHandler();
  },
  expire(reason: 'expired' | 'revoked' = 'expired'): void {
    expireHandler?.(reason);
  },
};
