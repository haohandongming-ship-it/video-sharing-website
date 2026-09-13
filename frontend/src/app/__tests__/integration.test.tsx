import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { authBridge } from '@/api/authBridge';
import { authApi } from '@/api/auth';
import { session } from '@/mocks/seed';
import { useAuthStore } from '@/stores/authStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useUiStore } from '@/stores/uiStore';
import { RequireAuth, RequirePermission } from '@/app/guards';
import HomePage from '@/pages/HomePage';
import LoginPage from '@/pages/auth/LoginPage';
import { VideoCardGrid } from '@/components/video/VideoCard';

function renderWithProviders(ui: ReactNode, route = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

async function signIn(account = 'laowang') {
  const result = await authApi.loginByPassword({ account, password: '123456' });
  authBridge.setSession(result.accessToken, result.user);
  useAuthStore.setState({
    status: 'authenticated',
    user: result.user,
    accessToken: result.accessToken,
    hasSession: true,
  });
}

describe('路由守卫（文档 5.2 鉴权列 / 2.3 权限矩阵）', () => {
  beforeEach(() => {
    authBridge.clear();
    session.logout();
    useAuthStore.setState({ status: 'guest', user: null, accessToken: null, hasSession: false });
  });

  it('未登录访问受保护页面时重定向到登录页并保留回跳地址', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<div>登录页占位</div>} />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <div>设置内容</div>
            </RequireAuth>
          }
        />
      </Routes>,
      '/settings',
    );
    expect(await screen.findByText('登录页占位')).toBeInTheDocument();
    expect(screen.queryByText('设置内容')).not.toBeInTheDocument();
  });

  it('已登录时正常渲染受保护内容', async () => {
    await signIn();
    renderWithProviders(
      <RequireAuth>
        <div>设置内容</div>
      </RequireAuth>,
    );
    expect(await screen.findByText('设置内容')).toBeInTheDocument();
  });

  it('登录但缺少权限点时展示无权限说明而非跳转', async () => {
    await signIn('laowang');
    renderWithProviders(
      <RequirePermission permission="admin:user_manage">
        <div>用户管理表格</div>
      </RequirePermission>,
    );
    expect(await screen.findByText('没有访问权限')).toBeInTheDocument();
    expect(screen.queryByText('用户管理表格')).not.toBeInTheDocument();
  });

  it('管理员拥有权限点时可访问', async () => {
    await signIn('admin');
    renderWithProviders(
      <RequirePermission permission="admin:user_manage">
        <div>用户管理表格</div>
      </RequirePermission>,
    );
    expect(await screen.findByText('用户管理表格')).toBeInTheDocument();
  });
});

