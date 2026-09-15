/**
 * 领域 hooks：TanStack Query 封装（服务端状态）
 * 组件只依赖 hooks，不直接调用 api 层，便于统一处理缓存与失效策略。
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { adminApi } from '@/api/admin';
import { categoryApi, videoApi, type SearchResult } from '@/api/videos';
import { feedApi, type FeedQuery } from '@/api/feeds';
import { creatorApi, userApi } from '@/api/users';
import { messageApi, notificationApi, uploadApi } from '@/api/uploads';
import type {
  AdminQuery,
  AppNotification,
  CommentItem,
  CommentQuery,
  DirectMessage,
  PageData,
  PlatformSettings,
  RankingQuery,
  Role,
  SearchQuery,
  UserStatus,
  VideoDetail,
  VideoQuery,
  VideoSummary,
} from '@/api/types';
import { queryKeys } from '@/lib/queryKeys';
import { useUiStore } from '@/stores/uiStore';
import { useAuthStore } from '@/stores/authStore';

/* ------------------------------------------------------------------ 基础 */

export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => categoryApi.list(),
    staleTime: 30 * 60_000,
  });
}

/* ------------------------------------------------------------------ 视频 */

export function useRecommendVideos(query: VideoQuery = {}) {
  return useQuery({
    queryKey: queryKeys.videos.recommend(query),
    queryFn: () => videoApi.recommend(query),
  });
}

/** 首页无限滚动：IntersectionObserver 触发 fetchNextPage（文档 5.6） */
export function useInfiniteRecommend(query: VideoQuery = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.videos.recommend({ ...query, infinite: true } as VideoQuery),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => videoApi.recommend({ ...query, page: pageParam as number, pageSize: 20 }),
    getNextPageParam: (last: PageData<VideoSummary>) => (last.hasMore ? last.page + 1 : undefined),
  });
}

export function useVideoDetail(id: number, options?: Partial<UseQueryOptions<VideoDetail>>) {
  return useQuery({
    queryKey: queryKeys.videos.detail(id),
    queryFn: () => videoApi.detail(id),
    enabled: Number.isFinite(id) && id > 0,
    ...options,
  });
}

export function useVideoPlay(id: number) {
  return useQuery({
    queryKey: queryKeys.videos.play(id),
    queryFn: () => videoApi.play(id),
    enabled: Number.isFinite(id) && id > 0,
    staleTime: 30 * 60_000,
  });
}

