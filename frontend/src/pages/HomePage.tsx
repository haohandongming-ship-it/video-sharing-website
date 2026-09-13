import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Flame, Sparkles, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { listItem, listContainer } from '@/lib/motion';
import { useCategories, useInfiniteRecommend } from '@/hooks/useApi';
import { useUiStore } from '@/stores/uiStore';
import { useAuthStore } from '@/stores/authStore';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadMoreSentinel,
  PageContainer,
  SectionHeader,
  Tabs,
  VideoCardSkeleton,
} from '@/components/ui';
import { VideoCard } from '@/components/video/VideoCard';

type SortKey = 'recommend' | 'latest' | 'hot' | 'views';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recommend', label: '推荐' },
  { key: 'latest', label: '最新' },
  { key: 'hot', label: '最热' },
  { key: 'views', label: '播放最多' },
];

export default function HomePage() {
  const [params, setParams] = useSearchParams();
  const categoryParam = params.get('category');
  const sortParam = (params.get('sort') as SortKey | null) ?? 'recommend';
  const categoryId = categoryParam ? Number(categoryParam) : undefined;

  const { data: categories } = useCategories();
  const personalization = useUiStore((s) => s.personalizationEnabled);
  const teenagerMode = useUiStore((s) => s.teenagerMode);
  const isLogin = useAuthStore((s) => s.status === 'authenticated');

  const query = useMemo(
    () => ({ videoType: 'LONG' as const, categoryId, sort: sortParam }),
    [categoryId, sortParam],
  );

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteRecommend(query);

  const videos = data?.pages.flatMap((page) => page.items) ?? [];

  const setParam = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    if (value === undefined || value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  return (
    <PageContainer className="py-5">
      {/* 合规提示：青少年模式 / 关闭个性化推荐 */}
      {teenagerMode && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-card border border-line bg-warning-soft px-3.5 py-2.5 text-xs text-warning">
          <Badge tone="warning">青少年模式</Badge>
          已开启青少年模式，仅展示适龄内容，每日使用上限 40 分钟。
          <Link to="/settings" className="ml-auto font-medium underline underline-offset-2">
            了解详情
          </Link>
        </div>
      )}

      {/* 分区导航：横向滚动，含「全部」 */}
      <CategoryBar
        categories={categories ?? []}
        activeId={categoryId}
        onSelect={(id) => setParam('category', id ? String(id) : undefined)}
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <SectionHeader
          level={1}
          title={categoryId ? (categories?.find((c) => c.id === categoryId)?.name ?? '分区') : '为你推荐'}
          subtitle={
            personalization
              ? '根据你的观看与互动记录排序，可在设置中关闭个性化推荐'
              : '已关闭个性化推荐，当前仅展示热门与时间线内容'
          }
        />
        <Tabs
          items={SORTS}
          value={sortParam}
          onChange={(key) => setParam('sort', key === 'recommend' ? undefined : key)}
          variant="segment"
          size="sm"
        />
      </div>

      {!personalization && !isLogin && (
        <p className="mt-2 text-xs text-fg-subtle">
          未登录状态下展示的是全站热门内容；
          <Link to="/login" className="text-accent hover:underline">
            登录
          </Link>
          后可获得个性化推荐。
        </p>
      )}

      <div className="mt-5">
        {isLoading ? (
          <HomeSkeleton />
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : videos.length === 0 ? (
          <EmptyState
            title="这里还没有内容"
            description={
              categoryId
                ? '该分区暂时没有已发布的视频，换个分区看看，或者成为第一个上传的人。'
                : '暂时没有可推荐的内容，稍后再来看看。'
            }
            action={
              <Link to="/upload">
                <Button variant="primary" size="sm">
                  上传视频
                </Button>
              </Link>
            }
          />
        ) : (
          <>
            <motion.div
              variants={listContainer}
              initial="initial"
              animate="animate"
              className="grid grid-cols-1 gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
            >
              {videos.map((video, index) => (
                <motion.div key={video.id} variants={listItem}>
                  <VideoCard
                    video={video}
                    showReason={sortParam === 'recommend' && index % 5 === 2}
                  />
                </motion.div>
              ))}
            </motion.div>
            <LoadMoreSentinel
              loading={isFetchingNextPage}
              hasMore={Boolean(hasNextPage)}
              onIntersect={() => void fetchNextPage()}
              endLabel="已经到底了，去排行榜看看热门内容"
            />
          </>
        )}
      </div>

      {/* 分区速览：横向卡片轨道 */}
      <CategoryRail categories={categories ?? []} onPick={(id) => setParam('category', String(id))} />
    </PageContainer>
  );
}

/* ------------------------------------------------------------ 分区导航 */

function CategoryBar({
  categories,
  activeId,
  onSelect,
}: {
  categories: { id: number; name: string }[];
  activeId?: number;
  onSelect: (id: number | null) => void;
}) {
  return (
    <div className="sticky top-14 z-40 -mx-4 border-b border-line bg-canvas/95 px-4 py-2 backdrop-blur-sm sm:-mx-6 sm:px-6">
      <div className="hide-scrollbar flex items-center gap-2 overflow-x-auto">
        <CategoryChip label="全部" active={!activeId} onClick={() => onSelect(null)} />
        {categories.map((category) => (
          <CategoryChip
            key={category.id}
            label={category.name}
            active={activeId === category.id}
            onClick={() => onSelect(category.id)}
          />
        ))}
      </div>
    </div>
  );
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-8 shrink-0 rounded-btn px-3 text-[13px] font-medium transition-colors duration-150',
        active ? 'bg-fg text-canvas' : 'bg-surface-2 text-fg-muted hover:bg-surface-3 hover:text-fg',
      )}
    >
      {label}
    </button>
  );
}