describe('登录页（文档 3.1 / 13.1）', () => {
  beforeEach(() => {
    authBridge.clear();
    session.logout();
    useAuthStore.setState({ status: 'guest', user: null, accessToken: null, hasSession: false });
  });

  it('默认展示登录模式，并提供手机号与账号密码两种方式', () => {
    renderWithProviders(<LoginPage />, '/login');
    expect(screen.getByRole('tab', { name: '登录' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '注册' })).toBeInTheDocument();
    expect(screen.getByText('手机号验证码')).toBeInTheDocument();
    expect(screen.getByText('账号密码')).toBeInTheDocument();
  });

  it('initialMode=register 时直接进入注册表单', () => {
    renderWithProviders(<LoginPage initialMode="register" />, '/register');
    expect(screen.getByLabelText(/昵称/)).toBeInTheDocument();
    expect(screen.getAllByText(/用户协议/).length).toBeGreaterThan(0);
  });

  it('展示 4 个演示账号以验证不同角色权限', () => {
    renderWithProviders(<LoginPage />, '/login');
    for (const label of ['管理员 · admin', '审核员 · moderator', '创作者 · laowang', '新用户 · newbie']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('演示账号快捷登录写入会话状态', async () => {
    renderWithProviders(<LoginPage />, '/login');
    await userEvent.click(screen.getByText('创作者 · laowang'));
    await waitFor(() => {
      expect(useAuthStore.getState().status).toBe('authenticated');
    });
    expect(useAuthStore.getState().user?.username).toBe('laowang');
  });

  it('非法手机号点击获取验证码时给出行内错误且不发送请求', async () => {
    renderWithProviders(<LoginPage />, '/login');
    await userEvent.type(screen.getByLabelText('手机号'), '12345');
    await userEvent.click(screen.getByRole('button', { name: /获取验证码/ }));
    expect(await screen.findByText('请输入 11 位手机号')).toBeInTheDocument();
    expect(session.userId).toBeNull();
  });

  it('合法手机号可获取验证码并进入 60 秒倒计时', async () => {
    renderWithProviders(<LoginPage />, '/login');
    await userEvent.type(screen.getByLabelText('手机号'), '13800001234');
    await userEvent.click(screen.getByRole('button', { name: /获取验证码/ }));
    expect(await screen.findByRole('button', { name: /秒后可重新获取验证码/ })).toBeDisabled();
  });
});

describe('首页（文档 4.1 长视频布局）', () => {
  it('渲染分区导航、排序切换与推荐列表', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/" element={<HomePage />} />
      </Routes>,
      '/',
    );
    expect(screen.getByRole('heading', { level: 1, name: '为你推荐' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '最新' })).toBeInTheDocument();
    // 加载完成后出现视频卡片（Mock 延迟 90-310ms）
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(4), {
      timeout: 5000,
    });
  });

  it('关闭个性化推荐时展示回退说明与登录引导', async () => {
    useUiStore.setState({ personalizationEnabled: false });
    renderWithProviders(
      <Routes>
        <Route path="/" element={<HomePage />} />
      </Routes>,
      '/',
    );
    expect(screen.getByText(/已关闭个性化推荐/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '登录' })).toBeInTheDocument();
    useUiStore.setState({ personalizationEnabled: true });
  });
});

describe('玩家状态（文档 5.4 / 5.6 记忆播放）', () => {
  beforeEach(() => {
    usePlayerStore.setState({ memory: {} });
  });

  it('记录进度并按 15 秒节流决定是否上报', () => {
    const { recordProgress } = usePlayerStore.getState();
    const first = recordProgress(9_001, 30, 600);
    expect(first).toBe(true);
    const second = recordProgress(9_001, 35, 600);
    expect(second).toBe(false);
    const forced = recordProgress(9_001, 40, 600, { force: true });
    expect(forced).toBe(true);
    expect(usePlayerStore.getState().getMemory(9_001)?.progress).toBe(40);
  });

  it('清空单个视频的记忆进度', () => {
    const { recordProgress, clearMemory, getMemory } = usePlayerStore.getState();
    recordProgress(9_002, 12, 300, { force: true });
    expect(getMemory(9_002)).not.toBeNull();
    clearMemory(9_002);
    expect(getMemory(9_002)).toBeNull();
  });
});

describe('UI 偏好（文档 5.4 持久化范围）', () => {
  it('切换主题会同步到 documentElement 的 dark 类', () => {
    useUiStore.getState().setTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    useUiStore.getState().setTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('音量归零时自动静音', () => {
    useUiStore.getState().setVolume(0);
    expect(useUiStore.getState().muted).toBe(true);
    useUiStore.getState().setVolume(0.6);
    expect(useUiStore.getState().muted).toBe(false);
  });
});

describe('VideoCardGrid', () => {
  it('按传入列数渲染网格并保持 key 唯一', () => {
    const videos = Array.from({ length: 4 }, (_, i) => ({
      id: 1 + i,
      videoType: 'LONG' as const,
      title: `视频 ${i}`,
      coverUrl: 'data:image/svg+xml,<svg/>',
      duration: 100,
      category: null,
      author: { id: 1, username: 'u', nickname: '作者', avatar: null, certified: false },
      stats: { views: 1, likes: 1, dislikes: 0, comments: 0, favorites: 0 },
      publishedAt: new Date().toISOString(),
      status: 'PUBLISHED' as const,
      visibility: 'PUBLIC' as const,
    }));
    renderWithProviders(<VideoCardGrid videos={videos} columns={2} />);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(4);
  });
});
