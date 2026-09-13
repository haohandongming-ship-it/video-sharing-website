import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowDown, ArrowUp, Eye, Flame, Minus, Settings2, ThumbsUp, Trophy } from 'lucide-react';
import { subscribeRanking, type RealtimeHandle } from '@/api/realtime';
import type { RankingItem, RankingQuery, VideoSummary } from '@/api/types';
import { VideoCard } from '@/components/video/VideoCard';
import {
  Avatar,
  Badge,
  EmptyState,
  ErrorState,
  PageContainer,
  SectionHeader,
  Skeleton,
  SurfaceCard,
  Tabs,
  VideoCardSkeleton,
} from '@/components/ui';
import { useCategories, useRanking } from '@/hooks/useApi';
import { cn } from '@/lib/cn';
import { CATEGORY_FALLBACK, RANKING_PERIODS, RANKING_TABS } from '@/lib/constants';
import { formatCount, formatDate, formatDuration } from '@/lib/format';
import { EASE } from '@/lib/motion';

/** 前三名的名次色：用设计令牌做克制的金银铜表达 */
const MEDAL_STYLES: Record<number, string> = {
  1: 'border-warning/40 bg-warning-soft text-warning',
  2: 'border-line bg-surface-3 text-fg-muted',
  3: 'border-brand/30 bg-brand-soft text-brand',
};

const TYPE_TABS = RANKING_TABS.map((tab) => ({ key: tab.key, label: tab.label }));
const PERIOD_TABS = RANKING_PERIODS.map((item) => ({ key: item.key, label: item.label }));

interface LiveSnapshot {
  /** 快照对应的榜单参数（type:period），参数变化后不再参与渲染 */
  key: string;
  ranks: Map<number, { rank: number; delta: number }>;
  at: number;
}

const EMPTY_RANKS = new Map<number, { rank: number; delta: number }>();

function videoHref(video: VideoSummary): string {
  return video.videoType === 'SHORT' ? `/shorts?v=${video.id}` : `/video/${video.id}`;
}

/* --------------------------------------------------------------- 名次变化 */

function TrendMarker({ item, className }: { item: RankingItem; className?: string }) {
  if (item.trend === 'new') {
    return (
      <Badge tone="accent" className={className}>
        NEW
      </Badge>
    );
  }

  const amount = item.delta === 0 ? '—' : String(Math.abs(item.delta));

  if (item.trend === 'up') {
    return (
      <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums text-success', className)}>
        <ArrowUp className="size-3" aria-hidden />
        {amount}
      </span>
    );
  }

  if (item.trend === 'down') {
    return (
      <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums text-brand', className)}>
        <ArrowDown className="size-3" aria-hidden />
        {amount}
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[11px] tabular-nums text-fg-subtle', className)}>
      <Minus className="size-3" aria-hidden />
      持平
    </span>
  );
}

/* --------------------------------------------------------------- 榜单条目 */

function MedalCard({ item }: { item: RankingItem }) {
  const { video } = item;

  return (
    <motion.div layout transition={{ duration: 0.32, ease: EASE.enter }}>
      <SurfaceCard padded={false} className="overflow-hidden">
        <div className="group flex flex-col sm:flex-row">
          <Link
            to={videoHref(video)}
            aria-label={video.title}
            className="relative block aspect-video w-full shrink-0 overflow-hidden bg-surface-2 sm:w-64 lg:w-72"
          >
            <img
              src={video.coverUrl}
              alt={video.title}
              loading="lazy"
              decoding="async"
              className="size-full object-cover transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03]"
            />
            <span
              className={cn(
                'absolute top-2 left-2 inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                MEDAL_STYLES[item.rank] ?? 'border-line bg-surface text-fg-muted',
              )}
            >
              {item.rank === 1 && <Trophy className="size-3" aria-hidden />}
              No.{item.rank}
            </span>
            <span className="absolute right-2 bottom-2 rounded-[4px] bg-black/78 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
              {formatDuration(video.duration)}
            </span>
          </Link>

          <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-4">
            <Link to={videoHref(video)} className="block">
              <h3 className="line-clamp-2 text-sm leading-[1.45] font-medium text-fg transition-colors group-hover:text-accent sm:text-base">
                {video.title}
              </h3>
            </Link>
            <div className="flex items-center gap-2 text-xs text-fg-muted">
              <Avatar src={video.author.avatar} name={video.author.nickname} size="xs" certified={video.author.certified} />
              <Link to={`/user/${video.author.id}`} className="max-w-[10rem] truncate hover:text-fg">
                {video.author.nickname}
              </Link>
              <TrendMarker item={item} className="ml-auto" />
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-subtle">
              <span className="inline-flex items-center gap-1">
                <Eye className="size-3" aria-hidden />
                {formatCount(video.stats.views)}
              </span>
              <span className="inline-flex items-center gap-1">
                <ThumbsUp className="size-3" aria-hidden />
                {formatCount(video.stats.likes)}
              </span>
              <span className="inline-flex items-center gap-1 text-brand">
                <Flame className="size-3" aria-hidden />
                热度 {item.score.toFixed(1)}
              </span>
            </div>
          </div>
        </div>
      </SurfaceCard>
    </motion.div>
  );
}

function RankRow({ item }: { item: RankingItem }) {
  return (
    <SurfaceCard padded={false} className="flex items-center gap-3 p-3">
      <span
        className={cn(
          'w-7 shrink-0 text-center text-sm font-semibold tabular-nums',
          item.rank <= 10 ? 'text-fg' : 'text-fg-subtle',
        )}
        aria-label={`第 ${item.rank} 名`}
      >
        {item.rank}
      </span>
      <div className="min-w-0 flex-1">
        <VideoCard video={item.video} layout="compact" />
      </div>
      <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
        <TrendMarker item={item} />
        <span className="text-[11px] tabular-nums text-fg-subtle">热度 {item.score.toFixed(1)}</span>
      </div>
    </SurfaceCard>
  );
}

/* ------------------------------------------------------- 骨架 / 侧边信息 */

function RankingSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="榜单加载中">
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="flex flex-col overflow-hidden rounded-card border border-line bg-surface sm:flex-row">
            <Skeleton className="aspect-video w-full shrink-0 sm:w-64 lg:w-72" />
            <div className="flex flex-1 flex-col gap-2.5 p-4">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="mt-auto h-3 w-2/5" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 6 }, (_, index) => (
          <VideoCardSkeleton key={index} layout="compact" />
        ))}
      </div>
    </div>
  );
}