/* --------------------------------------------------------- 分区速览轨道 */

function CategoryRail({
  categories,
  onPick,
}: {
  categories: { id: number; name: string; slug: string }[];
  onPick: (id: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const sync = () => {
    const node = scroller.current;
    if (!node) return;
    setAtStart(node.scrollLeft <= 4);
    setAtEnd(node.scrollLeft + node.clientWidth >= node.scrollWidth - 4);
  };

  useEffect(() => {
    sync();
    const node = scroller.current;
    if (!node) return;
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    window.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [categories.length]);

  const scrollBy = (delta: number) => {
    const node = scroller.current;
    node?.scrollBy({ left: Math.max(160, Math.round(node.clientWidth * 0.75)) * Math.sign(delta), behavior: 'smooth' });
  };

  if (categories.length === 0) return null;

  const railItems = [
    { key: 'hot', icon: Flame, title: '热门榜', desc: '10 分钟更新', to: '/ranking' },
    { key: 'trend', icon: TrendingUp, title: '趋势榜', desc: '5 分钟更新', to: '/ranking' },
    { key: 'new', icon: Sparkles, title: '新人榜', desc: '每小时更新', to: '/ranking' },
  ];

  return (
    <section className="mt-12" aria-label="分区与榜单速览">
      <SectionHeader
        level={2}
        title="分区速览"
        subtitle="按兴趣直接进入分区，或从榜单发现正在上升的内容"
        action={
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="向左滚动"
              disabled={atStart}
              onClick={() => scrollBy(-400)}
              className="grid size-8 place-items-center rounded-full border border-line text-fg-muted transition-colors hover:bg-surface-2 disabled:opacity-40"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              aria-label="向右滚动"
              disabled={atEnd}
              onClick={() => scrollBy(400)}
              className="grid size-8 place-items-center rounded-full border border-line text-fg-muted transition-colors hover:bg-surface-2 disabled:opacity-40"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        }
      />

      <div
        ref={scroller}
        onScroll={sync}
        className="hide-scrollbar mt-4 grid auto-cols-[minmax(150px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1"
      >
        {railItems.map((item) => (
          <Link
            key={item.key}
            to={item.to}
            className="group flex flex-col gap-1 rounded-card border border-line bg-surface p-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-raised"
          >
            <item.icon className="size-4 text-brand" aria-hidden />
            <span className="mt-1 text-sm font-semibold text-fg">{item.title}</span>
            <span className="text-[11px] text-fg-subtle">{item.desc}</span>
          </Link>
        ))}
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => onPick(category.id)}
            className="group flex aspect-[4/3] min-w-[150px] flex-col justify-end rounded-card border border-line bg-surface-2 p-3 text-left transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-raised"
          >
            <span className="text-sm font-semibold text-fg group-hover:text-accent">{category.name}</span>
            <span className="text-[11px] text-fg-subtle">进入分区</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- 骨架屏 */

function HomeSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-busy>
      {Array.from({ length: 12 }, (_, i) => (
        <VideoCardSkeleton key={i} />
      ))}
    </div>
  );
}
