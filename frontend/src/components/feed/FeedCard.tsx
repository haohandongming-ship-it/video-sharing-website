import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Heart, ImageOff, MessageCircle, MoreHorizontal, Repeat2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { copyText } from '@/lib/clipboard';
import { formatCount, formatRelative } from '@/lib/format';
import type { FeedPost } from '@/api/types';
import { Avatar, Dropdown, Tag } from '@/components/ui';
import { useUiStore } from '@/stores/uiStore';
import { useToggleFeedLike } from '@/hooks/useApi';

export interface FeedCardProps {
  post: FeedPost;
  /** 详情页展示完整内容并隐藏跳转 */
  detail?: boolean;
  onDelete?: (id: number) => void;
  onRepost?: (post: FeedPost) => void;
  className?: string;
}

/** 微博式动态卡片（文档 4.3 / 5.3） */
export function FeedCard({ post, detail, onDelete, onRepost, className }: FeedCardProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  /** 加载失败的媒体 id：降级为占位块，避免九宫格里出现浏览器破图图标。 */
  const [failedMedia, setFailedMedia] = useState<Set<number>>(() => new Set());
  const likeMutation = useToggleFeedLike();
  const openConfirm = useUiStore((s) => s.openConfirm);
  const toast = useUiStore((s) => s.toast);

  const media = post.media ?? [];
  const images = media.filter((m) => m.mediaType === 'IMAGE');
  const video = media.find((m) => m.mediaType === 'VIDEO');
  const longContent = post.content.length > 180;

  const goDetail = () => {
    if (!detail) navigate(`/feed/${post.id}`);
  };

  return (
    <article
      className={cn(
        'group/card rounded-card border border-line bg-surface p-4 transition-shadow duration-200',
        !detail && 'cursor-pointer hover:shadow-raised',
        className,
      )}
      onClick={goDetail}
    >
      <header className="flex items-start gap-3">
        <Link to={`/user/${post.user.id}`} onClick={(e) => e.stopPropagation()} className="shrink-0">
          <Avatar src={post.user.avatar} name={post.user.nickname} size="md" certified={post.user.certified} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link
              to={`/user/${post.user.id}`}
              onClick={(e) => e.stopPropagation()}
              className="truncate text-sm font-semibold text-fg hover:text-accent"
            >
              {post.user.nickname}
            </Link>
            {post.type === 'REPOST' && <span className="text-[11px] text-fg-subtle">转发</span>}
          </div>
          <p className="text-[11px] text-fg-subtle">{formatRelative(post.createdAt)}</p>
        </div>

        <Dropdown
          align="end"
          items={[
            ...(post.isOwner && onDelete
              ? [
                  {
                    key: 'delete',
                    label: '删除动态',
                    icon: <Trash2 className="size-3.5" />,
                    danger: true,
                    onSelect: () =>
                      openConfirm({
                        title: '删除这条动态？',
                        description: '删除后无法恢复，评论与转发记录也会一并移除。',
                        confirmText: '删除',
                        danger: true,
                        onConfirm: () => onDelete(post.id),
                      }),
                  },
                ]
              : []),
            {
              key: 'copy',
              label: '复制链接',
              onSelect: () => {
                // 局域网 http 下没有 navigator.clipboard：copyText 会降级，并按真实结果提示
                void copyText(`${window.location.origin}/feed/${post.id}`).then((copied) =>
                  toast(
                    copied
                      ? { title: '链接已复制', tone: 'success' }
                      : { title: '复制失败，请手动复制地址栏链接', tone: 'warning' },
                  ),
                );
              },
            },
            { key: 'report', label: '举报', onSelect: () => toast({ title: '已进入举报流程', tone: 'info' }) },
          ]}
          trigger={({ toggle }) => (
            <button
              type="button"
              aria-label="更多操作"
              onClick={(e) => {
                e.stopPropagation();
                toggle();
              }}
              className="grid size-7 shrink-0 place-items-center rounded-full text-fg-subtle opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg group-hover/card:opacity-100"
            >
              <MoreHorizontal className="size-4" />
            </button>
          )}
        />
      </header>

      <div className="mt-3 pl-0 sm:pl-[52px]">
        {post.content && (
          <div>
            <p
              className={cn(
                'text-sm leading-[1.75] whitespace-pre-wrap break-words text-fg',
                !expanded && longContent && 'line-clamp-4',
              )}
            >
              {post.content}
            </p>
            {longContent && !detail && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((v) => !v);
                }}
                className="mt-1 text-xs font-medium text-accent hover:underline"
              >
                {expanded ? '收起' : '展开全文'}
              </button>
            )}
          </div>
        )}

        {post.topic && (
          <div className="mt-2">
            <Tag label={`#${post.topic.name}#`} onClick={() => navigate(`/feed?topic=${post.topic?.id}`)} size="sm" />
          </div>
        )}

        {/* 媒体九宫格 */}
        {images.length > 0 && (
          <div
            className={cn(
              'mt-3 grid gap-1 overflow-hidden rounded-[10px]',
              images.length === 1 ? 'grid-cols-1' : images.length === 2 || images.length === 4 ? 'grid-cols-2' : 'grid-cols-3',
            )}
          >
            {images.slice(0, 9).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="relative overflow-hidden bg-surface-2"
                style={{ aspectRatio: images.length === 1 ? '16/10' : '1/1' }}
              >
                {failedMedia.has(item.id) ? (
                  <div className="flex size-full items-center justify-center text-fg-subtle">
                    <ImageOff className="size-5" aria-hidden />
                  </div>
                ) : (
                  <img
                    src={item.thumbUrl ?? item.url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={() => setFailedMedia((prev) => new Set(prev).add(item.id))}
                    className="size-full object-cover transition-transform duration-300 hover:scale-[1.03]"
                  />
                )}
              </button>
            ))}
          </div>
        )}

        {video && (
          <Link
            to={video.videoId ? `/video/${video.videoId}` : '#'}
            onClick={(e) => e.stopPropagation()}
            className="mt-3 block overflow-hidden rounded-[10px] border border-line"
          >
            <div className="relative aspect-video bg-surface-2">
              <img
                src={video.thumbUrl ?? video.url}
                alt=""
                loading="lazy"
                className="size-full object-cover"
              />
              <span className="absolute inset-0 grid place-items-center">
                <span className="grid size-12 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                  ▶
                </span>
              </span>
            </div>
          </Link>
        )}

        {/* 转发原动态 */}
        {post.repostOf && (
          <div className="mt-3 rounded-[10px] border border-line bg-surface-2 p-3">
            <Link
              to={`/user/${post.repostOf.user.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-[13px] font-medium text-accent hover:underline"
            >
              @{post.repostOf.user.nickname}
            </Link>
            <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-fg-muted">{post.repostOf.content}</p>
          </div>
        )}

        {/* 互动栏 */}
        <footer className="mt-3 flex items-center gap-1">
          <FeedAction
            icon={<Heart className={cn('size-4', post.liked && 'fill-current')} />}
            label="点赞"
            count={post.stats.likes}
            active={post.liked}
            activeClass="text-brand"
            onClick={(e) => {
              e.stopPropagation();
              likeMutation.mutate({ id: post.id, active: !post.liked });
            }}
          />
          <FeedAction
            icon={<MessageCircle className="size-4" />}
            label="评论"
            count={post.stats.comments}
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/feed/${post.id}#comments`);
            }}
          />
          <FeedAction
            icon={<Repeat2 className="size-4" />}
            label="转发"
            count={post.stats.reposts}
            onClick={(e) => {
              e.stopPropagation();
              onRepost?.(post);
            }}
          />
        </footer>
      </div>
    </article>
  );
}

function FeedAction({
  icon,
  label,
  count,
  active,
  activeClass,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active?: boolean;
  activeClass?: string;
  onClick: (event: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-pill px-2.5 text-xs transition-colors hover:bg-surface-2',
        active ? (activeClass ?? 'text-accent') : 'text-fg-muted hover:text-fg',
      )}
    >
      {icon}
      <span className="tabular-nums">{count > 0 ? formatCount(count) : label}</span>
    </button>
  );
}
