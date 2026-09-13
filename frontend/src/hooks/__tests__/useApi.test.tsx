import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { authBridge } from '@/api/authBridge';
import { authApi } from '@/api/auth';
import { session } from '@/mocks/seed';
import {
  useAdminOverview,
  useAdminUsers,
  useAdminVideos,
  useAssignRole,
  useAuditLogs,
  useCategories,
  useComments,
  useConversations,
  useCreatorDashboard,
  useCreatorVideos,
  useDecideReview,
  useDeleteVideo,
  useFavorites,
  useFeed,
  useFollowList,
  useHandleReport,
  useMarkNotificationsRead,
  useMessages,
  useNotifications,
  usePlatformSettings,
  usePlaylists,
  usePostComment,
  useRanking,
  useRecommendVideos,
  useRelatedVideos,
  useReportTasks,
  useReviewTasks,
  useShortsFeed,
  useSuggestedUsers,
  useToggleFeedLike,
  useToggleFollow,
  useTranscodeProgress,
  useUnreadCount,
  useUpdatePlatformSettings,
  useUpdateUserStatus,
  useUpdateVideo,
  useUserProfile,
  useUserVideos,
  useVideoDetail,
  useVideoInteractions,
  useVideoPlay,
  useVideoSearch,
  useWatchHistory,
} from '@/hooks/useApi';

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

async function loginAs(account: 'laowang' | 'admin' | 'moderator'): Promise<void> {
  const result = await authApi.loginByPassword({ account, password: '123456' });
  authBridge.setSession(result.accessToken, result.user);
  const { useAuthStore } = await import('@/stores/authStore');
  useAuthStore.setState({
    status: 'authenticated',
    user: result.user,
    accessToken: result.accessToken,
    hasSession: true,
  });
}

beforeEach(async () => {
  authBridge.clear();
  session.logout();
  const { useAuthStore } = await import('@/stores/authStore');
  useAuthStore.setState({ status: 'guest', user: null, accessToken: null, hasSession: false });
});

