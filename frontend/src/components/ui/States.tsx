import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

/* --------------------------------------------------------------- 骨架屏 */

export function Skeleton({ className, rounded = 'md' }: { className?: string; rounded?: 'sm' | 'md' | 'lg' | 'full' }) {
  return (
    <div
      aria-hidden
      className={cn(
        'skeleton-sheen',
        rounded === 'sm' ? 'rounded-[4px]' : rounded === 'full' ? 'rounded-full' : rounded === 'lg' ? 'rounded-card' : 'rounded-[8px]',
        className,
      )}
    />
  );
}

/** 视频卡片骨架：与真实卡片保持相同布局尺寸（文档 12.2） */
export function VideoCardSkeleton({ layout = 'grid' }: { layout?: 'grid' | 'row' | 'compact' }) {
  if (layout === 'row') {
    return (
      <div className="flex gap-3">
        <Skeleton className="aspect-video w-40 shrink-0 sm:w-44" rounded="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-2 py-0.5">
          <Skeleton className="h-4 w-[92%]" />
          <Skeleton className="h-4 w-[64%]" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="mt-auto h-3 w-1/2" />
        </div>
      </div>
    );
  }
  if (layout === 'compact') {
    return (
      <div className="flex gap-2">
        <Skeleton className="aspect-video w-32 shrink-0 sm:w-40" rounded="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      <Skeleton className="aspect-video w-full" rounded="lg" />
      <div className="flex gap-2.5">
        <Skeleton className="size-9 shrink-0" rounded="full" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-3/5" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      </div>
    </div>
  );
}

export function VideoGridSkeleton({ count = 12, layout = 'grid' }: { count?: number; layout?: 'grid' | 'row' | 'compact' }) {
  return (
    <div
      className={cn(
        layout === 'grid'
          ? 'grid grid-cols-1 gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'
          : 'flex flex-col gap-4',
      )}
    >
      {Array.from({ length: count }, (_, i) => (
        <VideoCardSkeleton key={i} layout={layout} />
      ))}
    </div>
  );
}

export function CommentSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-6">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-9 shrink-0" rounded="full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full" rounded="lg" />
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- 空状态 */

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
  compact?: boolean;
}

/** 空状态：插画 + 引导文案 + CTA（文档 12.2） */
export function EmptyState({ title, description, action, icon, className, compact }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 py-8' : 'gap-3 py-16',
        className,
      )}
    >
      <div
        className={cn(
          'grid place-items-center rounded-full bg-surface-2 text-fg-subtle',
          compact ? 'size-12' : 'size-16',
        )}
      >
        {icon ?? <Inbox className={compact ? 'size-5' : 'size-7'} aria-hidden />}
      </div>
      <h3 className={cn('font-semibold text-fg', compact ? 'text-sm' : 'text-base')}>{title}</h3>
      {description && (
        <p className={cn('max-w-sm leading-relaxed text-fg-muted', compact ? 'text-xs' : 'text-sm')}>{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/* --------------------------------------------------------------- 错误态 */

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  offline?: boolean;
  className?: string;
}

/** 错误态：简洁插画 + 说明 + 重试，不用红色大面积填充（文档 12.2） */
export function ErrorState({
  title = '内容加载失败',
  description = '请检查网络后重试，或稍后再来看看。',
  onRetry,
  offline,
  className,
}: ErrorStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-16 text-center', className)}>
      <div className="grid size-14 place-items-center rounded-full bg-surface-2 text-fg-subtle">
        {offline ? <WifiOff className="size-6" aria-hidden /> : <AlertTriangle className="size-6" aria-hidden />}
      </div>
      <h3 className="text-base font-semibold text-fg">{offline ? '网络连接不可用' : title}</h3>
      <p className="max-w-sm text-sm text-fg-muted">{description}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
          重新加载
        </Button>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- 加载中 */

export function Spinner({ className, label = '加载中' }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className={cn('inline-flex items-center gap-2 text-fg-muted', className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function LoadingBlock({ label = '正在加载', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-12 text-sm text-fg-muted', className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

/** 无限滚动哨兵：进入视口即触发下一页 */
export function LoadMoreSentinel({
  loading,
  hasMore,
  onIntersect,
  endLabel = '没有更多了',
}: {
  loading: boolean;
  hasMore: boolean;
  onIntersect: () => void;
  endLabel?: string;
}) {
  const ref = (node: HTMLDivElement | null) => {
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onIntersect();
          observer.disconnect();
        }
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(node);
  };

  return (
    <div ref={ref} className="flex items-center justify-center py-8 text-xs text-fg-subtle">
      {loading ? (
        <span className="inline-flex items-center gap-2 text-fg-muted">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          正在加载更多
        </span>
      ) : hasMore ? (
        <span className="sr-only">加载更多</span>
      ) : (
        endLabel
      )}
    </div>
  );
}

/** 顶部细条网络提示（文档 12.2：不打断用户操作） */
export function OfflineBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-100 flex items-center justify-center gap-2 bg-warning-soft py-1.5 text-xs text-warning">
      <WifiOff className="size-3.5" aria-hidden />
      网络连接已断开，正在自动重试…
    </div>
  );
}
