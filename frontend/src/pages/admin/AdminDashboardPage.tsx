/**
 * 数据概览：平台核心指标、近 14 天趋势（纯 SVG 手写图表）与分区分布。
 * 仅 admin:analytics 可见，数据来自 useAdminOverview()。
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Flag, ShieldCheck, TriangleAlert } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  ListSkeleton,
  ProgressBar,
  SectionHeader,
  StatTile,
  SurfaceCard,
  Tabs,
} from '@/components/ui';
import { useAdminOverview } from '@/hooks/useApi';
import { cn } from '@/lib/cn';
import { formatCount, formatPercent } from '@/lib/format';
import type { AdminOverview } from '@/api/types';
import { useAuthStore } from '@/stores/authStore';

type TrendMetric = 'uploads' | 'views' | 'newUsers';

const METRIC_TABS: { key: TrendMetric; label: string }[] = [
  { key: 'uploads', label: '上传量' },
  { key: 'views', label: '播放量' },
  { key: 'newUsers', label: '新增用户' },
];

const METRIC_LABELS: Record<TrendMetric, string> = {
  uploads: '上传量',
  views: '播放量',
  newUsers: '新增用户',
};

/* --------------------------------------------------------------- 趋势图 */

const CHART_TOP = 10;
const CHART_BOTTOM = 90;

