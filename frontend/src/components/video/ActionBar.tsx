import { Link } from 'react-router-dom';
import { Bookmark, Coins, Download, Flag, Heart, Share2, ThumbsDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatCount } from '@/lib/format';
import type { VideoDetail } from '@/api/types';
import { SubscribeButton } from '@/components/user/SubscribeButton';
import { Avatar } from '@/components/ui/Avatar';
import { useAuthStore } from '@/stores/authStore';

export interface ActionBarProps {
  video: VideoDetail;
  onLike: (active: boolean) => void;
  onDislike: (active: boolean) => void;
  onFavorite: (active: boolean) => void;
  onSubscribe: (active: boolean) => void;
  onShare: () => void;
  onDownload: () => void;
  onReport: () => void;
  onCoin?: () => void;
  className?: string;
}

/** 视频操作栏：点赞 / 点踩 / 收藏 / 分享 / 下载 / 举报（文档 5.3 ActionBar） */
export function ActionBar({
  video,
  onLike,
  onDislike,
  onFavorite,
  onSubscribe,
  onShare,
  onDownload,
  onReport,
  onCoin,
  className,
}: ActionBarProps) {
  const own = useAuthStore((state) => state.user?.id === video.author.id);
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="flex items-center rounded-pill bg-surface-2">
        <button
          type="button"
          aria-pressed={video.liked}
          aria-label="点赞"
          onClick={() => onLike(!video.liked)}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-l-pill pr-3 pl-3.5 text-[13px] font-medium transition-colors',
            video.liked ? 'text-brand' : 'text-fg-muted hover:text-fg',
          )}
        >
          <Heart
            className={cn(
              'size-4 transition-transform',
              video.liked && 'animate-[bounce-like_0.3s_cubic-bezier(0.34,1.56,0.64,1)] fill-current',
            )}
          />
          <span className="tabular-nums">{formatCount(video.stats.likes)}</span>
        </button>
        <span className="h-5 w-px bg-line" aria-hidden />
        <button
          type="button"
          aria-pressed={video.disliked}
          aria-label="点踩"
          title="点踩"
          onClick={() => onDislike(!video.disliked)}
          className={cn(
            'inline-flex h-9 items-center rounded-r-pill pr-3.5 pl-3 text-[13px] transition-colors',
            video.disliked ? 'text-accent' : 'text-fg-muted hover:text-fg',
          )}
        >
          <ThumbsDown className={cn('size-4', video.disliked && 'fill-current')} />
        </button>
      </div>

      <button
        type="button"
        aria-pressed={video.favorited}
        aria-label="收藏"
        onClick={() => onFavorite(!video.favorited)}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-pill bg-surface-2 px-3.5 text-[13px] font-medium transition-colors',
          video.favorited ? 'text-brand' : 'text-fg-muted hover:text-fg',
        )}
      >
        <Bookmark className={cn('size-4', video.favorited && 'fill-current')} />
        <span className="tabular-nums">{formatCount(video.stats.favorites)}</span>
      </button>

      <button
        type="button"
        onClick={onShare}
        className="inline-flex h-9 items-center gap-1.5 rounded-pill bg-surface-2 px-3.5 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg"
      >
        <Share2 className="size-4" />
        分享
        {video.stats.shares !== undefined && <span className="tabular-nums">{formatCount(video.stats.shares)}</span>}
      </button>

      {onCoin && (
        <button
          type="button"
          onClick={onCoin}
          className="inline-flex h-9 items-center gap-1.5 rounded-pill bg-surface-2 px-3.5 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg"
        >
          <Coins className="size-4" />
          投币
        </button>
      )}

      <button
        type="button"
        onClick={onDownload}
        disabled={!video.downloadEnabled}
        title={video.downloadEnabled ? '下载视频' : '作者未开启下载'}
        className="inline-flex h-9 items-center gap-1.5 rounded-pill bg-surface-2 px-3.5 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-fg-muted"
      >
        <Download className="size-4" />
        下载
      </button>

      <button
        type="button"
        onClick={onReport}
        className="inline-flex h-9 items-center gap-1.5 rounded-pill bg-surface-2 px-3.5 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg"
      >
        <Flag className="size-4" />
        举报
      </button>

      <div className="ml-auto">
        {!own && <SubscribeButton active={video.subscribed} onToggle={onSubscribe} size="md" />}
      </div>
    </div>
  );
}

export interface ChannelCardProps {
  author: VideoDetail['author'];
  subscribed: boolean;
  onSubscribe: (active: boolean) => void;
  className?: string;
}

/** 频道信息卡：头像 / 昵称 / 粉丝数 / 关注按钮（文档 5.3 ChannelCard） */
export function ChannelCard({ author, subscribed, onSubscribe, className }: ChannelCardProps) {
  const own = useAuthStore((state) => state.user?.id === author.id);
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <Link to={`/user/${author.id}`} className="shrink-0">
        <Avatar src={author.avatar} name={author.nickname} size="lg" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/user/${author.id}`} className="flex items-center gap-1">
          <span className="truncate text-sm font-semibold text-fg hover:text-accent">{author.nickname}</span>
        </Link>
        <p className="text-xs text-fg-muted">{formatCount(author.followerCount ?? 0)} 位粉丝</p>
      </div>
      {!own && <SubscribeButton active={subscribed} onToggle={onSubscribe} size="sm" />}
    </div>
  );
}
