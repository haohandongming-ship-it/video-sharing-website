import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Hash, Repeat2, Send, UserPlus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatCount } from '@/lib/format';
import { listContainer, listItem } from '@/lib/motion';
import type { FeedPost } from '@/api/types';
import { useFeed, usePublishFeed, useSuggestedUsers, useToggleFollow } from '@/hooks/useApi';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import {
  Avatar,
  AvatarWithMeta,
  Button,
  EmptyState,
  ErrorState,
  ListSkeleton,
  LoadMoreSentinel,
  Modal,
  Skeleton,
  Tabs,
  Textarea,
  type TabItem,
} from '@/components/ui';
import { FeedCard } from '@/components/feed/FeedCard';
import { SubscribeButton } from '@/components/user/SubscribeButton';

/** 单条动态正文上限（文档 4.3） */
const FEED_MAX_LENGTH = 2000;

type FeedTab = 'recommend' | 'following' | 'hot';

const FEED_TABS: readonly TabItem<FeedTab>[] = [
  { key: 'recommend', label: '推荐' },
  { key: 'following', label: '关注' },
  { key: 'hot', label: '热门' },
];

/** 热门话题：静态榜单，id 与后端话题 id 对应 */
const FEED_TOPICS: readonly { id: number; name: string; discussions: number }[] = [
  { id: 1, name: '今日份快乐', discussions: 1842 },
  { id: 2, name: '程序员日常', discussions: 963 },
  { id: 3, name: '城市观察', discussions: 738 },
  { id: 4, name: '美食记录', discussions: 651 },
  { id: 5, name: '随手拍', discussions: 1204 },
  { id: 6, name: '读书笔记', discussions: 486 },
];

function feedHref(tab: FeedTab, topicId?: number): string {
  const params = new URLSearchParams();
  if (tab !== 'recommend') params.set('tab', tab);
  if (topicId) params.set('topic', String(topicId));
  const query = params.toString();
  return query ? `/feed?${query}` : '/feed';
}

/** 微博式动态页（文档 4.3）：信息流主列 + 桌面端粘性侧栏 */
export default function FeedPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const isLogin = useAuthStore((s) => s.status === 'authenticated');

  const tabParam = searchParams.get('tab');
  const tab: FeedTab = tabParam === 'following' || tabParam === 'hot' ? tabParam : 'recommend';
  const topicParam = Number.parseInt(searchParams.get('topic') ?? '', 10);
  const topicId = Number.isFinite(topicParam) && topicParam > 0 ? topicParam : undefined;
  const topic = FEED_TOPICS.find((item) => item.id === topicId);
  const topicName = topic?.name ?? (topicId ? `话题 ${topicId}` : undefined);

  const [repostTarget, setRepostTarget] = useState<FeedPost | null>(null);

  const feed = useFeed(tab, topicId);
  const posts = useMemo(() => feed.data?.pages.flatMap((page) => page.items) ?? [], [feed.data]);
  const followingLocked = tab === 'following' && !isLogin;

  const updateParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          mutate(next);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return (
    <div className="mx-auto flex max-w-[1100px] gap-6 px-4 py-6">
      <div className="min-w-0 flex-1">
        <h1 className="sr-only">动态</h1>

        {/* 移动端没有侧栏，发布入口放在信息流上方 */}
        <div className="xl:hidden">
          <PublisherCard />
        </div>

        <div className="mt-4 rounded-card border border-line bg-surface px-3 pt-3 xl:mt-0">
          <Tabs
            items={FEED_TABS}
            value={tab}
            onChange={(next) =>
              updateParams((params) => {
                if (next === 'recommend') params.delete('tab');
                else params.set('tab', next);
              })
            }
          />
        </div>

        {topicId && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-fg">#{topicName}#</h2>
              <p className="mt-0.5 text-xs text-fg-muted">
                {topic ? `${formatCount(topic.discussions)} 条讨论` : '按话题筛选动态'}
              </p>
            </div>
            <Button size="xs" variant="ghost" onClick={() => updateParams((params) => params.delete('topic'))}>
              清除筛选
            </Button>
          </div>
        )}

        {followingLocked ? (
          <EmptyState
            icon={<UserPlus className="size-7" aria-hidden />}
            title="登录后查看关注动态"
            description="关注感兴趣的创作者，对方发布的新动态会按时间汇总在这里。"
            action={
              <Button variant="primary" size="sm" onClick={() => navigate('/login')}>
                去登录
              </Button>
            }
          />
        ) : feed.isLoading ? (
          <FeedListSkeleton />
        ) : feed.isError ? (
          <ErrorState
            className="mt-4"
            title="动态加载失败"
            description="可能是网络波动，重试一次即可。"
            onRetry={() => void feed.refetch()}
          />
        ) : posts.length === 0 ? (
          <EmptyState
            className="mt-4"
            title={topicName ? `#${topicName}# 下还没有动态` : '这里还没有动态'}
            description={topicName ? '换个话题看看，或者发布这个话题的第一条动态。' : '关注更多创作者，或先发布一条自己的动态。'}
            action={
              topicId ? (
                <Button size="sm" variant="secondary" onClick={() => updateParams((params) => params.delete('topic'))}>
                  查看全部动态
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <motion.ul
              variants={listContainer}
              initial="initial"
              animate="animate"
              className="mt-4 flex flex-col gap-4"
            >
              {posts.map((post) => (
                <motion.li key={post.id} variants={listItem}>
                  <FeedCard post={post} onRepost={setRepostTarget} />
                </motion.li>
              ))}
            </motion.ul>
            <LoadMoreSentinel
              loading={feed.isFetchingNextPage}
              hasMore={Boolean(feed.hasNextPage)}
              onIntersect={() => void feed.fetchNextPage()}
              endLabel={topicName ? `已显示 #${topicName}# 的全部动态` : '已经到底了'}
            />
          </>
        )}
      </div>

      <aside className="hidden w-80 shrink-0 xl:block">
        <div className="sticky top-[4.5rem] flex flex-col gap-4">
          <PublisherCard />
          <SuggestedPanel />
          <TopicsPanel tab={tab} activeTopicId={topicId} />
        </div>
      </aside>

      <RepostModal target={repostTarget} onClose={() => setRepostTarget(null)} />
    </div>
  );
}