export function useRelatedVideos(id: number) {
  return useQuery({
    queryKey: queryKeys.videos.related(id),
    queryFn: () => videoApi.related(id),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function useRanking(query: RankingQuery) {
  return useQuery({
    queryKey: queryKeys.videos.ranking(query),
    queryFn: () => videoApi.ranking(query),
    staleTime: 60_000,
  });
}

export function useVideoSearch(query: SearchQuery, enabled = true) {
  return useQuery<SearchResult>({
    queryKey: queryKeys.videos.search(query),
    queryFn: () => videoApi.search(query),
    enabled: enabled && query.q.trim().length > 0,
    placeholderData: (prev) => prev,
  });
}

export function useShortsFeed() {
  return useInfiniteQuery({
    queryKey: queryKeys.videos.shorts(),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => videoApi.shorts({ cursor: pageParam, pageSize: 6 }),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useWatchHistory(page = 1) {
  const isLogin = useAuthStore((s) => s.status === 'authenticated');
  return useQuery({
    queryKey: queryKeys.videos.history(page),
    queryFn: () => videoApi.history(page),
    enabled: isLogin,
  });
}

export function useFavorites(query: { page?: number; folderId?: number } = {}) {
  const isLogin = useAuthStore((s) => s.status === 'authenticated');
  return useQuery({
    queryKey: queryKeys.videos.favorites(query),
    queryFn: () => videoApi.favorites(query),
    enabled: isLogin,
  });
}

export function usePlaylists() {
  const isLogin = useAuthStore((s) => s.status === 'authenticated');
  return useQuery({
    queryKey: queryKeys.videos.playlists,
    queryFn: () => videoApi.playlists(),
    enabled: isLogin,
  });
}

/* --------------------------------------------------------- 互动（乐观更新） */

export function useRemoveFavorites() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (ids: number[]) => {
      const results = await Promise.allSettled(ids.map((id) => videoApi.favorite(id, false)));
      return {
        removed: ids.filter((_, index) => results[index].status === 'fulfilled'),
        failed: ids.filter((_, index) => results[index].status === 'rejected'),
      };
    },
    onSettled: () => client.invalidateQueries({ queryKey: ['videos'] }),
  });
}

function requireLoginToast(): boolean {
  const authed = useAuthStore.getState().status === 'authenticated';
  if (!authed) {
    useUiStore.getState().toast({ title: '请先登录后再操作', tone: 'warning' });
  }
  return authed;
}

export function useVideoInteractions(videoId: number) {
  const client = useQueryClient();
  const detailKey = queryKeys.videos.detail(videoId);

  const patchDetail = (patch: Partial<VideoDetail>) => {
    client.setQueryData<VideoDetail>(detailKey, (prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const like = useMutation({
    mutationFn: (active: boolean) => videoApi.like(videoId, active),
    onMutate: async (active) => {
      if (!requireLoginToast()) throw new Error('unauthorized');
      await client.cancelQueries({ queryKey: detailKey });
      const prev = client.getQueryData<VideoDetail>(detailKey);
      const delta = prev ? (active === prev.liked ? 0 : active ? 1 : -1) : 0;
      patchDetail({
        liked: active,
        disliked: active ? false : prev?.disliked,
        ...(prev ? { stats: { ...prev.stats, likes: prev.stats.likes + delta } } : {}),
      });
      return { prev };
    },
    onError: (_error, _vars, context) => {
      if (context?.prev) client.setQueryData(detailKey, context.prev);
    },
    onSuccess: (result) => {
      patchDetail({ liked: result.active });
      client.invalidateQueries({ queryKey: ['videos', 'detail', videoId] });
    },
  });

  const favorite = useMutation({
    mutationFn: (active: boolean) => videoApi.favorite(videoId, active),
    onMutate: async (active) => {
      if (!requireLoginToast()) throw new Error('unauthorized');
      await client.cancelQueries({ queryKey: detailKey });
      const prev = client.getQueryData<VideoDetail>(detailKey);
      patchDetail({ favorited: active });
      return { prev };
    },
    onError: (_e, _v, context) => {
      if (context?.prev) client.setQueryData(detailKey, context.prev);
    },
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ['videos'] });
      useUiStore.getState().toast({
        title: result.active ? '已加入收藏夹' : '已取消收藏',
        tone: 'success',
      });
    },
  });

  const subscribe = useMutation({
    mutationFn: (active: boolean) => videoApi.subscribe(videoId, active),
    onMutate: async (active) => {
      if (!requireLoginToast()) throw new Error('unauthorized');
      const prev = client.getQueryData<VideoDetail>(detailKey);
      patchDetail({ subscribed: active });
      return { prev };
    },
    onError: (_e, _v, context) => {
      if (context?.prev) client.setQueryData(detailKey, context.prev);
    },
  });

  const dislike = useMutation({
    mutationFn: (active: boolean) => videoApi.dislike(videoId, active),
    onMutate: async (active) => {
      if (!requireLoginToast()) throw new Error('unauthorized');
      const prev = client.getQueryData<VideoDetail>(detailKey);
      patchDetail({ disliked: active, liked: active ? false : prev?.liked });
      return { prev };
    },
    onError: (_e, _v, context) => {
      if (context?.prev) client.setQueryData(detailKey, context.prev);
    },
  });

  return { like, favorite, subscribe, dislike };
}

export function useDeleteVideo() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => videoApi.remove(id),
    onSuccess: (_data, id) => {
      client.invalidateQueries({ queryKey: ['videos'] });
      client.removeQueries({ queryKey: queryKeys.videos.detail(id) });
      useUiStore.getState().toast({ title: '已移入回收站，30 天内可恢复', tone: 'success' });
    },
  });
}

export function useUpdateVideo() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: Partial<Pick<VideoDetail, 'title' | 'description' | 'tags' | 'visibility'>>;
    }) => videoApi.update(id, payload),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.videos.detail(data.id), data);
      client.invalidateQueries({ queryKey: ['videos', 'recommend'] });
      useUiStore.getState().toast({ title: '已保存修改', tone: 'success' });
    },
  });
}