function RankingAside({ activeType }: { activeType: RankingQuery['type'] }) {
  return (
    <div className="flex flex-col gap-4">
      <SurfaceCard>
        <h2 className="text-sm font-semibold text-fg">榜单说明</h2>
        <ul className="mt-3 flex flex-col gap-1">
          {RANKING_TABS.map((tab) => (
            <li
              key={tab.key}
              className={cn(
                'flex items-center justify-between gap-3 rounded-btn px-2 py-1.5 text-xs',
                tab.key === activeType ? 'bg-surface-2 text-fg' : 'text-fg-muted',
              )}
            >
              <span>{tab.label}</span>
              <span className="text-[11px] text-fg-subtle">{tab.desc}</span>
            </li>
          ))}
        </ul>
      </SurfaceCard>

      <SurfaceCard>
        <h2 className="text-sm font-semibold text-fg">热度算法</h2>
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">
          热度分采用对数归一化，避免播放量主导排序：播放、点赞、评论、收藏、分享分别取对数后按权重相加，分享权重最高，点踩与举报计负分。
        </p>
      </SurfaceCard>

      <SurfaceCard>
        <h2 className="text-sm font-semibold text-fg">个性化推荐</h2>
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">榜单按平台统一的热度规则生成，不受个性化推荐影响。</p>
        <Link
          to="/settings"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
        >
          <Settings2 className="size-3.5" aria-hidden />
          关闭个性化推荐
        </Link>
      </SurfaceCard>
    </div>
  );
}

/* ------------------------------------------------------------------ 页面 */