/* -------------------------------------------------------------- 发布动态 */

function PublisherCard() {
  const user = useAuthStore((s) => s.user);
  const isLogin = useAuthStore((s) => s.status === 'authenticated');
  const toast = useUiStore((s) => s.toast);
  const publish = usePublishFeed();
  const [content, setContent] = useState('');
  const [expanded, setExpanded] = useState(false);

  const trimmed = content.trim();
  const nearLimit = content.length >= FEED_MAX_LENGTH - 100;

  const submit = async () => {
    if (!isLogin) {
      toast({ title: '登录后即可发布动态', description: '支持文字、图片与视频动态。', tone: 'warning' });
      return;
    }
    if (!trimmed) return;
    try {
      await publish.mutateAsync({ content: trimmed });
      setContent('');
      setExpanded(false);
    } catch (error) {
      toast({
        title: '发布失败',
        description: error instanceof Error ? error.message : '请稍后重试。',
        tone: 'error',
      });
    }
  };

  return (
    <section aria-label="发布动态" className="rounded-card border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-fg">发布动态</h2>
      <div className="mt-3 flex gap-3">
        <Avatar src={user?.avatar} name={user?.nickname ?? '游客'} size="md" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <Textarea
            value={content}
            rows={expanded ? 4 : 1}
            maxLength={FEED_MAX_LENGTH}
            aria-label="动态内容"
            placeholder="记录此刻的想法，或说说最近在做的事"
            onFocus={() => setExpanded(true)}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void submit();
            }}
            className="text-[13px]"
            footer={
              <>
                <span className={cn('text-[11px] tabular-nums', nearLimit ? 'text-warning' : 'text-fg-subtle')}>
                  {content.length}/{FEED_MAX_LENGTH}
                </span>
                <span className="flex items-center gap-2">
                  {expanded && (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setContent('');
                        setExpanded(false);
                      }}
                    >
                      收起
                    </Button>
                  )}
                  <Button
                    size="xs"
                    variant="primary"
                    icon={<Send className="size-3.5" />}
                    loading={publish.isPending}
                    disabled={isLogin && !trimmed}
                    onClick={() => void submit()}
                  >
                    发表
                  </Button>
                </span>
              </>
            }
          />
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- 转发弹窗 */

