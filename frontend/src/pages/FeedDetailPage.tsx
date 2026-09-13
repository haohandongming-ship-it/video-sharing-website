import { useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Heart, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatCount, formatRelative } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { feedApi } from '@/api/feeds';
import type { CommentItem, PageData } from '@/api/types';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { useFeed, useFeedComments, useFeedDetail } from '@/hooks/useApi';
import { Avatar, CommentSkeleton, EmptyState, ErrorState, SectionHeader, Skeleton } from '@/components/ui';
import { CommentInput } from '@/components/comment/CommentSection';
import { FeedCard } from '@/components/feed/FeedCard';

/** 底部「更多动态」展示条数 */
const MORE_FEED_COUNT = 4;

/** 动态详情页（文档 4.3）：完整动态 + 评论区 + 更多动态 */
export default function FeedDetailPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const feedId = Number(idParam);
  const location = useLocation();
  const reducedMotion = useUiStore((s) => s.reducedMotion);
  const detail = useFeedDetail(feedId);
  const post = detail.data;
  const hasPost = Boolean(post);

  // 从信息流点击评论进入时锚定到评论区
  useEffect(() => {
    if (location.hash !== '#comments' || !hasPost) return;
    const timer = window.setTimeout(() => {
      const target = document.getElementById('comments');
      // jsdom 等非浏览器环境没有 scrollIntoView，做一次能力判断
      if (typeof target?.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
      }
    }, 80);
    return () => window.clearTimeout(timer);
  }, [location.hash, reducedMotion, hasPost]);

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-6">
      <Link
        to="/feed"
        className="inline-flex items-center gap-1.5 rounded-btn text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" aria-hidden />
        返回动态流
      </Link>

      <div className="mt-4">
        {detail.isLoading ? (
          <FeedDetailSkeleton />
        ) : detail.isError ? (
          <ErrorState
            title="动态加载失败"
            description="可能是网络波动，重试一次即可。"
            onRetry={() => void detail.refetch()}
          />
        ) : !post ? (
          <EmptyState
            icon={<MessageCircle className="size-7" aria-hidden />}
            title="动态不存在或已被删除"
            description="它可能已被作者删除，或者链接有误。"
            action={
              <Link to="/feed" className="text-sm font-medium text-accent hover:underline">
                返回动态流
              </Link>
            }
          />
        ) : (
          <>
            <FeedCard post={post} detail />
            <FeedComments feedId={post.id} commentCount={post.stats.comments} />
            <MoreFeeds excludeId={post.id} />
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 评论区 */

function FeedComments({ feedId, commentCount }: { feedId: number; commentCount: number }) {
  const client = useQueryClient();
  const isLogin = useAuthStore((s) => s.status === 'authenticated');
  const toast = useUiStore((s) => s.toast);
  const listKey = queryKeys.feeds.comments(feedId, 1);
  const { data, isLoading, isError, refetch } = useFeedComments(feedId);

  /** 动态评论没有专用 hook，这里用 useMutation + feedApi 就地在页面内做乐观追加 */
  const postComment = useMutation({
    mutationFn: (content: string) => feedApi.postComment(feedId, content),
    onMutate: async (content) => {
      await client.cancelQueries({ queryKey: listKey });
      const prev = client.getQueryData<PageData<CommentItem>>(listKey);
      const user = useAuthStore.getState().user;
      const optimistic: CommentItem = {
        id: -Date.now(),
        videoId: feedId,
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
      client.setQueryData<PageData<CommentItem>>(listKey, (old) =>
        old
          ? { ...old, items: [optimistic, ...old.items], total: old.total + 1 }
          : { items: [optimistic], total: 1, page: 1, pageSize: 20, hasMore: false },
      );
      return { prev, optimisticId: optimistic.id };
    },
    onError: (error, _content, context) => {
      if (context?.prev) client.setQueryData(listKey, context.prev);
      toast({
        title: '评论发送失败',
        description: error instanceof Error ? error.message : '请稍后重试。',
        tone: 'error',
      });
    },
    onSuccess: (created, _content, context) => {
      // 用服务端返回的评论替换占位项，不整表刷新，避免刚发出的评论被列表刷掉
      client.setQueryData<PageData<CommentItem>>(listKey, (old) =>
        old
          ? { ...old, items: old.items.map((item) => (item.id === context?.optimisticId ? created : item)) }
          : old,
      );
      client.invalidateQueries({ queryKey: queryKeys.feeds.detail(feedId) });
    },
  });

  const items = data?.items ?? [];
  const total = data?.total ?? commentCount;

  return (
    <section id="comments" aria-label="评论区" className="mt-6 scroll-mt-20">
      <SectionHeader title={`评论 ${formatCount(total)}`} subtitle="按发布时间倒序" />

      <div className="mt-4">
        <CommentInput
          disabled={!isLogin}
          pending={postComment.isPending}
          placeholder="友善地聊聊这条动态"
          onSubmit={async (content) => {
            try {
              await postComment.mutateAsync(content);
            } catch {
              /* 失败提示已在 mutation.onError 中统一处理 */
            }
          }}
        />
      </div>

      {isLoading ? (
        <div className="mt-6">
          <CommentSkeleton count={4} />
        </div>
      ) : isError ? (
        <ErrorState className="py-8" title="评论加载失败" onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          compact
          title="还没有评论"
          description={isLogin ? '说说你的看法，第一条评论往往最有价值。' : '登录后即可参与讨论。'}
        />
      ) : (
        <>
          <ul className="mt-6 flex flex-col gap-5">
            {items.map((comment) => (
              <FeedCommentRow key={comment.id} comment={comment} />
            ))}
          </ul>
          {data?.hasMore && <p className="mt-4 text-center text-xs text-fg-subtle">仅展示最新 20 条评论</p>}
        </>
      )}
    </section>
  );
}

function FeedCommentRow({ comment }: { comment: CommentItem }) {
  return (
    <li className={cn('flex gap-3', comment.pending && 'comment-highlight rounded-btn px-1')}>
      <Link to={`/user/${comment.user.id}`} className="shrink-0">
        <Avatar
          src={comment.user.avatar}
          name={comment.user.nickname}
          size="sm"
          certified={comment.user.certified}
        />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link to={`/user/${comment.user.id}`} className="text-[13px] font-medium text-fg hover:text-accent">
            {comment.user.nickname}
          </Link>
          <span className="text-[11px] text-fg-subtle">{formatRelative(comment.createdAt)}</span>
          {comment.pending && <span className="text-[11px] text-fg-subtle">发送中…</span>}
        </div>
        <p className="mt-1 text-[13px] leading-[1.7] break-words whitespace-pre-wrap text-fg">{comment.content}</p>
        {comment.likeCount > 0 && (
          <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-fg-subtle">
            <Heart className="size-3.5" aria-hidden />
            <span className="tabular-nums">{formatCount(comment.likeCount)}</span>
          </p>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------- 更多动态 */

function MoreFeeds({ excludeId }: { excludeId: number }) {
  const { data, isLoading, isError, refetch } = useFeed('recommend');
  const items = (data?.pages.flatMap((page) => page.items) ?? [])
    .filter((item) => item.id !== excludeId)
    .slice(0, MORE_FEED_COUNT);

  return (
    <section aria-label="更多动态" className="mt-10">
      <SectionHeader
        title="更多动态"
        subtitle="来自推荐流的其他内容"
        action={
          <Link to="/feed" className="text-xs font-medium text-accent hover:underline">
            查看全部
          </Link>
        }
      />

      {isLoading ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2" aria-hidden>
          <Skeleton className="h-44 w-full" rounded="lg" />
          <Skeleton className="h-44 w-full" rounded="lg" />
        </div>
      ) : isError ? (
        <ErrorState className="py-8" title="更多动态加载失败" onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <EmptyState compact title="暂无其他动态" description="推荐流稍后会更新，可以先去动态页看看。" />
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {items.map((item) => (
            <FeedCard key={item.id} post={item} />
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- 骨架屏 */

function FeedDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="rounded-card border border-line bg-surface p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10" rounded="full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 pl-0 sm:pl-[52px]">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-40 w-full" rounded="lg" />
        </div>
      </div>
      <div>
        <Skeleton className="h-4 w-24" />
        <div className="mt-4">
          <CommentSkeleton count={3} />
        </div>
      </div>
    </div>
  );
}
