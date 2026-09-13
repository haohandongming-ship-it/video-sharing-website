import { memo } from 'react';
import { Link } from 'react-router-dom';
import { Clock3, Eye, ListVideo, Play } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatCount, formatDuration, formatRelative } from '@/lib/format';
import type { VideoSummary } from '@/api/types';
import { Avatar } from '@/components/ui/Avatar';
import { watchedPercent } from '@/stores/playerStore';

export type VideoCardLayout = 'grid' | 'row' | 'compact' | 'poster';
export type VideoCardSize = 'sm' | 'md' | 'lg';

export interface VideoCardProps {
  video: VideoSummary;
  layout?: VideoCardLayout;
  size?: VideoCardSize;
  showAuthor?: boolean;
  showStats?: boolean;
  showReason?: boolean;
  /** 排行榜序号 */
  rank?: number;
  className?: string;
  /** 关闭入场动画（列表虚拟化/长列表使用） */
  noMotion?: boolean;
  onRemove?: () => void;
}

function durationLabel(seconds: number) {
  return formatDuration(seconds);
}

function progressOf(video: VideoSummary): number {
  if (video.progress !== undefined && video.duration > 0) {
    return Math.min(100, (video.progress / video.duration) * 100);
  }
  return watchedPercent(video.id, video.duration);
}

/**
 * 视频卡片 —— 全站复用的核心展示单元。
 * 支持四种布局：网格（首页/搜索）、横向（播放页侧栏/历史）、紧凑（侧栏小卡）、竖版（短视频/榜单）。
 */
export const VideoCard = memo(function VideoCard({
  video,
  layout = 'grid',
  size = 'md',
  showAuthor = true,
  showStats = true,
  showReason = false,
  rank,
  className,
  onRemove,
}: VideoCardProps) {
  const progress = progressOf(video);
  const isShort = video.videoType === 'SHORT';
  const to = `${isShort ? '/shorts' : `/video/${video.id}`}${isShort ? `?v=${video.id}` : ''}`;

  const thumb = (
    <div
      className={cn(
        'group/thumb relative shrink-0 overflow-hidden rounded-card bg-surface-2',
        layout === 'grid' && 'aspect-video w-full',
        layout === 'row' && 'aspect-video w-40 sm:w-44',
        layout === 'compact' && 'aspect-video w-32 sm:w-40',
        layout === 'poster' && 'aspect-video w-full',
      )}
    >
      <img
        src={video.coverUrl}
        alt={video.title}
        loading="lazy"
        decoding="async"
        className="size-full object-cover transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/thumb:scale-[1.03]"
      />
      {/* 时长角标 */}
      <span className="absolute right-1.5 bottom-1.5 rounded-[4px] bg-black/78 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
        {durationLabel(video.duration)}
      </span>
      {video.status === 'PROCESSING' && (
        <span className="absolute top-1.5 left-1.5 rounded-[4px] bg-black/70 px-1.5 py-0.5 text-[11px] text-white">转码中</span>
      )}
      {video.status === 'REVIEWING' && (
        <span className="absolute top-1.5 left-1.5 rounded-[4px] bg-black/70 px-1.5 py-0.5 text-[11px] text-white">审核中</span>
      )}
      {video.visibility === 'PRIVATE' && (
        <span className="absolute top-1.5 right-1.5 rounded-[4px] bg-black/70 px-1.5 py-0.5 text-[11px] text-white">仅自己</span>
      )}
      {/* 悬停播放遮罩 */}
      <span className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition-opacity duration-200 group-hover/thumb:bg-black/25 group-hover/thumb:opacity-100">
        <span className="grid size-11 place-items-center rounded-full bg-black/60 text-white backdrop-blur-[2px]">
          <Play className="size-5 translate-x-[1px] fill-current" />
        </span>
      </span>
      {/* 观看进度记忆条 */}
      {progress > 1 && (
        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/30">
          <span className="block h-full bg-brand" style={{ width: `${progress}%` }} />
        </span>
      )}
      {isShort && (
        <span className="absolute bottom-1.5 left-1.5 rounded-[4px] bg-black/70 px-1.5 py-0.5 text-[11px] text-white">短视频</span>
      )}
    </div>
  );

  const titleNode = (
    <h3
      className={cn(
        'line-clamp-2 font-medium text-fg transition-colors group-hover/card:text-accent',
        size === 'sm' ? 'text-[13px] leading-snug' : 'text-sm leading-[1.45]',
      )}
      title={video.title}
    >
      {video.title}
    </h3>
  );

  const metaNode = (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-fg-muted">
      {showAuthor && (
        <Link
          to={`/user/${video.author.id}`}
          onClick={(event) => event.stopPropagation()}
          className="max-w-[10rem] truncate hover:text-fg"
        >
          {video.author.nickname}
        </Link>
      )}
      {showStats && (
        <>
          {showAuthor && <span aria-hidden>·</span>}
          <span className="inline-flex items-center gap-1">
            <Eye className="size-3" aria-hidden />
            {formatCount(video.stats.views)}
          </span>
          <span aria-hidden>·</span>
          <span>{formatRelative(video.publishedAt)}</span>
        </>
      )}
    </div>
  );

  const reasonNode =
    showReason && video.recommendReason ? (
      <p className="mt-1.5 line-clamp-1 text-[11px] text-fg-subtle">{video.recommendReason}</p>
    ) : null;

  if (layout === 'grid' || layout === 'poster') {
    return (
      <article className={cn('group/card flex flex-col gap-2.5', className)}>
        <Link to={to} className="block focus-visible:outline-none">
          {thumb}
        </Link>
        <div className="flex gap-2.5">
          {showAuthor && (
            <Link to={`/user/${video.author.id}`} className="mt-0.5 shrink-0">
              <Avatar src={video.author.avatar} name={video.author.nickname} size="sm" certified={video.author.certified} />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <Link to={to} className="block">
              {titleNode}
            </Link>
            {metaNode}
            {reasonNode}
          </div>
        </div>
      </article>
    );
  }

  if (layout === 'row') {
    return (
      <article className={cn('group/card flex gap-3', className)}>
        <Link to={to} className="shrink-0">
          {thumb}
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
          {/* 标题单独成链，作者链接放在其外层容器，避免 <a> 嵌套导致的非法 DOM */}
          <Link to={to} className="block">
            {titleNode}
          </Link>
          {metaNode}
          {reasonNode}
          {video.progress !== undefined && video.duration > 0 && (
            <span className="mt-auto inline-flex items-center gap-1 text-[11px] text-fg-subtle">
              <Clock3 className="size-3" aria-hidden />
              已看 {formatDuration(video.progress)} / {formatDuration(video.duration)}
            </span>
          )}
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="self-start text-[11px] text-fg-subtle opacity-0 transition-opacity hover:text-fg group-hover/card:opacity-100"
          >
            移除
          </button>
        )}
      </article>
    );
  }

  // compact
  return (
    <article className={cn('group/card flex gap-2.5', className)}>
      <Link to={to} className="shrink-0">
        {thumb}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link to={to}>{titleNode}</Link>
        {metaNode}
      </div>
      {typeof rank === 'number' && (
        <span
          className={cn(
            'self-start text-sm font-semibold tabular-nums',
            rank <= 3 ? 'text-brand' : 'text-fg-subtle',
          )}
        >
          {rank}
        </span>
      )}
    </article>
  );
});

