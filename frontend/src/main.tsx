import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { useAuthStore, usePlayerStore, useUiStore } from './stores';
import './index.css';

/**
 * 在首屏渲染前完成持久化状态回填。
 *
 * 这一步很关键：会话还原（/auth/refresh 静默换新）依赖 authStore 中持久化的 hasSession 标记，
 * 若在 rehydrate 完成前渲染，守卫会误判为游客并把用户重定向到登录页。
 */
async function hydrateStores(): Promise<void> {
  await Promise.all([
    useAuthStore.persist.hasHydrated() ? Promise.resolve() : useAuthStore.persist.rehydrate(),
    useUiStore.persist.hasHydrated() ? Promise.resolve() : useUiStore.persist.rehydrate(),
    usePlayerStore.persist.hasHydrated() ? Promise.resolve() : usePlayerStore.persist.rehydrate(),
  ]);
  // 回填完成后立即应用主题，避免闪烁（index.html 内联脚本已做首屏预置）
  useUiStore.getState().applyTheme();
  /*
   * 首屏渲染前完成会话还原：真实环境用 httpOnly Cookie 中的 Refresh Token 静默换新 Access Token。
   * 必须在 render 之前完成，否则路由守卫会在 status 仍为 loading/guest 时把已登录用户重定向到登录页。
   */
  await useAuthStore.getState().bootstrap();
}

const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 挂载节点');

if (import.meta.env.DEV) {
  // 开发期诊断探针：便于在浏览器控制台/自动化脚本中检查会话还原链路
  (window as unknown as Record<string, unknown>).__vs_debug = {
    hydrate: hydrateStores,
    auth: () => useAuthStore.getState(),
    hasHydrated: () => useAuthStore.persist.hasHydrated(),
  };
}

void hydrateStores().finally(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
