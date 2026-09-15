import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { authApi } from '@/api/auth';
import { authBridge } from '@/api/authBridge';
import { videoApi } from '@/api/videos';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { queryClient } from '@/app/queryClient';
import { useDeleteComment } from '@/hooks/useApi';
import { JsonLd } from '@/components/ui/JsonLd';
import { ReportDialog } from '@/components/video/ReportDialog';
import LoginPage from '@/pages/auth/LoginPage';
import ShortsPage from '@/pages/ShortsPage';
import type { AppNotification } from '@/api/types';

const notification: AppNotification = {
  id: 1,
  type: 'LIKE',
  title: '测试通知',
  content: '内容',
  actor: null,
  targetType: 'VIDEO',
  targetId: 1,
  isRead: false,
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  authBridge.clear();
  useAuthStore.setState({ status: 'guest', user: null, hasSession: false, pending: false, error: null });
});
afterEach(() => vi.restoreAllMocks());

describe('测试报告缺陷回归', () => {
  it('JsonLd preserves text without allowing script terminators', () => {
    const data = { name: '</script><script>alert(1)</script>' };
    const { container } = render(<JsonLd data={data} />);
    expect(container.querySelectorAll('script')).toHaveLength(1);
    const text = container.querySelector('script')!.textContent!;
    expect(text).not.toContain('<');
    expect(JSON.parse(text)).toEqual(data);
  });

  it('logout immediately clears cached private data and ignores an in-flight refresh', async () => {
    const session = await authApi.loginByPassword({ account: 'laowang', password: '123456' });
    useAuthStore.setState({ user: session.user, accessToken: session.accessToken, status: 'authenticated', hasSession: true });
    authBridge.setSession(session.accessToken, session.user);
    queryClient.setQueryData(['messages', 'private'], ['secret']);
    let release!: (value: typeof session) => void;
    vi.spyOn(authApi, 'refresh').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    vi.spyOn(authApi, 'logout').mockResolvedValue({ success: true });
    const refresh = useAuthStore.getState().refreshSession();
    await useAuthStore.getState().logout();
    release(session);
    await refresh;
    expect(useAuthStore.getState().status).toBe('guest');
    expect(useAuthStore.getState().hasSession).toBe(false);
    expect(authBridge.getToken()).toBeNull();
    expect(queryClient.getQueryData(['messages', 'private'])).toBeUndefined();
  });

  it('password login uses a semantic form that submits exactly once', async () => {
    const login = vi.spyOn(useAuthStore.getState(), 'loginByPassword').mockRejectedValue(new Error('验证提交'));
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: '账号密码' }));
    fireEvent.change(screen.getByRole('textbox', { name: '账号' }), { target: { value: 'laowang' } });
    fireEvent.change(screen.getByLabelText('密码', { exact: true }), { target: { value: '123456' } });
    const form = screen.getByLabelText('密码', { exact: true }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('密码', { exact: true })).toHaveAttribute('name', 'password');
  });

  it('deleting a reply invalidates its cached tree and parent video', async () => {
    vi.spyOn(videoApi, 'deleteComment').mockResolvedValue({ success: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['comments', 'replies', 1, { page: 1 }], { items: [{ id: 2 }] });
    client.setQueryData(['comments', 7, { sort: 'hot' }], { items: [{ id: 1 }] });
    client.setQueryData(['videos', 'detail', 7], {});
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useDeleteComment(7), { wrapper });
    await act(() => hook.result.current.mutateAsync(2));
    expect(client.getQueryState(['comments', 'replies', 1, { page: 1 }])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['videos', 'detail', 7])?.isInvalidated).toBe(true);
  });

  it('report form submits both description and contact', async () => {
    const report = vi.spyOn(videoApi, 'report').mockResolvedValue({ reportId: 42, status: 'PENDING' });
    render(<ReportDialog open onClose={() => undefined} targetType="VIDEO" targetId={1} />);
    fireEvent.click(screen.getByRole('button', { name: '其他' }));
    fireEvent.change(screen.getByRole('textbox', { name: '举报补充说明' }), { target: { value: '第 3 秒内容异常' } });
    fireEvent.change(screen.getByRole('textbox', { name: '举报联系方式' }), { target: { value: 'qa@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '提交举报' }));
    await waitFor(() => expect(report).toHaveBeenCalledWith(expect.objectContaining({ description: '第 3 秒内容异常\n联系方式：qa@example.com' })));
  });

  it('logout while a refresh is starting rejects the refresh and empties notification state', async () => {
    const session = await authApi.loginByPassword({ account: 'laowang', password: '123456' });
    useAuthStore.setState({ user: session.user, accessToken: session.accessToken, status: 'authenticated', hasSession: true });
    authBridge.setSession(session.accessToken, session.user);
    useNotificationStore.setState({ items: [notification], unreadCount: 3, latest: notification });
    let releaseLogout!: (value: { success: boolean }) => void;
    vi.spyOn(authApi, 'logout').mockImplementation(() => new Promise((resolve) => { releaseLogout = resolve; }));
    const refresh = vi.spyOn(authApi, 'refresh');
    const logout = useAuthStore.getState().logout();
    // 登出进行中：新的静默刷新必须直接放弃，不能把会话带回来。
    expect(await useAuthStore.getState().refreshSession()).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    releaseLogout({ success: true });
    await logout;
    expect(useAuthStore.getState().status).toBe('guest');
    expect(useNotificationStore.getState().unreadCount).toBe(0);
    expect(useNotificationStore.getState().items).toHaveLength(0);
    expect(useNotificationStore.getState().latest).toBeNull();
    // 登出结束后刷新能力恢复（logoutPending 必须被释放，否则会话再也无法刷新）。
    expect(authBridge.getToken()).toBeNull();
  });

  it('shorts deep link keeps showing the requested video when its detail resolves late', async () => {
    const feed = await videoApi.shorts({ cursor: null, pageSize: 6 });
    expect(feed.items.length).toBeGreaterThanOrEqual(3);
    const target = feed.items[2];
    const first = feed.items[0];
    const realDetail = videoApi.detail;
    let release!: (value: Awaited<ReturnType<typeof videoApi.detail>>) => void;
    const deferred = new Promise<Awaited<ReturnType<typeof videoApi.detail>>>((resolve) => { release = resolve; });
    const detail = vi.spyOn(videoApi, 'detail').mockReturnValue(deferred);
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/shorts?v=${target.id}`]}>
          <ShortsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // 推荐流先到：深链按流内位置定位到第 3 条。
    await waitFor(() => expect(screen.getByText(target.title)).toBeInTheDocument());
    await waitFor(() => expect(document.body.textContent).toContain(`3 / ${feed.items.length}`));
    // 详情后到：列表顺序不能被重排，否则当前视频会悄悄换成第一条。
    release(await realDetail(target.id));
    await waitFor(() => expect(detail).toHaveBeenCalledWith(target.id));
    await waitFor(() => expect(screen.getByText(target.title)).toBeInTheDocument());
    expect(screen.queryByText(first.title)).not.toBeInTheDocument();
  });
});