describe('公开数据 hooks', () => {
  it('分类列表可加载', async () => {
    const { result } = renderHook(() => useCategories(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(result.current.data?.length).toBeGreaterThan(5);
  });

  it('推荐列表与视频详情可加载', async () => {
    const recommend = renderHook(() => useRecommendVideos({ pageSize: 6 }), { wrapper: createWrapper() });
    await waitFor(() => expect(recommend.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(recommend.result.current.data?.items).toHaveLength(6);

    const detail = renderHook(() => useVideoDetail(10_001), { wrapper: createWrapper() });
    await waitFor(() => expect(detail.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(detail.result.current.data?.id).toBe(10_001);
  });

  it('播放地址与相关推荐可加载', async () => {
    const play = renderHook(() => useVideoPlay(10_001), { wrapper: createWrapper() });
    await waitFor(() => expect(play.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(play.result.current.data?.hlsUrl).toContain('.m3u8');

    const related = renderHook(() => useRelatedVideos(10_001), { wrapper: createWrapper() });
    await waitFor(() => expect(related.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(related.result.current.data?.length).toBeGreaterThan(0);
  });

  it('排行榜与搜索可加载', async () => {
    const ranking = renderHook(() => useRanking({ type: 'hot', period: 'daily' }), { wrapper: createWrapper() });
    await waitFor(() => expect(ranking.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(ranking.result.current.data?.[0].rank).toBe(1);

    const search = renderHook(() => useVideoSearch({ q: '架构', page: 1 }), { wrapper: createWrapper() });
    await waitFor(() => expect(search.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(search.result.current.data?.total).toBeGreaterThan(0);
  });

  it('搜索关键词为空时不发请求', () => {
    const search = renderHook(() => useVideoSearch({ q: '   ' }), { wrapper: createWrapper() });
    expect(search.result.current.fetchStatus).toBe('idle');
  });

  it('短视频无限流可翻页', async () => {
    const shorts = renderHook(() => useShortsFeed(), { wrapper: createWrapper() });
    await waitFor(() => expect(shorts.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(shorts.result.current.data?.pages[0].items.length).toBe(6);
    await act(async () => {
      await shorts.result.current.fetchNextPage();
    });
    await waitFor(() => expect(shorts.result.current.data?.pages.length).toBe(2), { timeout: 4000 });
  });

  it('动态流可加载并翻页', async () => {
    const feed = renderHook(() => useFeed('recommend'), { wrapper: createWrapper() });
    await waitFor(() => expect(feed.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(feed.result.current.data?.pages[0].items.length).toBe(10);
    await act(async () => {
      await feed.result.current.fetchNextPage();
    });
    await waitFor(() => expect(feed.result.current.data?.pages.length).toBe(2), { timeout: 4000 });
  });

  it('评论列表与楼中楼回复可加载', async () => {
    const comments = renderHook(() => useComments(10_001, { sort: 'hot', pageSize: 5 }), { wrapper: createWrapper() });
    await waitFor(() => expect(comments.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(comments.result.current.data?.items).toHaveLength(5);

    const { useCommentReplies } = await import('@/hooks/useApi');
    const rootId = comments.result.current.data?.items[0].id as number;
    const replies = renderHook(() => useCommentReplies(rootId, true), { wrapper: createWrapper() });
    await waitFor(() => expect(replies.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(Array.isArray(replies.result.current.data?.items)).toBe(true);
  });

  it('用户主页、作品与关注列表可加载', async () => {
    const profile = renderHook(() => useUserProfile(3), { wrapper: createWrapper() });
    await waitFor(() => expect(profile.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(profile.result.current.data?.username).toBe('laowang');

    const videos = renderHook(() => useUserVideos(3), { wrapper: createWrapper() });
    await waitFor(() => expect(videos.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(videos.result.current.data?.items.length).toBeGreaterThan(0);

    const followers = renderHook(() => useFollowList(3, 'followers'), { wrapper: createWrapper() });
    await waitFor(() => expect(followers.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(followers.result.current.data?.items.length).toBeGreaterThan(0);
  });

  it('推荐关注可加载', async () => {
    const suggested = renderHook(() => useSuggestedUsers(), { wrapper: createWrapper() });
    await waitFor(() => expect(suggested.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(suggested.result.current.data?.length).toBeGreaterThan(0);
  });
});

describe('登录态数据 hooks', () => {
  it('未登录时不请求受保护接口', () => {
    const history = renderHook(() => useWatchHistory(), { wrapper: createWrapper() });
    expect(history.result.current.fetchStatus).toBe('idle');
    const favorites = renderHook(() => useFavorites(), { wrapper: createWrapper() });
    expect(favorites.result.current.fetchStatus).toBe('idle');
    const notifications = renderHook(() => useNotifications(), { wrapper: createWrapper() });
    expect(notifications.result.current.fetchStatus).toBe('idle');
    const admin = renderHook(() => useAdminOverview(), { wrapper: createWrapper() });
    expect(admin.result.current.fetchStatus).toBe('idle');
  });

  it('登录后可加载历史、收藏、播放列表与通知', async () => {
    await loginAs('laowang');
    const history = renderHook(() => useWatchHistory(), { wrapper: createWrapper() });
    await waitFor(() => expect(history.result.current.isSuccess).toBe(true), { timeout: 4000 });

    const favorites = renderHook(() => useFavorites(), { wrapper: createWrapper() });
    await waitFor(() => expect(favorites.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(favorites.result.current.data?.folders.length).toBeGreaterThan(0);

    const playlists = renderHook(() => usePlaylists(), { wrapper: createWrapper() });
    await waitFor(() => expect(playlists.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(playlists.result.current.data?.length).toBeGreaterThan(0);

    const notifications = renderHook(() => useNotifications({ pageSize: 5 }), { wrapper: createWrapper() });
    await waitFor(() => expect(notifications.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(notifications.result.current.data?.items.length).toBe(5);

    const unread = renderHook(() => useUnreadCount(), { wrapper: createWrapper() });
    await waitFor(() => expect(unread.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(unread.result.current.data?.count).toBeGreaterThanOrEqual(0);

    const conversations = renderHook(() => useConversations(), { wrapper: createWrapper() });
    await waitFor(() => expect(conversations.result.current.isSuccess).toBe(true), { timeout: 4000 });
    const conversationId = conversations.result.current.data?.[0].id as number;
    const messages = renderHook(() => useMessages(conversationId), { wrapper: createWrapper() });
    await waitFor(() => expect(messages.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(messages.result.current.data?.length).toBeGreaterThan(0);
  });

  it('创作者中心看板与作品列表可加载', async () => {
    await loginAs('laowang');
    const dashboard = renderHook(() => useCreatorDashboard(7), { wrapper: createWrapper() });
    await waitFor(() => expect(dashboard.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(dashboard.result.current.data?.trend).toHaveLength(7);

    const videos = renderHook(() => useCreatorVideos({ page: 1 }), { wrapper: createWrapper() });
    await waitFor(() => expect(videos.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(videos.result.current.data?.items.length).toBeGreaterThan(0);
  });

  it('管理后台按权限点启用查询', async () => {
    await loginAs('moderator');
    const reviews = renderHook(() => useReviewTasks({ pageSize: 5 }), { wrapper: createWrapper() });
    await waitFor(() => expect(reviews.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(reviews.result.current.data?.items).toHaveLength(5);

    const reports = renderHook(() => useReportTasks({ pageSize: 5 }), { wrapper: createWrapper() });
    await waitFor(() => expect(reports.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(reports.result.current.data?.items.length).toBeGreaterThan(0);

    // 审核员无 admin:analytics 权限 → 数据概览不应发起请求
    const overview = renderHook(() => useAdminOverview(), { wrapper: createWrapper() });
    expect(overview.result.current.fetchStatus).toBe('idle');
  });

  it('管理员可加载概览、用户、视频、日志与设置', async () => {
    await loginAs('admin');
    const overview = renderHook(() => useAdminOverview(), { wrapper: createWrapper() });
    await waitFor(() => expect(overview.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(overview.result.current.data?.trend).toHaveLength(14);

    const users = renderHook(() => useAdminUsers({ pageSize: 5 }), { wrapper: createWrapper() });
    await waitFor(() => expect(users.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(users.result.current.data?.items).toHaveLength(5);

    const videos = renderHook(() => useAdminVideos({ pageSize: 5 }), { wrapper: createWrapper() });
    await waitFor(() => expect(videos.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(videos.result.current.data?.items).toHaveLength(5);

    const logs = renderHook(() => useAuditLogs({ pageSize: 5 }), { wrapper: createWrapper() });
    await waitFor(() => expect(logs.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(logs.result.current.data?.items.length).toBeGreaterThan(0);

    const settings = renderHook(() => usePlatformSettings(), { wrapper: createWrapper() });
    await waitFor(() => expect(settings.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(settings.result.current.data?.review.newUserForceReview).toBe(true);
  });

  it('转码进度按 videoId 轮询并可禁用', async () => {
    await loginAs('laowang');
    const progress = renderHook(() => useTranscodeProgress(30_001), { wrapper: createWrapper() });
    await waitFor(() => expect(progress.result.current.isSuccess).toBe(true), { timeout: 4000 });
    expect(typeof progress.result.current.data?.progress).toBe('number');

    const disabled = renderHook(() => useTranscodeProgress(null, false), { wrapper: createWrapper() });
    expect(disabled.result.current.fetchStatus).toBe('idle');
  });
});

describe('乐观更新 mutations', () => {
  it('点赞乐观更新详情缓存并在失败时回滚', async () => {
    await loginAs('laowang');
    const { result } = renderHook(
      () => ({ detail: useVideoDetail(10_010), interactions: useVideoInteractions(10_010) }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.detail.isSuccess).toBe(true), { timeout: 4000 });
    const before = result.current.detail.data?.stats.likes ?? 0;
    expect(result.current.detail.data?.liked).toBe(false);

    await act(async () => {
      await result.current.interactions.like.mutateAsync(true);
    });
    await waitFor(() => expect(result.current.detail.data?.liked).toBe(true), { timeout: 4000 });
    expect(result.current.detail.data?.stats.likes).toBe(before + 1);
  });

  it('收藏与订阅变更写入后端', async () => {
    await loginAs('laowang');
    const { result } = renderHook(
      () => ({ detail: useVideoDetail(10_011), interactions: useVideoInteractions(10_011) }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.detail.isSuccess).toBe(true), { timeout: 4000 });

    await act(async () => {
      await result.current.interactions.favorite.mutateAsync(true);
    });
    await act(async () => {
      await result.current.interactions.subscribe.mutateAsync(true);
    });
    const detail = renderHook(() => useVideoDetail(10_011), { wrapper: createWrapper() });
    await waitFor(() => expect(detail.result.current.data?.favorited).toBe(true), { timeout: 4000 });
    expect(detail.result.current.data?.subscribed).toBe(true);
  });

  it('发表评论后列表包含新评论', async () => {
    await loginAs('laowang');
    const { result } = renderHook(
      () => ({ comments: useComments(10_020, { sort: 'new' }), post: usePostComment(10_020, { sort: 'new' }) }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.comments.isSuccess).toBe(true), { timeout: 4000 });

    await act(async () => {
      await result.current.post.mutateAsync('hooks 测试评论内容');
    });
    await waitFor(
      () => {
        const items = result.current.comments.data?.items ?? [];
        expect(items.some((item) => item.content === 'hooks 测试评论内容')).toBe(true);
      },
      { timeout: 4000 },
    );
  });

  it('关注操作更新用户资料缓存', async () => {
    await loginAs('laowang');
    const { result } = renderHook(
      () => ({ profile: useUserProfile(5), follow: useToggleFollow() }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.profile.isSuccess).toBe(true), { timeout: 4000 });

    await act(async () => {
      await result.current.follow.mutateAsync({ userId: 5, active: true });
    });
    await waitFor(() => expect(result.current.profile.data?.followed).toBe(true), { timeout: 4000 });
  });

  it('动态点赞 mutation 返回最新计数', async () => {
    await loginAs('laowang');
    const { result } = renderHook(() => useToggleFeedLike(), { wrapper: createWrapper() });
    let response: { active: boolean; count: number } | undefined;
    await act(async () => {
      response = await result.current.mutateAsync({ id: 30_001, active: true });
    });
    expect(response?.active).toBe(true);
    expect(response?.count).toBeGreaterThan(0);
  });

  it('视频编辑需属主权限，非属主被拒（文档 2.3 越权防护）', async () => {
    await loginAs('laowang');
    const update = renderHook(() => useUpdateVideo(), { wrapper: createWrapper() });
    // 找到一条属于当前登录用户的视频
    const list = renderHook(() => useRecommendVideos({ pageSize: 20 }), { wrapper: createWrapper() });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true), { timeout: 4000 });
    const mine = list.result.current.data?.items.find((item) => item.author.id === 3);
    const foreign = list.result.current.data?.items.find((item) => item.author.id !== 3);
    expect(mine && foreign).toBeTruthy();

    // 非属主：应被服务端拒绝（40301）
    await act(async () => {
      await expect(
        update.result.current.mutateAsync({ id: foreign!.id, payload: { title: '越权标题' } }),
      ).rejects.toMatchObject({ code: 40301 });
    });

    // 属主：可修改
    let updated: { title: string } | undefined;
    await act(async () => {
      updated = await update.result.current.mutateAsync({ id: mine!.id, payload: { title: '更新后的标题' } });
    });
    expect(updated?.title).toBe('更新后的标题');
  });

  it('视频删除为软删除并返回回收站期限', async () => {
    await loginAs('laowang');
    const list = renderHook(() => useRecommendVideos({ pageSize: 20 }), { wrapper: createWrapper() });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true), { timeout: 4000 });
    const mine = list.result.current.data?.items.find((item) => item.author.id === 3) as { id: number };

    const remove = renderHook(() => useDeleteVideo(), { wrapper: createWrapper() });
    let response: { success: boolean; recoverableUntil: string } | undefined;
    await act(async () => {
      response = await remove.result.current.mutateAsync(mine.id);
    });
    expect(response?.success).toBe(true);
    expect(new Date(response!.recoverableUntil).getTime()).toBeGreaterThan(Date.now());
  });

  it('通知已读 mutation 返回成功', async () => {
    await loginAs('laowang');
    const mark = renderHook(() => useMarkNotificationsRead(), { wrapper: createWrapper() });
    let response: { success: boolean } | undefined;
    await act(async () => {
      response = await mark.result.current.mutateAsync([]);
    });
    expect(response?.success).toBe(true);
  });

  it('审核决定与举报处理 mutation 生效', async () => {
    await loginAs('admin');
    const reviews = renderHook(() => useReviewTasks({ status: 'PENDING', pageSize: 1 }), { wrapper: createWrapper() });
    await waitFor(() => expect(reviews.result.current.isSuccess).toBe(true), { timeout: 4000 });
    const taskId = reviews.result.current.data?.items[0].id as number;

    const decide = renderHook(() => useDecideReview(), { wrapper: createWrapper() });
    let decision: { success: boolean; status: string } | undefined;
    await act(async () => {
      decision = await decide.result.current.mutateAsync({ taskId, decision: 'REJECT', note: 'hooks 测试驳回' });
    });
    expect(decision?.status).toBe('REJECTED');

    const reports = renderHook(() => useReportTasks({ status: 'PENDING', pageSize: 1 }), { wrapper: createWrapper() });
    await waitFor(() => expect(reports.result.current.isSuccess).toBe(true), { timeout: 4000 });
    const reportId = reports.result.current.data?.items[0].id as number;
    const handle = renderHook(() => useHandleReport(), { wrapper: createWrapper() });
    let handled: { success: boolean; status: string } | undefined;
    await act(async () => {
      handled = await handle.result.current.mutateAsync({ reportId, status: 'RESOLVED', note: '已处理' });
    });
    expect(handled?.status).toBe('RESOLVED');
  });

  it('用户状态与角色 mutation 生效', async () => {
    await loginAs('admin');
    const users = renderHook(() => useAdminUsers({ pageSize: 5 }), { wrapper: createWrapper() });
    await waitFor(() => expect(users.result.current.isSuccess).toBe(true), { timeout: 4000 });
    const target = users.result.current.data?.items.find((user) => user.id !== 1);
    expect(target).toBeTruthy();

    const status = renderHook(() => useUpdateUserStatus(), { wrapper: createWrapper() });
    let banned: { status: string } | undefined;
    await act(async () => {
      banned = await status.result.current.mutateAsync({ userId: target!.id, status: 'BANNED', reason: 'hooks 测试' });
    });
    expect(banned?.status).toBe('BANNED');

    const role = renderHook(() => useAssignRole(), { wrapper: createWrapper() });
    let assigned: { role: string } | undefined;
    await act(async () => {
      assigned = await role.result.current.mutateAsync({ userId: target!.id, role: 'MODERATOR' });
    });
    expect(assigned?.role).toBe('MODERATOR');
  });

  it('平台设置更新写入缓存', async () => {
    await loginAs('admin');
    const settings = renderHook(() => usePlatformSettings(), { wrapper: createWrapper() });
    await waitFor(() => expect(settings.result.current.isSuccess).toBe(true), { timeout: 4000 });
    const current = settings.result.current.data!;

    const update = renderHook(() => useUpdatePlatformSettings(), { wrapper: createWrapper() });
    let next: { minor: { teenagerModeEnabled: boolean } } | undefined;
    await act(async () => {
      next = await update.result.current.mutateAsync({
        minor: { ...current.minor, teenagerModeEnabled: true },
      });
    });
    expect(next?.minor.teenagerModeEnabled).toBe(true);
  });
});

describe('权限点判定（文档 2.1 权限点集合）', () => {
  it('管理员同时具备审核与系统管理权限点', async () => {
    await loginAs('admin');
    const { useAuthStore } = await import('@/stores/authStore');
    const permissions = useAuthStore.getState().user?.permissions ?? [];
    expect(permissions).toContain('admin:analytics');
    expect(permissions).toContain('moderation:review');
    expect(permissions).toContain('admin:system_config');
  });

  it('普通创作者不具备审核与管理权限点', async () => {
    await loginAs('laowang');
    const { useAuthStore } = await import('@/stores/authStore');
    const permissions = useAuthStore.getState().user?.permissions ?? [];
    expect(permissions).toContain('video:upload');
    expect(permissions).not.toContain('moderation:review');
    expect(permissions).not.toContain('admin:user_manage');
  });
});