function TrendChart({ points, metric }: { points: AdminOverview['trend']; metric: TrendMetric }) {
  const [hover, setHover] = useState<number | null>(null);

  const values = useMemo(() => points.map((point) => point[metric]), [points, metric]);
  const max = Math.max(...values, 1);
  const xAt = (index: number) => (values.length <= 1 ? 50 : (index / (values.length - 1)) * 100);
  const yAt = (value: number) => CHART_BOTTOM - (value / max) * (CHART_BOTTOM - CHART_TOP);

  const line = values.map((value, index) => `${index === 0 ? 'M' : 'L'} ${xAt(index).toFixed(2)} ${yAt(value).toFixed(2)}`).join(' ');
  const area = `${line} L 100 ${CHART_BOTTOM} L 0 ${CHART_BOTTOM} Z`;
  const total = values.reduce((sum, value) => sum + value, 0);
  const hoverIndex = hover ?? 0;
  const tooltipLeft = Math.min(86, Math.max(14, xAt(hoverIndex)));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
        <span>
          近 14 天合计 <span className="font-medium tabular-nums text-fg">{formatCount(total)}</span>
        </span>
        <span>
          单日峰值 <span className="font-medium tabular-nums text-fg">{formatCount(max)}</span>
        </span>
      </div>

      <div className="relative">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-44 w-full sm:h-52"
          role="img"
          aria-label={`${METRIC_LABELS[metric]}近 14 天趋势`}
        >
          <defs>
            <linearGradient id="admin-trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--c-accent)" stopOpacity="0.26" />
              <stop offset="100%" stopColor="var(--c-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((step) => {
            const y = CHART_TOP + (step * (CHART_BOTTOM - CHART_TOP)) / 4;
            return (
              <line
                key={step}
                x1="0"
                x2="100"
                y1={y}
                y2={y}
                stroke="var(--c-line)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          <path d={area} fill="url(#admin-trend-fill)" />
          <path
            d={line}
            fill="none"
            stroke="var(--c-accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {hover !== null && (
            <line
              x1={xAt(hover)}
              x2={xAt(hover)}
              y1={CHART_TOP}
              y2={CHART_BOTTOM}
              stroke="var(--c-accent)"
              strokeWidth="1"
              strokeDasharray="3 3"
              opacity="0.6"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {hover !== null && (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent"
              style={{ left: `${xAt(hover)}%`, top: `${yAt(values[hover])}%` }}
            />
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-[6px] border border-line bg-surface px-2 py-1 text-[11px] whitespace-nowrap shadow-raised"
              style={{ left: `${tooltipLeft}%` }}
            >
              <span className="text-fg-subtle tabular-nums">{points[hover].date.slice(5)}</span>
              <span className="ml-1.5 font-medium tabular-nums text-fg">{formatCount(values[hover])}</span>
              <span className="ml-1 text-fg-muted">{METRIC_LABELS[metric]}</span>
            </div>
          </>
        )}

        <div className="absolute inset-0 flex" aria-hidden>
          {values.map((_, index) => (
            <div
              key={index}
              className="h-full flex-1"
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </div>
      </div>

      <div className="mt-1.5 flex">
        {points.map((point, index) => (
          <span
            key={point.date}
            className={cn('flex-1 text-center text-[10px] tabular-nums text-fg-subtle', index % 2 === 1 && 'invisible sm:visible')}
          >
            {point.date.slice(5)}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- 快捷入口卡 */

function QuickCard({
  title,
  value,
  description,
  actionLabel,
  icon,
  onAction,
}: {
  title: string;
  value: number;
  description: string;
  actionLabel: string;
  icon: ReactNode;
  onAction: () => void;
}) {
  return (
    <SurfaceCard className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-fg-muted">{title}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-fg">{formatCount(value)}</p>
        </div>
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-fg-muted">{icon}</span>
      </div>
      <p className="text-[11px] leading-relaxed text-fg-subtle">{description}</p>
      <Button variant="outline" size="sm" className="mt-auto self-start" onClick={onAction}>
        {actionLabel}
      </Button>
    </SurfaceCard>
  );
}

/* ------------------------------------------------------------------ 页面 */

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const canView = useAuthStore((s) => s.user?.permissions.includes('admin:analytics') ?? false);
  const [metric, setMetric] = useState<TrendMetric>('uploads');
  const { data, isPending, isError, refetch } = useAdminOverview();

  if (!canView) {
    return (
      <EmptyState
        icon={<ShieldCheck className="size-7" />}
        title="当前账号无权查看数据分析"
        description="数据概览仅对具备 admin:analytics 权限的账号开放，可继续使用内容审核与举报处理功能。"
      />
    );
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="h-[86px] rounded-card border border-line bg-surface p-4">
              <div className="skeleton-sheen h-3 w-16 rounded-[4px]" />
              <div className="skeleton-sheen mt-3 h-6 w-20 rounded-[4px]" />
            </div>
          ))}
        </div>
        <ListSkeleton rows={5} />
      </div>
    );
  }

  if (isError || !data) {
    return <ErrorState title="数据概览加载失败" description="指标数据暂时不可用，请稍后重试。" onRetry={() => void refetch()} />;
  }

  const totalCategory = data.categoryDistribution.reduce((sum, item) => sum + item.value, 0) || 1;
  const categories = [...data.categoryDistribution].sort((a, b) => b.value - a.value);

  return (
    <div className="flex flex-col gap-5">
      <section>
        <SectionHeader level={3} title="用户" className="mb-2.5" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="总用户数" value={formatCount(data.users.total)} />
          <StatTile label="今日新增" value={formatCount(data.users.todayNew)} />
          <StatTile label="今日活跃" value={formatCount(data.users.activeToday)} />
          <StatTile label="封禁账号" value={formatCount(data.users.banned)} />
        </div>
      </section>

      <section>
        <SectionHeader level={3} title="视频" className="mb-2.5" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="视频总数" value={formatCount(data.videos.total)} />
          <StatTile label="今日上传" value={formatCount(data.videos.todayNew)} />
          <StatTile label="转码中" value={formatCount(data.videos.processing)} />
          <StatTile label="待审核" value={formatCount(data.videos.reviewing)} />
        </div>
      </section>

      <section>
        <SectionHeader level={3} title="互动" className="mb-2.5" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="今日评论" value={formatCount(data.interaction.commentsToday)} />
          <StatTile label="今日点赞" value={formatCount(data.interaction.likesToday)} />
          <StatTile label="待处理举报" value={formatCount(data.interaction.reportsPending)} />
        </div>
      </section>

      <section>
        <SectionHeader level={3} title="转码队列" className="mb-2.5" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="队列排队" value={formatCount(data.transcode.queued)} hint="等待调度" />
          <StatTile label="运行中" value={formatCount(data.transcode.running)} hint="正在转码" />
          <StatTile label="今日失败" value={formatCount(data.transcode.failedToday)} hint="需人工排查" />
          <StatTile label="平均耗时（秒）" value={formatCount(data.transcode.avgSeconds)} hint="近 24 小时均值" />
        </div>
      </section>

      <SurfaceCard padded={false} className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-fg">近 14 天趋势</h2>
            <p className="mt-0.5 text-xs text-fg-muted">悬停折线可查看单日数值</p>
          </div>
          <Tabs items={METRIC_TABS} value={metric} onChange={setMetric} variant="segment" size="sm" />
        </div>
        <TrendChart points={data.trend} metric={metric} />
      </SurfaceCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SurfaceCard className="lg:col-span-2">
          <h2 className="text-base font-semibold text-fg">分区分布</h2>
          <p className="mt-0.5 text-xs text-fg-muted">按已发布视频数量倒序</p>
          <ul className="mt-4 flex flex-col gap-3">
            {categories.map((item) => {
              const percent = item.value / totalCategory;
              return (
                <li key={item.name} className="flex items-center gap-3">
                  <span className="w-14 shrink-0 truncate text-xs text-fg">{item.name}</span>
                  <ProgressBar value={item.value} max={totalCategory} tone="accent" className="flex-1" />
                  <span className="w-16 shrink-0 text-right text-xs tabular-nums text-fg">{formatCount(item.value)}</span>
                  <span className="w-12 shrink-0 text-right text-xs tabular-nums text-fg-subtle">
                    {formatPercent(percent, 1)}
                  </span>
                </li>
              );
            })}
          </ul>
        </SurfaceCard>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <QuickCard
            title="待审核视频"
            value={data.videos.reviewing}
            description="机审疑似与人审队列，处理越慢对创作者影响越大。"
            actionLabel="前往审核"
            icon={<ShieldCheck className="size-4" aria-hidden />}
            onAction={() => navigate('/admin/reviews')}
          />
          <QuickCard
            title="待处理举报"
            value={data.interaction.reportsPending}
            description="按优先级从高到低处理，处置结果会通知举报人。"
            actionLabel="前往处理"
            icon={<Flag className="size-4" aria-hidden />}
            onAction={() => navigate('/admin/reports')}
          />
          <QuickCard
            title="转码失败"
            value={data.transcode.failedToday}
            description="今日转码失败的任务，需确认源文件与转码参数。"
            actionLabel="查看转码中视频"
            icon={<TriangleAlert className="size-4" aria-hidden />}
            onAction={() => navigate('/admin/videos?status=PROCESSING')}
          />
        </div>
      </div>

      {data.transcode.failedToday > 0 && (
        <Badge tone="warning" size="md" className="self-start">
          今日有 {data.transcode.failedToday} 个转码任务失败，建议在视频管理中核对源文件
        </Badge>
      )}
    </div>
  );
}
