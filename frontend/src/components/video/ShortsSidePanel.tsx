import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatCount, formatRelative } from '@/lib/format';
import { Avatar, Badge, Spinner, Tabs, Tag } from '@/components/ui';
import { CommentSection } from '@/components/comment/CommentSection';
import { SubscribeButton } from '@/components/user/SubscribeButton';
import { useRecommendVideos, useToggleFollow, useUserVideos, useVideoDetail } from '@/hooks/useApi';
import type { VideoSummary } from '@/api/types';

export type ShortsPanelTab = 'detail' | 'works' | 'comments' | 'related';

const TABS: { key: ShortsPanelTab; label: string }[] = [
  { key: 'detail', label: '详情' },
  { key: 'works', label: 'TA的作品' },
  { key: 'comments', label: '评论' },
  { key: 'related', label: '相关推荐' },
];

export interface ShortsSidePanelProps {
  video: VideoSummary | undefined;
  tab: ShortsPanelTab;
  onTabChange: (tab: ShortsPanelTab) => void;
  onClose: () => void;
  className?: string;
}

/**
 * 短视频右侧信息面板（对齐抖音式排版）。
 *
 * <p>原实现打开评论时只有一个评论列表，且小屏是底部抽屉、大屏才并排。
 * 现在统一为一个右侧面板，内部用标签切换：详情 / TA的作品 / 评论 / 相关推荐。
 * 「AI 抖音」按需求不实现，因此没有对应标签。
 */
export function ShortsSidePanel({ video, tab, onTabChange, onClose, className }: ShortsSidePanelProps) {
  const videoId = video?.id ?? 0;
  const detail = useVideoDetail(videoId);
  const works = useUserVideos(video?.author.id ?? 0, 1);
  const related = useRecommendVideos({ page: 1, pageSize: 12 });
  const follow = useToggleFollow();

  const profile = detail.data;

  return (
    <aside
      aria-label="短视频信息"
      className={cn(
        'absolute inset-x-0 bottom-0 z-50 flex max-h-[80%] flex-col rounded-t-2xl border-line bg-surface',
        'lg:inset-x-auto lg:top-0 lg:right-0 lg:bottom-0 lg:z-30 lg:max-h-none lg:w-[380px] lg:rounded-none lg:border-l',
        className,
      )}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
        <Tabs
          items={TABS}
          value={tab}
          variant="underline"
          size="sm"
          scrollable
          onChange={(key) => onTabChange(key as ShortsPanelTab)}
        />
        <button
          type="button"
          aria-label="关闭面板"
          onClick={onClose}
          className="ml-auto grid size-7 shrink-0 place-items-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {tab === 'detail' && (
          <div className="flex flex-col gap-4">
            {detail.isLoading ? (
              <Spinner label="加载详情" />
            ) : profile ? (
              <>
                <div className="flex items-center gap-3">
                  <Link to={`/user/${profile.author.id}`}>
                    <Avatar src={profile.author.avatar} name={profile.author.nickname} size="md" certified={profile.author.certified} />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link to={`/user/${profile.author.id}`} className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-fg">{profile.author.nickname}</span>
                      {profile.author.certified && <Badge tone="brand">认证</Badge>}
                    </Link>
                    <p className="text-xs text-fg-muted">
                      {formatCount(profile.author.followerCount ?? 0)} 粉丝
                    </p>
                  </div>
                  <SubscribeButton
                    size="sm"
                    active={Boolean(profile.subscribed)}
                    loading={follow.isPending}
                    onToggle={(next) => follow.mutate({ userId: profile.author.id, active: next })}
                  />
                </div>

                <div>
                  <h2 className="text-sm font-medium text-fg">{profile.title}</h2>
                  {profile.description && (
                    <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-fg-muted">
                      {profile.description}
                    </p>
                  )}
                </div>

                {profile.tags && profile.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {profile.tags.map((tag) => (
                      <Tag key={tag} label={`#${tag}`} size="sm" />
                    ))}
                  </div>
                )}

                <dl className="grid grid-cols-4 gap-3 border-t border-line pt-3 text-center">
                  {[
                    { label: '播放', value: profile.stats.views },
                    { label: '点赞', value: profile.stats.likes },
                    { label: '评论', value: profile.stats.comments },
                    { label: '收藏', value: profile.stats.favorites },
                  ].map((item) => (
                    <div key={item.label}>
                      <dd className="text-sm font-semibold tabular-nums text-fg">{formatCount(item.value)}</dd>
                      <dt className="mt-0.5 text-[11px] text-fg-subtle">{item.label}</dt>
                    </div>
                  ))}
                </dl>

                <p className="text-[11px] text-fg-subtle">
                  发布于 {formatRelative(profile.publishedAt)} · {profile.category?.name ?? '未分区'}
                </p>
              </>
            ) : (
              <p className="text-sm text-fg-muted">详情暂不可用。</p>
            )}
          </div>
        )}

        {tab === 'works' && (
          <WorksList
            loading={works.isLoading}
            items={(works.data?.items ?? []).filter((item) => item.id !== videoId)}
          />
        )}

        {tab === 'comments' && videoId > 0 && video && (
          <CommentSection videoId={videoId} commentCount={video.stats.comments} authorId={video.author.id} />
        )}

        {tab === 'related' && (
          <WorksList loading={related.isLoading} items={(related.data?.items ?? []).filter((item) => item.id !== videoId)} />
        )}
      </div>
    </aside>
  );
}

/** 作品 / 推荐共用的竖向列表 */
function WorksList({ loading, items }: { loading: boolean; items: VideoSummary[] }) {
  if (loading) return <Spinner label="加载中" />;
  if (items.length === 0) return <p className="text-sm text-fg-muted">暂无内容。</p>;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.id}>
          <Link to={`/video/${item.id}`} className="group flex gap-3">
            <span className="h-16 w-12 shrink-0 overflow-hidden rounded-[6px] bg-surface-2">
              <img src={item.coverUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-[13px] font-medium text-fg group-hover:text-accent">{item.title}</span>
              <span className="mt-1 block text-[11px] text-fg-subtle">
                {formatCount(item.stats.views)} 次播放 · {formatRelative(item.publishedAt)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
