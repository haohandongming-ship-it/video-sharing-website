/**
 * 创作者中心（开发文档 3.1 / 17）：数据看板 / 内容管理 / 合规与认证
 * 趋势图为纯 SVG 手写实现（不引入图表库）：X 轴日期、Y 轴自适应、网格线、hover 提示。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Clock,
  Coins,
  Download,
  Eye,
  FileCheck,
  Heart,
  MessageSquare,
  MoreVertical,
  Pencil,
  ShieldCheck,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { VIDEO_STATUS_LABELS } from '@/lib/constants';
import { formatCount, formatDuration, formatDurationText, formatPercent, formatRelative } from '@/lib/format';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { videoApi } from '@/api/videos';
import {
  useCreatorDashboard,
  useCreatorVideos,
  useDeleteVideo,
  useUpdateVideo,
  useVideoDetail,
} from '@/hooks/useApi';
import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  ListSkeleton,
  Modal,
  PageContainer,
  Pagination,
  ProgressBar,
  RadioGroup,
  SectionHeader,
  StatTile,
  SurfaceCard,
  Tabs,
  Textarea,
} from '@/components/ui';
import type { CreatorDashboard, CreatorVideoRow } from '@/api/users';
import type { VideoDetail, Visibility } from '@/api/types';

/* ------------------------------------------------------------ 常量与类型 */

const SECTION_TABS = [
  { key: 'dashboard', label: '数据看板' },
  { key: 'content', label: '内容管理' },
  { key: 'compliance', label: '合规与认证' },
] as const;
type CreatorSection = (typeof SECTION_TABS)[number]['key'];

const PERIOD_TABS = [
  { key: '7', label: '近 7 天' },
  { key: '30', label: '近 30 天' },
  { key: '90', label: '近 90 天' },
] as const;
type PeriodKey = (typeof PERIOD_TABS)[number]['key'];

const METRIC_TABS = [
  { key: 'views', label: '播放量' },
  { key: 'likes', label: '点赞' },
  { key: 'comments', label: '评论' },
  { key: 'favorites', label: '收藏' },
  { key: 'followers', label: '涨粉' },
] as const;
type MetricKey = (typeof METRIC_TABS)[number]['key'];

const CONTENT_STATUS_TABS = [
  { key: 'ALL', label: '全部' },
  { key: 'PROCESSING', label: '转码中' },
  { key: 'REVIEWING', label: '审核中' },
  { key: 'PUBLISHED', label: '已发布' },
  { key: 'REJECTED', label: '未通过' },
] as const;
type ContentStatus = (typeof CONTENT_STATUS_TABS)[number]['key'];

/** 与服务端默认每页条数保持一致（文档 5.4） */
const CONTENT_PAGE_SIZE = 10;
const RANKING_LIMIT = 8;

const VISIBILITY_OPTIONS: { value: Visibility; label: string; description: string }[] = [
  { value: 'PUBLIC', label: '公开', description: '所有人都能搜索、观看与收藏' },
  { value: 'UNLISTED', label: '不列出', description: '仅通过链接访问，不出现在推荐与搜索中' },
  { value: 'PRIVATE', label: '仅自己可见', description: '只有你自己能观看' },
];

function statusTone(status: CreatorVideoRow['status']): 'neutral' | 'accent' | 'warning' | 'success' | 'danger' {
  if (status === 'PUBLISHED') return 'success';
  if (status === 'PROCESSING') return 'accent';
  if (status === 'REVIEWING') return 'warning';
  if (status === 'REJECTED') return 'danger';
  return 'neutral';
}

