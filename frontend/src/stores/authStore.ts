import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { authBridge } from '@/api/authBridge';
import { authApi } from '@/api/auth';
import { getPersistBackend } from '@/lib/storage';
import { useNotificationStore } from './notificationStore';
import type { LoginByPasswordPayload, LoginBySmsPayload, Permission, RegisterPayload, UserProfile } from '@/api/types';

export type AuthStatus = 'guest' | 'loading' | 'authenticated';

interface AuthState {
  status: AuthStatus;
  user: UserProfile | null;
  accessToken: string | null;
  expiresAt: number | null;
  /** 会话过期提示（401 后置位，登录成功清除） */
  expireReason: 'expired' | 'revoked' | null;
  error: string | null;
  pending: boolean;
  /** 登录后回跳地址 */
  redirectTo: string | null;

  /** 是否存在可用会话（用于刷新后静默换新） */
  hasSession: boolean;

  setRedirect: (path: string | null) => void;
  loginByPassword: (payload: LoginByPasswordPayload) => Promise<UserProfile>;
  loginBySms: (payload: LoginBySmsPayload) => Promise<UserProfile>;
  register: (payload: RegisterPayload) => Promise<UserProfile>;
  logout: (options?: { silent?: boolean }) => Promise<void>;
  refreshSession: () => Promise<string | null>;
  bootstrap: () => Promise<void>;
  hasPermission: (permission: Permission) => boolean;
  patchUser: (patch: Partial<UserProfile>) => void;
  clearError: () => void;
}

/** 主题应用器：由 uiStore 注入，避免两个 store 循环依赖 */
let themeApplier: (() => void) | null = null;
// Late refresh responses must never resurrect a session after logout.
let sessionGeneration = 0;
let logoutPending = false;
let refreshFlight: Promise<string | null> | null = null;
function clearSessionCaches() {
  useNotificationStore.setState({ items: [], unreadCount: 0, latest: null, realtimeStatus: 'offline' });
}
export function registerThemeApplier(fn: () => void): void {
  themeApplier = fn;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      status: 'guest',
      user: null,
      accessToken: null,
      expiresAt: null,
      expireReason: null,
      error: null,
      pending: false,
      redirectTo: null,
      hasSession: false,

      setRedirect: (path) => set({ redirectTo: path }),
      clearError: () => set({ error: null }),

      async loginByPassword(payload) {
        set({ pending: true, error: null });
        try {
          const session = await authApi.loginByPassword(payload);
          authBridge.setSession(session.accessToken, session.user);
          set({
            status: 'authenticated',
            user: session.user,
            accessToken: session.accessToken,
            expiresAt: Date.now() + session.expiresIn * 1000,
            expireReason: null,
            pending: false,
            hasSession: true,
          });
          return session.user;
        } catch (error) {
          set({ pending: false, error: error instanceof Error ? error.message : '登录失败' });
          throw error;
        }
      },

      async loginBySms(payload) {
        set({ pending: true, error: null });
        try {
          const session = await authApi.loginBySms(payload);
          authBridge.setSession(session.accessToken, session.user);
          set({
            status: 'authenticated',
            user: session.user,
            accessToken: session.accessToken,
            expiresAt: Date.now() + session.expiresIn * 1000,
            expireReason: null,
            pending: false,
            hasSession: true,
          });
          return session.user;
        } catch (error) {
          set({ pending: false, error: error instanceof Error ? error.message : '登录失败' });
          throw error;
        }
      },

      async register(payload) {
        set({ pending: true, error: null });
        try {
          const session = await authApi.register(payload);
          authBridge.setSession(session.accessToken, session.user);
          set({
            status: 'authenticated',
            user: session.user,
            accessToken: session.accessToken,
            expiresAt: Date.now() + session.expiresIn * 1000,
            expireReason: null,
            pending: false,
            hasSession: true,
          });
          return session.user;
        } catch (error) {
          set({ pending: false, error: error instanceof Error ? error.message : '注册失败' });
          throw error;
        }
      },

      async logout() {
        sessionGeneration += 1;
        logoutPending = true;
        try {
          const request = authApi.logout();
          authBridge.clear();
          clearSessionCaches();
          set({ status: 'guest', user: null, accessToken: null, expiresAt: null, hasSession: false, expireReason: null, pending: false });
          try {
            await request;
          } catch {
            /* 登出失败不影响本地清理 */
          }
          authBridge.clear();
          set({
            status: 'guest',
            user: null,
            accessToken: null,
            expiresAt: null,
            hasSession: false,
            expireReason: null,
          });
        } finally {
          // 请求若同步抛错也必须解锁，否则后续所有静默刷新都会被判为「登出中」。
          logoutPending = false;
        }
      },

      /** 静默刷新：由 client 在 401 时回调（单飞由 client 保证） */
      async refreshSession() {
        if (logoutPending || !get().hasSession) return null;
        if (refreshFlight) return refreshFlight;
        const generation = sessionGeneration;
        refreshFlight = (async () => {
        try {
          const session = await authApi.refresh();
          if (generation !== sessionGeneration) return null;
          authBridge.setSession(session.accessToken, session.user);
          set({
            status: 'authenticated',
            user: session.user,
            accessToken: session.accessToken,
            expiresAt: Date.now() + session.expiresIn * 1000,
            expireReason: null,
          });
          return session.accessToken;
        } catch {
          if (generation !== sessionGeneration) return null;
          authBridge.clear();
          clearSessionCaches();
          set({
            status: 'guest',
            user: null,
            accessToken: null,
            expiresAt: null,
            hasSession: false,
            expireReason: 'expired',
          });
          return null;
        }
        })();
        try { return await refreshFlight; }
        finally { refreshFlight = null; }
      },

      /** 应用启动：尝试静默换取 Access Token（Refresh Token 在 httpOnly Cookie 中） */
      async bootstrap() {
        themeApplier?.();
        if (!get().hasSession) {
          set({ status: 'guest' });
          return;
        }
        set({ status: 'loading' });
        await get().refreshSession();
      },

      hasPermission(permission) {
        return get().user?.permissions.includes(permission) ?? false;
      },

      patchUser(patch) {
        const user = get().user;
        if (!user) return;
        const next = { ...user, ...patch };
        authBridge.setSession(get().accessToken, next);
        set({ user: next });
      },
    }),
    {
      name: 'vs-auth-hint',
      storage: createJSONStorage(() => getPersistBackend('local')),
      // 仅持久化「存在会话」这一非敏感标记；Access Token / 用户资料绝不落盘（文档 5.1 / 13.1）
      partialize: (state) => ({ hasSession: state.hasSession }) as Partial<AuthState>,
      merge: (persisted, current) => ({
        ...current,
        hasSession: Boolean((persisted as { hasSession?: boolean } | null)?.hasSession),
      }),
    },
  ),
);

// Access Token 只在内存中流转：把 bridge 的会话过期回调接到 store
authBridge.onRefresh(async () => {
  const token = await useAuthStore.getState().refreshSession();
  return token;
});
authBridge.onExpire(() => {
  // 登出过程中并发请求返回的 401 不该再改写状态：会话是主动结束的，不是过期。
  if (logoutPending) return;
  sessionGeneration += 1;
  authBridge.clear();
  clearSessionCaches();
  useAuthStore.setState({
    status: 'guest',
    user: null,
    accessToken: null,
    expiresAt: null,
    hasSession: false,
    expireReason: 'expired',
  });
});