export interface VideoCardGridProps {
  videos: VideoSummary[];
  layout?: VideoCardLayout;
  columns?: 2 | 3 | 4 | 'auto';
  className?: string;
}

export function VideoCardGrid({ videos, layout = 'grid', columns = 'auto', className }: VideoCardGridProps) {
  return (
    <div
      className={cn(
        'grid gap-x-4 gap-y-7',
        columns === 'auto' && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4',
        columns === 2 && 'grid-cols-1 sm:grid-cols-2',
        columns === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        columns === 4 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
        className,
      )}
    >
      {videos.map((video) => (
        <VideoCard key={video.id} video={video} layout={layout} />
      ))}
    </div>
  );
}

/** 短视频卡片：竖屏封面，用于短视频入口与相关推荐 */
export function ShortVideoCard({ video, className }: { video: VideoSummary; className?: string }) {
  return (
    <Link
      to={`/shorts?v=${video.id}`}
      className={cn('group/card block overflow-hidden rounded-card border border-line bg-surface', className)}
    >
      <div className="relative aspect-[9/16] w-full overflow-hidden bg-surface-2">
        <img
          src={video.coverUrl}
          alt={video.title}
          loading="lazy"
          decoding="async"
          className="size-full object-cover transition-transform duration-300 group-hover/card:scale-[1.04]"
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-2.5 pt-8">
          <p className="line-clamp-2 text-xs leading-snug font-medium text-white">{video.title}</p>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-white/75">
            <Eye className="size-3" aria-hidden />
            {formatCount(video.stats.views)}
          </p>
        </div>
        <span className="absolute top-2 left-2 grid size-7 place-items-center rounded-full bg-black/55 text-white">
          <ListVideo className="size-3.5" aria-hidden />
        </span>
      </div>
    </Link>
  );
}