/* ------------------------------------------------------------------ 评论 */

export function useComments(videoId: number, query: CommentQuery = {}) {
  return useQuery({
    queryKey: queryKeys.comments.list(videoId, query),
    queryFn: () => videoApi.comments(videoId, query),
    enabled: Number.isFinite(videoId) && videoId > 0,
  });
}

export function useCommentReplies(commentId: number, enabled: boolean, page = 1) {
  return useQuery({
    queryKey: queryKeys.comments.replies(commentId, page),
    queryFn: () => videoApi.replies(commentId, page),
    enabled,
  });
}

/** 评论提交：乐观插入 + 失败回滚（文档 5.6 / 12.3） */
export function usePostComment(videoId: number, query: CommentQuery = {}) {
  const client = useQueryClient();
  const key = queryKeys.comments.list(videoId, query);
  return useMutation({
    mutationFn: (content: string) => videoApi.postComment(videoId, content),
    onMutate: async (content) => {
      if (!requireLoginToast()) throw new Error('unauthorized');
      await client.cancelQueries({ queryKey: key });
      const prev = client.getQueryData<PageData<CommentItem>>(key);
      const user = useAuthStore.getState().user;
      const optimistic: CommentItem = {
        id: -Date.now(),
        videoId,
        parentId: null,
        rootId: null,
        content,
        user: {
          id: user?.id ?? 0,
          username: user?.username ?? 'me',
          nickname: user?.nickname ?? '我',
          avatar: user?.avatar ?? null,
          certified: user?.certified ?? false,
        },
        likeCount: 0,
        replyCount: 0,
        liked: false,
        status: 'VISIBLE',
        createdAt: new Date().toISOString(),
        pending: true,
      };
      client.setQueryData<PageData<CommentItem>>(key, (old) =>
        old
          ? { ...old, items: [optimistic, ...old.items], total: old.total + 1 }
          : { items: [optimistic], total: 1, page: 1, pageSize: 20, hasMore: false },
      );
      return { prev };
    },
    onError: (_error, _content, context) => {
      if (context?.prev) client.setQueryData(key, context.prev);
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['comments', videoId] });
      client.invalidateQueries({ queryKey: queryKeys.videos.detail(videoId) });
    },
  });
}

export function useReplyComment(videoId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, content }: { commentId: number; content: string }) =>
      videoApi.replyComment(commentId, content),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['comments', videoId] });
    },
  });
}

export function useLikeComment(videoId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, active }: { commentId: number; active: boolean }) =>
      videoApi.likeComment(commentId, active),
    onSuccess: () => client.invalidateQueries({ queryKey: ['comments', videoId] }),
  });
}

export function useDeleteComment(videoId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (commentId: number) => videoApi.deleteComment(commentId),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.comments.all }),
        client.invalidateQueries({ queryKey: queryKeys.videos.detail(videoId) }),
      ]);
      useUiStore.getState().toast({ title: '评论已删除', tone: 'success' });
    },
  });
}

/* ------------------------------------------------------------------ 动态 */

export function useFeed(type: FeedQuery['type'] = 'recommend', topicId?: number) {
  return useInfiniteQuery({
    queryKey: queryKeys.feeds.list({ type, topicId }),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => feedApi.list({ type, topicId, cursor: pageParam, pageSize: 10 }),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useFeedDetail(id: number) {
  return useQuery({
    queryKey: queryKeys.feeds.detail(id),
    queryFn: () => feedApi.detail(id),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function useFeedComments(id: number, page = 1) {
  return useQuery({
    queryKey: queryKeys.feeds.comments(id, page),
    queryFn: () => feedApi.comments(id, page),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function usePublishFeed() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: feedApi.publish,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.feeds.all });
      useUiStore.getState().toast({ title: '动态已发布', tone: 'success' });
    },
  });
}

export function useToggleFeedLike() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => feedApi.like(id, active),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.feeds.all }),
  });
}

/* ------------------------------------------------------------------ 用户 */