export default function RankingPage() {
  const [type, setType] = useState<RankingQuery['type']>('hot');
  const [period, setPeriod] = useState<RankingQuery['period']>('daily');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);

  const { data: categoryData } = useCategories();
  const categories = useMemo(() => categoryData ?? CATEGORY_FALLBACK, [categoryData]);

  /* 分类榜默认落在第一个分区，用户点击后以本地选择为准 */
  const selectedCategoryId = categoryId ?? categories[0]?.id ?? null;

  const query: RankingQuery = useMemo(
    () =>
      type === 'category' && selectedCategoryId !== null
        ? { type, period, categoryId: selectedCategoryId }
        : { type, period },
    [type, period, selectedCategoryId],
  );

  const { data, isPending, isError, refetch, dataUpdatedAt } = useRanking(query);
  const live = type === 'hot' || type === 'trend';
  const liveKey = `${type}:${period}`;
  /* 推送结果与榜单参数绑定，切换周期/榜单后旧快照自动失效 */
  const liveRanks = snapshot !== null && snapshot.key === liveKey ? snapshot.ranks : EMPTY_RANKS;
  const pushedAt = snapshot !== null && snapshot.key === liveKey ? snapshot.at : null;

  /* 实时推送：仅热门榜/趋势榜提供 SSE，其余榜单按需拉取 */
  useEffect(() => {
    if (type !== 'hot' && type !== 'trend') return;
    const key = `${type}:${period}`;

    const handle: RealtimeHandle = subscribeRanking(
      type,
      (payload) => {
        const ranks = new Map<number, { rank: number; delta: number }>();
        payload.items.forEach((entry) => ranks.set(entry.videoId, { rank: entry.rank, delta: entry.delta }));
        setSnapshot({ key, ranks, at: Date.now() });
      },
      { period },
    );

    return () => handle.close();
  }, [type, period]);

  /* 推送只带名次，按名次对已有数据重排即可，无需重新请求 */
  const items = useMemo<RankingItem[]>(() => {
    const base = data ?? [];
    if (liveRanks.size === 0) return base;
    return [...base]
      .sort((a, b) => (liveRanks.get(a.video.id)?.rank ?? a.rank) - (liveRanks.get(b.video.id)?.rank ?? b.rank))
      .map((item, index) => {
        const pushed = liveRanks.get(item.video.id);
        const trend: RankingItem['trend'] = pushed
          ? pushed.delta > 0
            ? 'up'
            : pushed.delta < 0
              ? 'down'
              : 'same'
          : item.trend;
        return { ...item, rank: index + 1, delta: pushed?.delta ?? item.delta, trend };
      });
  }, [data, liveRanks]);

  const topThree = items.slice(0, 3);
  const rest = items.slice(3);
  const stamp = pushedAt ?? dataUpdatedAt;
  const activePeriodLabel = PERIOD_TABS.find((item) => item.key === period)?.label ?? '';

  return (
    <PageContainer className="py-5 sm:py-6">
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="min-w-0">
          <SectionHeader
            level={1}
            title="排行榜"
            subtitle="按平台统一的热度规则排序，名次变化以日志比对结果为准。"
          />

          <div className="mt-4 flex flex-col gap-3">
            <Tabs items={TYPE_TABS} value={type} onChange={setType} scrollable />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
                {live && <span className="size-1.5 rounded-full bg-success animate-pulse-dot" aria-hidden />}
                {stamp > 0 ? `更新于 ${formatDate(stamp, 'HH:mm')}` : '等待更新'}
                {live ? ` · 实时 · ${activePeriodLabel}` : ` · ${activePeriodLabel}`}
              </span>
              <Tabs variant="segment" size="sm" items={PERIOD_TABS} value={period} onChange={setPeriod} />
            </div>

            {type === 'category' && (
              <div className="flex flex-col gap-2">
                <span className="text-xs text-fg-muted">选择分区</span>
                <div className="hide-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="分区筛选">
                  {categories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      aria-pressed={selectedCategoryId === category.id}
                      onClick={() => setCategoryId(category.id)}
                      className={cn(
                        'inline-flex h-8 shrink-0 items-center rounded-pill border px-3.5 text-[13px] font-medium transition-colors duration-150',
                        selectedCategoryId === category.id
                          ? 'border-transparent bg-fg text-canvas'
                          : 'border-line bg-surface text-fg-muted hover:border-fg-subtle hover:text-fg',
                      )}
                    >
                      {category.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-5">
            {isPending ? (
              <RankingSkeleton />
            ) : isError ? (
              <ErrorState
                title="榜单加载失败"
                description="榜单数据获取失败，请检查网络后重试。"
                onRetry={() => void refetch()}
              />
            ) : items.length === 0 ? (
              <EmptyState
                title="该榜单暂无数据"
                description="当前周期与分区下还没有达到入榜条件的内容，换个周期或分区看看。"
              />
            ) : (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-3">
                  {topThree.map((item) => (
                    <MedalCard key={item.video.id} item={item} />
                  ))}
                </div>

                {rest.length > 0 && (
                  <motion.ol layout className="flex flex-col gap-3">
                    {rest.map((item) => (
                      <motion.li
                        key={item.video.id}
                        layout
                        transition={{ duration: 0.32, ease: EASE.enter }}
                      >
                        <RankRow item={item} />
                      </motion.li>
                    ))}
                  </motion.ol>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <RankingAside activeType={type} />
        </aside>
      </div>
    </PageContainer>
  );
}