function splitTags(input: string): string[] {
  return input
    .split(/[，,、]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .slice(0, 10);
}

/* ---------------------------------------------------------------- 页面 */

export default function CreatorPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [section, setSection] = useState<CreatorSection>('dashboard');
  const [period, setPeriod] = useState<PeriodKey>('30');
  const days = Number(period);

  const dashboardQuery = useCreatorDashboard(days);
  /** 身份卡使用固定 30 天口径，切换看板周期时不会闪空（同一 key 自动复用缓存） */
  const identityQuery = useCreatorDashboard(30);
  const overview = identityQuery.data;
  const certified = user?.realNameStatus === 'CERTIFIED';

  function goSection(next: CreatorSection) {
    setSection(next);
    document.getElementById(`creator-${next}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <PageContainer className="py-4 sm:py-6">
      <SectionHeader
        level={1}
        title="创作者中心"
        subtitle="作品数据、内容管理与合规要求都集中在这里。"
        className="mb-4"
      />

      {/* 创作者身份卡 */}
      <SurfaceCard className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3.5">
          <Avatar src={user?.avatar} name={user?.nickname ?? '创作者'} size="xl" certified={user?.certified} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-fg">{user?.nickname ?? '未登录'}</h2>
              <Badge tone={certified ? 'success' : 'warning'}>
                {certified ? '已实名认证' : '未认证'}
              </Badge>
            </div>
            <p className="mt-1 truncate text-xs text-fg-muted">@{user?.username ?? '-'}</p>
            {!certified && (
              <Button size="xs" variant="link" className="mt-1.5" onClick={() => navigate('/settings')}>
                去完成实名认证
              </Button>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-fg-muted">粉丝数</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-fg">
              {overview ? formatCount(overview.followerTotal) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-muted">近期涨粉（30 天）</dt>
            <dd
              className={cn(
                'mt-0.5 text-lg font-semibold tabular-nums',
                (overview?.followerDelta ?? 0) >= 0 ? 'text-success' : 'text-brand',
              )}
            >
              {overview ? `${overview.followerDelta >= 0 ? '+' : ''}${formatCount(overview.followerDelta)}` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-muted">平均播放时长</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-fg">
              {overview ? formatDurationText(overview.avgWatchSeconds) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-muted">完播率</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-fg">
              {overview ? formatPercent(overview.completionRate) : '—'}
            </dd>
          </div>
        </dl>
      </SurfaceCard>

      {/* 移动端锚点切换 */}
      <Tabs
        className="mt-4 lg:hidden"
        variant="pill"
        size="sm"
        scrollable
        items={SECTION_TABS.map((item) => ({ key: item.key, label: item.label }))}
        value={section}
        onChange={goSection}
      />

      <div className="mt-4 grid gap-6 lg:grid-cols-[184px_minmax(0,1fr)]">
        {/* 桌面端粘性锚点导航 */}
        <nav aria-label="创作者中心导航" className="hidden lg:block">
          <ul className="sticky top-20 flex flex-col gap-0.5">
            {SECTION_TABS.map((item) => {
              const active = section === item.key;
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => goSection(item.key)}
                    className={cn(
                      'w-full rounded-btn px-2.5 py-2 text-left text-[13px] transition-colors',
                      active ? 'bg-surface-2 font-medium text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                    )}
                  >
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-8">
          <DashboardSection
            days={days}
            period={period}
            onPeriodChange={setPeriod}
            data={dashboardQuery.data}
            isLoading={dashboardQuery.isLoading}
            isError={dashboardQuery.isError}
            onRetry={() => void dashboardQuery.refetch()}
          />
          <ContentSection onStats={() => goSection('dashboard')} />
          <ComplianceSection certified={certified} />
        </div>
      </div>
    </PageContainer>
  );
}

/* ------------------------------------------------------------ 区块外壳 */

function SectionShell({
  id,
  title,
  subtitle,
  action,
  children,
}: {
  id: CreatorSection;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={`creator-${id}`} className="scroll-mt-20">
      <SectionHeader title={title} subtitle={subtitle} action={action} className="mb-3" />
      {children}
    </section>
  );
}

/* ------------------------------------------------------------ 数据看板 */

interface DashboardSectionProps {
  days: number;
  period: PeriodKey;
  onPeriodChange: (next: PeriodKey) => void;
  data: CreatorDashboard | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

function DashboardSection({
  days,
  period,
  onPeriodChange,
  data,
  isLoading,
  isError,
  onRetry,
}: DashboardSectionProps) {
  const [metric, setMetric] = useState<MetricKey>('views');
  const ranking = useCreatorVideos({ page: 1 });

  const topVideos = useMemo(() => {
    const rows = [...(ranking.data?.items ?? [])];
    rows.sort((a, b) => b.stats.views - a.stats.views);
    return rows.slice(0, RANKING_LIMIT);
  }, [ranking.data]);
  const maxViews = topVideos.reduce((max, video) => Math.max(max, video.stats.views), 0);

  const trendPoints = useMemo(
    () => (data?.trend ?? []).map((point) => ({ date: point.date, value: point[metric] })),
    [data, metric],
  );
  const hasData = Boolean(
    data &&
      data.trend.some(
        (point) => point.views > 0 || point.likes > 0 || point.comments > 0 || point.favorites > 0,
      ),
  );

  return (
    <SectionShell
      id="dashboard"
      title="数据看板"
      subtitle={`近 ${days} 天的播放与互动表现，按自然日汇总。`}
      action={
        <Tabs
          variant="segment"
          size="sm"
          items={PERIOD_TABS.map((item) => ({ key: item.key, label: item.label }))}
          value={period}
          onChange={onPeriodChange}
        />
      }
    >
      {isLoading ? (
        <div className="flex flex-col gap-3">
          <ListSkeleton rows={2} />
          <ListSkeleton rows={4} />
        </div>
      ) : isError ? (
        <ErrorState onRetry={onRetry} />
      ) : !data || !hasData ? (
        <SurfaceCard>
          <EmptyState
            icon={<BarChart3 className="size-7" />}
            title="数据还在积累中，发布第一个作品后这里会展示表现数据"
            description="作品通过审核后，播放、互动与涨粉数据会按天汇总到这里。"
            action={
              <Link to="/upload">
                <Button variant="primary" size="sm" icon={<Upload className="size-3.5" />}>
                  上传视频
                </Button>
              </Link>
            }
          />
        </SurfaceCard>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="播放量"
              value={formatCount(data.totals.views)}
              hint={`近 ${days} 天累计`}
              icon={<Eye className="size-4" />}
            />
            <StatTile
              label="点赞"
              value={formatCount(data.totals.likes)}
              hint={`近 ${days} 天累计`}
              icon={<Heart className="size-4" />}
            />
            <StatTile
              label="评论"
              value={formatCount(data.totals.comments)}
              hint={`近 ${days} 天累计`}
              icon={<MessageSquare className="size-4" />}
            />
            <StatTile
              label="收藏"
              value={formatCount(data.totals.favorites)}
              hint={`近 ${days} 天累计`}
              icon={<Star className="size-4" />}
            />
          </div>

          <SurfaceCard className="mt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-fg">数据趋势</h3>
              <Tabs
                variant="segment"
                size="sm"
                items={METRIC_TABS.map((item) => ({ key: item.key, label: item.label }))}
                value={metric}
                onChange={setMetric}
              />
            </div>
            <TrendChart points={trendPoints} metricLabel={METRIC_LABELS[metric]} />
            <p className="mt-2 text-[11px] text-fg-subtle">
              当日数据在次日 06:00 前完成校准，跨设备统计可能存在少量延迟。
            </p>
          </SurfaceCard>

          <SurfaceCard className="mt-4">
            <h3 className="text-sm font-medium text-fg">作品表现排行</h3>
            <p className="mt-1 text-[11px] text-fg-subtle">按累计播放量排序，展示前 {RANKING_LIMIT} 条作品。</p>
            {ranking.isLoading ? (
              <div className="mt-3">
                <ListSkeleton rows={4} />
              </div>
            ) : ranking.isError ? (
              <ErrorState className="py-8" onRetry={() => void ranking.refetch()} />
            ) : topVideos.length === 0 ? (
              <EmptyState
                compact
                title="还没有可统计的作品"
                description="作品发布并通过审核后，这里会按播放量排出名次。"
              />
            ) : (
              <ul className="mt-3 flex flex-col gap-3.5">
                {topVideos.map((video, index) => (
                  <li key={video.id}>
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        to={`/video/${video.id}`}
                        className="min-w-0 truncate text-[13px] font-medium text-fg hover:text-accent"
                      >
                        {index + 1}. {video.title}
                      </Link>
                      <span className="shrink-0 text-[11px] tabular-nums text-fg-muted">
                        播放 {formatCount(video.stats.views)}
                      </span>
                    </div>
                    <ProgressBar
                      className="mt-1.5"
                      tone="accent"
                      value={maxViews > 0 ? (video.stats.views / maxViews) * 100 : 0}
                    />
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-fg-subtle">
                      <span>点赞 {formatCount(video.stats.likes)}</span>
                      <span>评论 {formatCount(video.stats.comments)}</span>
                      <span>收藏 {formatCount(video.stats.favorites)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SurfaceCard>
        </>
      )}
    </SectionShell>
  );
}

const METRIC_LABELS: Record<MetricKey, string> = {
  views: '播放量',
  likes: '点赞',
  comments: '评论',
  favorites: '收藏',
  followers: '涨粉',
};

/* ------------------------------------------------------------ 趋势图 */

interface TrendPoint {
  date: string;
  value: number;
}

/** Y 轴取整到易读刻度，避免顶部贴着绘图区 */
function niceCeil(value: number): number {
  if (value <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = magnitude / 2;
  return Math.ceil(value / step) * step;
}

/** 天数较多时只保留首、中、尾三个 X 轴标签，避免文字重叠 */
function xLabelIndexes(count: number): number[] {
  if (count === 0) return [];
  if (count === 1) return [0];
  if (count > 30) return [0, Math.floor((count - 1) / 2), count - 1];
  const step = Math.max(1, Math.ceil((count - 1) / 5));
  const list: number[] = [];
  for (let index = 0; index < count; index += step) list.push(index);
  if (list[list.length - 1] !== count - 1) list.push(count - 1);
  return list;
}

function TrendChart({ points, metricLabel }: { points: TrendPoint[]; metricLabel: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const update = () => setWidth(Math.max(280, Math.round(node.clientWidth)));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const height = 224;
  const padding = { top: 16, right: 14, bottom: 28, left: 48 };
  const plotWidth = Math.max(1, width - padding.left - padding.right);
  const plotHeight = height - padding.top - padding.bottom;
  const yMax = niceCeil(points.reduce((max, point) => Math.max(max, point.value), 0));

  const xAt = (index: number) =>
    padding.left + (points.length <= 1 ? plotWidth / 2 : (plotWidth * index) / (points.length - 1));
  const yAt = (value: number) => padding.top + plotHeight - (value / yMax) * plotHeight;

  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${xAt(index).toFixed(1)} ${yAt(point.value).toFixed(1)}`)
    .join(' ');
  const areaPath =
    points.length > 0
      ? `${linePath} L${xAt(points.length - 1).toFixed(1)} ${padding.top + plotHeight} L${xAt(0).toFixed(1)} ${
          padding.top + plotHeight
        } Z`
      : '';
  const gridRatios = [0, 0.25, 0.5, 0.75, 1];
  const labels = xLabelIndexes(points.length);
  const activePoint = activeIndex === null ? null : points[activeIndex];

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${metricLabel}趋势，共 ${points.length} 天`}
        className="block max-w-full"
      >
        <defs>
          <linearGradient id="creator-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--c-accent)" stopOpacity="0.24" />
            <stop offset="100%" stopColor="var(--c-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridRatios.map((ratio) => {
          const y = padding.top + plotHeight * (1 - ratio);
          return (
            <g key={ratio}>
              <line
                x1={padding.left}
                x2={padding.left + plotWidth}
                y1={y}
                y2={y}
                stroke="var(--c-line)"
                strokeWidth={1}
                strokeDasharray={ratio === 0 ? undefined : '3 4'}
              />
              <text x={padding.left - 8} y={y + 3.5} textAnchor="end" fontSize={10} fill="var(--c-fg-subtle)">
                {formatCount(yMax * ratio)}
              </text>
            </g>
          );
        })}

        {labels.map((index) => (
          <text
            key={index}
            x={xAt(index)}
            y={height - 8}
            textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
            fontSize={10}
            fill="var(--c-fg-subtle)"
          >
            {points[index].date.slice(5)}
          </text>
        ))}

        {areaPath && <path d={areaPath} fill="url(#creator-trend-fill)" />}
        <path
          d={linePath}
          fill="none"
          stroke="var(--c-accent)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {activeIndex !== null && activePoint && (
          <g>
            <line
              x1={xAt(activeIndex)}
              x2={xAt(activeIndex)}
              y1={padding.top}
              y2={padding.top + plotHeight}
              stroke="var(--c-fg-subtle)"
              strokeWidth={1}
              strokeDasharray="3 4"
            />
            <circle
              cx={xAt(activeIndex)}
              cy={yAt(activePoint.value)}
              r={3.5}
              fill="var(--c-accent)"
              stroke="var(--c-surface)"
              strokeWidth={2}
            />
          </g>
        )}

        <rect
          x={padding.left}
          y={padding.top}
          width={plotWidth}
          height={plotHeight}
          fill="transparent"
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
            const index = Math.round(ratio * Math.max(0, points.length - 1));
            setActiveIndex(Math.min(points.length - 1, Math.max(0, index)));
          }}
          onMouseLeave={() => setActiveIndex(null)}
        />
      </svg>

      {activeIndex !== null && activePoint && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-btn border border-line bg-surface px-2.5 py-1.5 text-[11px] whitespace-nowrap shadow-raised"
          style={{ left: Math.min(Math.max(xAt(activeIndex), 68), width - 68) }}
        >
          <span className="block text-fg-subtle">{activePoint.date}</span>
          <span className="mt-0.5 block font-semibold tabular-nums text-fg">
            {metricLabel} {formatCount(activePoint.value)}
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ 内容管理 */

function ContentSection({ onStats }: { onStats: () => void }) {
  const [status, setStatus] = useState<ContentStatus>('ALL');
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState(0);

  const videos = useCreatorVideos({ page, status: status === 'ALL' ? undefined : status });
  const remove = useDeleteVideo();
  const openConfirm = useUiStore((s) => s.openConfirm);

  const items = useMemo(() => videos.data?.items ?? [], [videos.data]);
  const statusLabel = CONTENT_STATUS_TABS.find((item) => item.key === status)?.label ?? '全部';

  function changeStatus(next: ContentStatus) {
    setStatus(next);
    setPage(1);
  }

  function confirmDelete(video: CreatorVideoRow) {
    openConfirm({
      title: `删除《${video.title}》？`,
      description: '移入回收站，30 天内可恢复；恢复入口在回收站中。',
      confirmText: '移入回收站',
      danger: true,
      onConfirm: () => remove.mutate(video.id),
    });
  }

  return (
    <SectionShell
      id="content"
      title="内容管理"
      subtitle="查看转码与审核状态，修改作品信息或清理不再需要的内容。"
      action={
        <Link to="/upload">
          <Button variant="primary" size="sm" icon={<Upload className="size-3.5" />}>
            上传新视频
          </Button>
        </Link>
      }
    >
      <Tabs
        variant="pill"
        size="sm"
        scrollable
        items={CONTENT_STATUS_TABS.map((item) => ({ key: item.key, label: item.label }))}
        value={status}
        onChange={changeStatus}
      />

      <SurfaceCard padded={false} className="mt-3 overflow-hidden">
        {videos.isLoading ? (
          <div className="p-3">
            <ListSkeleton rows={5} />
          </div>
        ) : videos.isError ? (
          <ErrorState className="py-10" onRetry={() => void videos.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="size-7" />}
            title="还没有作品，去上传第一个吧"
            description={
              status === 'ALL'
                ? '支持 MP4 / MOV / WebM，长视频与短视频都可以上传。'
                : `当前没有「${statusLabel}」状态的作品。`
            }
            action={
              <Link to="/upload">
                <Button variant="primary" size="sm" icon={<Upload className="size-3.5" />}>
                  上传视频
                </Button>
              </Link>
            }
          />
        ) : (
          <ul>
            {items.map((video) => (
              <ContentRow
                key={video.id}
                video={video}
                onEdit={() => setEditingId(video.id)}
                onDelete={() => confirmDelete(video)}
                onStats={onStats}
              />
            ))}
          </ul>
        )}
      </SurfaceCard>

      <Pagination
        className="mt-4"
        page={page}
        total={videos.data?.total ?? 0}
        pageSize={CONTENT_PAGE_SIZE}
        onChange={setPage}
      />

      {editingId > 0 && <EditVideoModal videoId={editingId} onClose={() => setEditingId(0)} />}
    </SectionShell>
  );
}

function ContentRow({
  video,
  onEdit,
  onDelete,
  onStats,
}: {
  video: CreatorVideoRow;
  onEdit: () => void;
  onDelete: () => void;
  onStats: () => void;
}) {
  const toast = useUiStore((s) => s.toast);
  const canDownload =
    useAuthStore((s) => s.user?.permissions.includes('video:download') ?? false) && video.status === 'PUBLISHED';
  const downloadSource = async () => {
    try {
      const result = await videoApi.download(video.id);
      const link = document.createElement('a');
      link.href = result.url;
      link.download = result.fileName ?? `${video.title}.mp4`;
      link.target = '_blank';
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      toast({ title: '下载失败', description: error instanceof Error ? error.message : '请稍后重试', tone: 'error' });
    }
  };

  return (
    <li className="flex gap-3 border-b border-line px-3.5 py-3.5 last:border-b-0">
      <Link
        to={`/video/${video.id}`}
        className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-card bg-surface-2 sm:w-40"
      >
        <img
          src={video.coverUrl}
          alt={video.title}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
        <span className="absolute right-1.5 bottom-1.5 rounded-[4px] bg-black/78 px-1.5 py-0.5 text-[11px] tabular-nums text-white">
          {formatDuration(video.duration)}
        </span>
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/video/${video.id}`} className="line-clamp-2 text-sm font-medium text-fg hover:text-accent">
            {video.title}
          </Link>
          <Dropdown
            align="end"
            items={[
              { key: 'edit', label: '编辑信息', icon: <Pencil className="size-3.5" />, onSelect: onEdit },
              ...(canDownload
                ? [
                    {
                      key: 'download',
                      label: '下载源文件',
                      icon: <Download className="size-3.5" />,
                      onSelect: () => void downloadSource(),
                    },
                  ]
                : []),
              {
                key: 'stats',
                label: '查看数据',
                icon: <BarChart3 className="size-3.5" />,
                onSelect: onStats,
              },
              {
                key: 'delete',
                label: '删除',
                icon: <Trash2 className="size-3.5" />,
                danger: true,
                separatorBefore: true,
                onSelect: onDelete,
              },
            ]}
            trigger={({ toggle }) => (
              <IconButton label="更多操作" size="icon-sm" onClick={toggle}>
                <MoreVertical className="size-4" />
              </IconButton>
            )}
          />
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-fg-muted">
          <Badge tone={statusTone(video.status)}>{VIDEO_STATUS_LABELS[video.status] ?? video.status}</Badge>
          {video.category && <span>{video.category.name}</span>}
          <span>{formatRelative(video.publishedAt)}</span>
          <span className="inline-flex items-center gap-1">
            <Eye className="size-3" aria-hidden />
            {formatCount(video.stats.views)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Heart className="size-3" aria-hidden />
            {formatCount(video.stats.likes)}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="size-3" aria-hidden />
            {formatCount(video.stats.comments)}
          </span>
          <span className="text-fg-subtle">近 7 天播放 {formatCount(video.views7d)}</span>
        </div>

        {video.status === 'PROCESSING' && (
          <div className="mt-2 flex items-center gap-2">
            <ProgressBar className="max-w-64" tone="accent" value={video.transcodeProgress} />
            <span className="shrink-0 text-[11px] tabular-nums text-fg-muted">
              {Math.round(video.transcodeProgress)}%
            </span>
          </div>
        )}
        {video.status === 'REVIEWING' && (
          <p className="mt-1.5 text-[11px] text-fg-muted">预计 30 分钟内完成审核</p>
        )}
        {video.status === 'REJECTED' && video.rejectReason && (
          <p className="mt-1.5 text-[11px] text-brand">未通过原因：{video.rejectReason}</p>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------ 编辑弹窗 */

function FormField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-fg-subtle">{hint}</span>}
    </div>
  );
}

/** 详情加载完成后才挂载表单，初始值直接来自服务端数据，无需在 effect 里回填 */
function EditVideoModal({ videoId, onClose }: { videoId: number; onClose: () => void }) {
  const { data, isLoading, isError, refetch } = useVideoDetail(videoId);

  if (isLoading) {
    return (
      <Modal open onClose={onClose} title="编辑作品信息">
        <ListSkeleton rows={4} />
      </Modal>
    );
  }

  if (isError || !data) {
    return (
      <Modal open onClose={onClose} title="编辑作品信息">
        <ErrorState description="没有取到作品信息，请稍后重试。" onRetry={() => void refetch()} />
      </Modal>
    );
  }

  return <EditVideoForm video={data} onClose={onClose} />;
}

function EditVideoForm({ video, onClose }: { video: VideoDetail; onClose: () => void }) {
  const update = useUpdateVideo();
  const toast = useUiStore((s) => s.toast);

  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description);
  const [tags, setTags] = useState(video.tags.join('、'));
  const [visibility, setVisibility] = useState<Visibility>(video.visibility);

  function handleSave() {
    const nextTitle = title.trim();
    if (!nextTitle) {
      toast({ title: '请填写作品标题', tone: 'warning' });
      return;
    }
    update.mutate(
      {
        id: video.id,
        payload: { title: nextTitle, description: description.trim(), tags: splitTags(tags), visibility },
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="编辑作品信息"
      description="标题、简介与标签会展示在作品页，保存后立即生效。"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" size="sm" loading={update.isPending} onClick={handleSave}>
            保存
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField label="标题">
          <Input aria-label="标题" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
        </FormField>
        <FormField label="简介" hint="写清内容看点与引用来源，便于审核与观众理解。">
          <Textarea
            aria-label="简介"
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>
        <FormField label="标签" hint="用顿号或逗号分隔，最多 10 个。">
          <Input
            aria-label="标签"
            value={tags}
            placeholder="例如：架构、后端、踩坑记录"
            onChange={(event) => setTags(event.target.value)}
          />
        </FormField>
        <FormField label="可见性">
          <RadioGroup
            name="creator-visibility"
            value={visibility}
            onChange={setVisibility}
            options={VISIBILITY_OPTIONS}
          />
        </FormField>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------- 合规与认证 */

function ComplianceCard({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <SurfaceCard className="flex gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-fg-muted">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium text-fg">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">{description}</p>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </SurfaceCard>
  );
}

function ComplianceSection({ certified }: { certified: boolean }) {
  const navigate = useNavigate();

  return (
    <SectionShell id="compliance" title="合规与认证" subtitle="发布前确认以下要求，可以减少作品被驳回的情况。">
      <div className="flex flex-col gap-3">
        <ComplianceCard
          icon={<ShieldCheck className="size-4" />}
          title="实名认证"
          description="实名信息仅用于账号安全与合规核验，不会公开展示。完成认证后才能申请收益结算与下载授权。"
          action={
            certified ? (
              <Badge tone="success">已实名认证</Badge>
            ) : (
              <Button size="sm" variant="primary" onClick={() => navigate('/settings')}>
                去完成实名认证
              </Button>
            )
          }
        />
        <ComplianceCard
          icon={<FileCheck className="size-4" />}
          title="内容原创声明"
          description="上传时需勾选原创声明。转载或二次创作需取得授权，并在简介中注明来源；重复搬运他人内容会被限制推荐。"
        />
        <ComplianceCard
          icon={<Clock className="size-4" />}
          title="先审后发策略"
          description="新注册用户 72 小时内发布的内容采用先审后发：审核通过后才会公开展示，未通过会收到具体原因并可修改后重新提交。"
        />
        <ComplianceCard
          icon={<Coins className="size-4" />}
          title="收益与下载授权"
          description="收益中心当前处于内测阶段，尚未开放。作品下载授权由作者自行决定，关闭后观众只能在线观看，无法下载源文件。"
        />
      </div>
    </SectionShell>
  );
}