export function useUserProfile(id: number) {
  return useQuery({
    queryKey: queryKeys.user.profile(id),
    queryFn: () => userApi.profile(id),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function useUserVideos(id: number, page = 1) {
  return useQuery({
    queryKey: queryKeys.user.videos(id, page),
    queryFn: () => userApi.videos(id, page),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function useUserFeeds(id: number, page = 1) {
  return useQuery({
    queryKey: queryKeys.user.feeds(id, page),
    queryFn: () => userApi.feeds(id, page),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function useUserFavorites(id: number, page = 1) {
  return useQuery({
    queryKey: queryKeys.user.favorites(id, page),
    queryFn: () => userApi.favorites(id, page),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function useFollowList(id: number, kind: 'followers' | 'following', page = 1) {
  return useQuery({
    queryKey: kind === 'followers' ? queryKeys.user.followers(id, page) : queryKeys.user.following(id, page),
    queryFn: () => (kind === 'followers' ? userApi.followers(id, page) : userApi.following(id, page)),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function useToggleFollow() {
  const client = useQueryClient();
  const toast = useUiStore.getState().toast;
  return useMutation({
    mutationFn: ({ userId, active }: { userId: number; active: boolean }) => userApi.follow(userId, active),
    onMutate: async ({ userId, active }) => {
      if (!requireLoginToast()) throw new Error('unauthorized');
      const key = queryKeys.user.profile(userId);
      await client.cancelQueries({ queryKey: key });
      const prev = client.getQueryData(key);
      client.setQueryData(key, (old: unknown) =>
        old && typeof old === 'object' ? { ...(old as object), followed: active } : old,
      );
      return { prev, key };
    },
    onError: (_e, _v, context) => {
      if (context?.prev) client.setQueryData(context.key, context.prev);
    },
    onSuccess: (data, vars) => {
      void data;
      toast({ title: vars.active ? '已关注' : '已取消关注', tone: 'success' });
      client.invalidateQueries({ queryKey: ['user'] });
    },
  });
}

export function useSuggestedUsers() {
  return useQuery({
    queryKey: queryKeys.user.suggested,
    queryFn: () => userApi.suggested(),
    staleTime: 10 * 60_000,
  });
}

/* ------------------------------------------------------------ 创作者中心 */

export function useCreatorDashboard(days = 30) {
  const isLogin = useAuthStore((s) => s.status === 'authenticated');
  return useQuery({
    queryKey: queryKeys.creator.dashboard(days),
    queryFn: () => creatorApi.dashboard(days),
    enabled: isLogin,
  });
}

export function useCreatorVideos(query: { page?: number; status?: string } = {}) {
  const isLogin = useAuthStore((s) => s.status === 'authenticated');
  return useQuery({
    queryKey: queryKeys.creator.videos(query),
    queryFn: () => creatorApi.videos(query),
    enabled: isLogin,
  });
}

/* ------------------------------------------------------------------ 通知 */

export function useNotifications(query: { page?: number; pageSize?: number; type?: string } = {}) {
  const isLogin = useAuthStore((s) => s.status === 'authenticated');
  return useQuery({
    queryKey: queryKeys.notifications.list(query),
    queryFn: () => notificationApi.list(query),
    enabled: isLogin,
  });
}

export function useUnreadCount() {
  const isLogin = useAuthStore((s) => s.status === 'authenticated');
  return useQuery({
    queryKey: queryKeys.notifications.unread,
    queryFn: () => notificationApi.unreadCount(),
    enabled: isLogin,
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => notificationApi.markRead(ids),
    onSuccess: () => client.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

/* ------------------------------------------------------------------ 私信 */

export function useConversations() {
  const isLogin = useAuthStore((s) => s.status === 'authenticated');
  return useQuery({
    queryKey: queryKeys.messages.conversations,
    queryFn: () => messageApi.conversations(),
    enabled: isLogin,
  });
}

export function useMessages(conversationId: number) {
  return useQuery({
    queryKey: queryKeys.messages.thread(conversationId),
    queryFn: () => messageApi.messages(conversationId),
    enabled: conversationId > 0,
  });
}

export function useSendMessage(conversationId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { content: string; attachment?: DirectMessage['attachment'] }) => messageApi.send(conversationId, payload.content, payload.attachment),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.messages.thread(conversationId) }),
  });
}

/* ------------------------------------------------------------ 上传与转码 */

export function useTranscodeProgress(videoId: number | null, enabled = true) {
  return useQuery({
    queryKey: ['transcode', videoId],
    queryFn: () => uploadApi.transcodeProgress(videoId as number),
    enabled: enabled && videoId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'SUCCESS' ? false : 1500;
    },
  });
}

/* -------------------------------------------------------------- 管理后台 */

export function useAdminOverview() {
  const canView = useAuthStore((s) => s.user?.permissions.includes('admin:analytics') ?? false);
  return useQuery({
    queryKey: queryKeys.admin.overview,
    queryFn: () => adminApi.overview(),
    enabled: canView,
  });
}

export function useReviewTasks(query: AdminQuery = {}) {
  const can = useAuthStore((s) => s.user?.permissions.includes('moderation:review') ?? false);
  return useQuery({
    queryKey: queryKeys.admin.reviews(query as Record<string, unknown>),
    queryFn: () => adminApi.reviews(query),
    enabled: can,
  });
}

export function useDecideReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, decision, note }: { taskId: number; decision: 'APPROVE' | 'REJECT'; note?: string }) =>
      adminApi.decideReview(taskId, decision, note),
    onSuccess: (_d, vars) => {
      client.invalidateQueries({ queryKey: ['admin', 'reviews'] });
      // 审核通过后视频会从 REVIEWING 变为 PUBLISHED，立即刷新首页和创作者列表。
      client.invalidateQueries({ queryKey: ['videos'] });
      client.invalidateQueries({ queryKey: ['creator', 'videos'] });
      useUiStore.getState().toast({
        title: vars.decision === 'APPROVE' ? '已通过审核' : '已驳回并通知作者',
        tone: vars.decision === 'APPROVE' ? 'success' : 'warning',
      });
    },
  });
}

export function useReportTasks(query: AdminQuery = {}) {
  const can = useAuthStore((s) => s.user?.permissions.includes('moderation:report') ?? false);
  return useQuery({
    queryKey: queryKeys.admin.reports(query as Record<string, unknown>),
    queryFn: () => adminApi.reports(query),
    enabled: can,
  });
}

export function useHandleReport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ reportId, status, note }: { reportId: number; status: 'PROCESSING' | 'RESOLVED' | 'REJECTED'; note?: string }) =>
      adminApi.handleReport(reportId, status, note),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['admin', 'reports'] });
      useUiStore.getState().toast({ title: '举报已处理', tone: 'success' });
    },
  });
}