function RepostModal({ target, onClose }: { target: FeedPost | null; onClose: () => void }) {
  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title="转发动态"
      description="转发会保留原动态，你的补充说明展示在上方。"
    >
      {/* key 随目标动态变化，切换转发对象时自然重置输入内容 */}
      {target && <RepostForm key={target.id} post={target} onClose={onClose} />}
    </Modal>
  );
}

function RepostForm({ post, onClose }: { post: FeedPost; onClose: () => void }) {
  const toast = useUiStore((s) => s.toast);
  const publish = usePublishFeed();
  const [content, setContent] = useState('');

  const trimmed = content.trim();

  const submit = async () => {
    if (!trimmed) return;
    try {
      await publish.mutateAsync({ content: trimmed, repostOfId: post.id });
      onClose();
    } catch (error) {
      toast({
        title: '转发失败',
        description: error instanceof Error ? error.message : '请稍后重试。',
        tone: 'error',
      });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        value={content}
        rows={3}
        maxLength={FEED_MAX_LENGTH}
        aria-label="转发说明"
        placeholder="说说为什么转发"
        autoFocus
        onChange={(event) => setContent(event.target.value)}
        footer={
          <span className="text-[11px] tabular-nums text-fg-subtle">
            {content.length}/{FEED_MAX_LENGTH}
          </span>
        }
      />
      <div className="rounded-[10px] border border-line bg-surface-2 p-3">
        <p className="text-[13px] font-medium text-accent">@{post.user.nickname}</p>
        <p className="mt-1 line-clamp-4 text-[13px] leading-relaxed text-fg-muted">{post.content}</p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          取消
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={<Repeat2 className="size-3.5" />}
          loading={publish.isPending}
          disabled={!trimmed}
          onClick={() => void submit()}
        >
          转发
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- 推荐关注 */

function SuggestedPanel() {
  const { data, isLoading, isError, refetch } = useSuggestedUsers();
  const toggleFollow = useToggleFollow();
  const [followed, setFollowed] = useState<Record<number, boolean>>({});
  const users = (data ?? []).slice(0, 5);

  return (
    <section aria-label="推荐关注" className="rounded-card border border-line bg-surface p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
        <UserPlus className="size-4 text-fg-subtle" aria-hidden />
        推荐关注
      </h2>

      {isLoading ? (
        <div className="mt-3">
          <ListSkeleton rows={3} />
        </div>
      ) : isError ? (
        <div className="mt-3 flex flex-col items-start gap-2">
          <p className="text-xs text-fg-muted">推荐关注加载失败。</p>
          <Button size="xs" variant="secondary" onClick={() => void refetch()}>
            重新加载
          </Button>
        </div>
      ) : users.length === 0 ? (
        <p className="mt-3 text-xs text-fg-muted">暂时没有可推荐的用户。</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {users.map((user) => (
            <li key={user.id} className="flex items-center justify-between gap-2">
              <AvatarWithMeta
                src={user.avatar}
                name={user.nickname}
                size="sm"
                certified={user.certified}
                meta={user.reason}
                className="min-w-0"
              />
              <SubscribeButton
                size="xs"
                active={Boolean(followed[user.id])}
                onToggle={(next) => {
                  setFollowed((prev) => ({ ...prev, [user.id]: next }));
                  toggleFollow.mutate({ userId: user.id, active: next });
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------- 热门话题 */

function TopicsPanel({ tab, activeTopicId }: { tab: FeedTab; activeTopicId?: number }) {
  return (
    <section aria-label="热门话题" className="rounded-card border border-line bg-surface p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
        <Hash className="size-4 text-fg-subtle" aria-hidden />
        热门话题
      </h2>
      <ul className="mt-2 flex flex-col">
        {FEED_TOPICS.map((topic) => {
          const active = topic.id === activeTopicId;
          return (
            <li key={topic.id}>
              <Link
                to={feedHref(tab, topic.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-btn px-2 py-2 transition-colors hover:bg-surface-2',
                  active && 'bg-accent-soft',
                )}
              >
                <span className={cn('truncate text-[13px]', active ? 'font-medium text-accent' : 'text-fg')}>
                  #{topic.name}#
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-fg-subtle">
                  {formatCount(topic.discussions)} 讨论
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------- 骨架屏 */

function FeedListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="mt-4 flex flex-col gap-4" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="rounded-card border border-line bg-surface p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10" rounded="full" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2 pl-0 sm:pl-[52px]">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-32 w-full" rounded="lg" />
          </div>
        </div>
      ))}
    </div>
  );
}