export function useAdminUsers(query: AdminQuery = {}) {
  const can = useAuthStore((s) => s.user?.permissions.includes('admin:user_manage') ?? false);
  return useQuery({
    queryKey: queryKeys.admin.users(query as Record<string, unknown>),
    queryFn: () => adminApi.users(query),
    enabled: can,
  });
}

export function useUpdateUserStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, status, reason }: { userId: number; status: UserStatus; reason?: string }) =>
      adminApi.updateUserStatus(userId, status, reason),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['admin', 'users'] });
      useUiStore.getState().toast({ title: '用户状态已更新', tone: 'success' });
    },
  });
}

export function useAssignRole() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: Role }) => adminApi.assignRole(userId, role),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['admin', 'users'] });
      useUiStore.getState().toast({ title: '角色已更新', tone: 'success' });
    },
  });
}

export function useAdminVideos(query: AdminQuery = {}) {
  const can = useAuthStore((s) => s.user?.permissions.includes('moderation:review') ?? false);
  return useQuery({
    queryKey: queryKeys.admin.videos(query as Record<string, unknown>),
    queryFn: () => adminApi.videos(query),
    enabled: can,
  });
}

export function useAuditLogs(query: AdminQuery = {}) {
  const can = useAuthStore((s) => s.user?.permissions.includes('admin:analytics') ?? false);
  return useQuery({
    queryKey: queryKeys.admin.auditLogs(query as Record<string, unknown>),
    queryFn: () => adminApi.auditLogs(query),
    enabled: can,
  });
}

export function usePlatformSettings() {
  const can = useAuthStore((s) => s.user?.permissions.includes('admin:system_config') ?? false);
  return useQuery({
    queryKey: queryKeys.admin.settings,
    queryFn: () => adminApi.settings(),
    enabled: can,
  });
}

export function useUpdatePlatformSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<PlatformSettings>) => adminApi.updateSettings(payload),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.admin.settings, data);
      useUiStore.getState().toast({ title: '系统配置已保存', tone: 'success' });
    },
  });
}

export type { AppNotification };
