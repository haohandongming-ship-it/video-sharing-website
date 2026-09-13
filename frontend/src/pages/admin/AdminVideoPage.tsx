/**
 * 视频管理：全站视频检索、状态查看与下架处置。
 * 权限点 moderation:review；下架走 useDeleteVideo（软删除，30 天回收站）。
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Video } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  ListSkeleton,
  Pagination,
  SearchInput,
  SurfaceCard,
} from '@/components/ui';
import { useAdminVideos, useDeleteVideo } from '@/hooks/useApi';
import { cn } from '@/lib/cn';
import { VIDEO_STATUS_LABELS } from '@/lib/constants';
import { formatCount, formatDate, formatDuration } from '@/lib/format';
import type { VideoStatus, VideoSummary } from '@/api/types';
import { useUiStore } from '@/stores/uiStore';

type StatusFilter = 'ALL' | VideoStatus;

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'ALL', label: '全部状态' },
  { key: 'REVIEWING', label: VIDEO_STATUS_LABELS.REVIEWING },
  { key: 'PUBLISHED', label: VIDEO_STATUS_LABELS.PUBLISHED },
  { key: 'PROCESSING', label: VIDEO_STATUS_LABELS.PROCESSING },
  { key: 'REJECTED', label: VIDEO_STATUS_LABELS.REJECTED },
  { key: 'DELETED', label: VIDEO_STATUS_LABELS.DELETED },
];

const STATUS_TONES: Record<VideoStatus, 'neutral' | 'accent' | 'success' | 'warning' | 'brand'> = {
  PROCESSING: 'accent',
  REVIEWING: 'warning',
  PUBLISHED: 'success',
  REJECTED: 'brand',
  DELETED: 'neutral',
};

const TH_CLASS = 'sticky top-14 z-10 h-9 bg-surface px-3 text-xs font-medium text-fg-muted';
const PAGE_SIZE = 10;

function normalizeStatus(value: string | null): StatusFilter {
  if (!value) return 'ALL';
  return value in VIDEO_STATUS_LABELS ? (value as VideoStatus) : 'ALL';
}

export default function AdminVideoPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const openConfirm = useUiStore((s) => s.openConfirm);
  const [status, setStatus] = useState<StatusFilter>(() => normalizeStatus(params.get('status')));
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);

  const query = useAdminVideos({ page, pageSize: PAGE_SIZE, status });
  const removeVideo = useDeleteVideo();

  const items = query.data?.items;
  const visible = useMemo(() => {
    const list = items ?? [];
    const term = keyword.trim().toLowerCase();
    return term ? list.filter((video) => video.title.toLowerCase().includes(term)) : list;
  }, [items, keyword]);

  const requestRemove = (video: VideoSummary) => {
    openConfirm({
      title: '下架该视频',
      description: `《${video.title}》下架后立即对用户不可见，并移入回收站；30 天内可由作者或管理员恢复。处置会通知作者并记入操作日志。`,
      confirmText: '确认下架',
      danger: true,
      onConfirm: async () => {
        await removeVideo.mutateAsync(video.id);
      },
    });
  };

  const requestReReview = (video: VideoSummary) => {
    openConfirm({
      title: '重新审核该视频',
      description:
        '将跳转到内容审核队列并按标题自动筛选。若队列中没有该视频，说明它当前没有待处理的审核任务，可先在回收站或创作者侧确认状态。',
      confirmText: '前往审核队列',
      onConfirm: () => {
        navigate(`/admin/reviews?q=${encodeURIComponent(video.title)}`);
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <SurfaceCard className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={keyword}
            placeholder="按视频标题筛选"
            aria-label="按视频标题筛选"
            className="h-9 w-full sm:w-72"
            onChange={(event) => setKeyword(event.target.value)}
            onClear={() => setKeyword('')}
          />
          <p className="text-[11px] text-fg-subtle">关键词在当前页结果内过滤；切换筛选后从第一页重新加载。</p>
        </div>
        <div className="hide-scrollbar flex items-center gap-1.5 overflow-x-auto border-t border-line pt-3">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setStatus(item.key);
                setPage(1);
              }}
              className={cn(
                'h-7 shrink-0 rounded-pill border px-3 text-xs font-medium transition-colors',
                status === item.key ? 'border-transparent bg-fg text-canvas' : 'border-line text-fg-muted hover:text-fg',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </SurfaceCard>

      {query.isPending ? (
        <ListSkeleton rows={7} />
      ) : query.isError ? (
        <ErrorState title="视频列表加载失败" description="暂时无法获取视频数据，请稍后重试。" onRetry={() => void query.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Video className="size-7" />}
          title="没有符合条件的视频"
          description="调整状态筛选或清空关键词后重试。"
        />
      ) : (
        <>
          <div className="hidden lg:block">
            <SurfaceCard padded={false}>
              <table className="w-full table-fixed border-collapse text-left">
                <thead>
                  <tr>
                    <th className={cn(TH_CLASS, 'w-[260px]')}>视频</th>
                    <th className={cn(TH_CLASS, 'w-[120px]')}>作者</th>
                    <th className={cn(TH_CLASS, 'hidden w-[80px] xl:table-cell')}>分区</th>
                    <th className={cn(TH_CLASS, 'w-[64px]')}>时长</th>
                    <th className={cn(TH_CLASS, 'w-[72px]')}>播放量</th>
                    <th className={cn(TH_CLASS, 'w-[80px]')}>状态</th>
                    <th className={cn(TH_CLASS, 'hidden w-[96px] xl:table-cell')}>发布时间</th>
                    <th className={cn(TH_CLASS, 'w-[120px]')}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((video) => (
                    <tr key={video.id} className="h-12 border-b border-line text-[13px] transition-colors last:border-0 hover:bg-surface-2">
                      <td className="px-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="h-9 w-16 shrink-0 overflow-hidden rounded-[4px] bg-surface-2">
                            <img src={video.coverUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                          </span>
                          <a
                            href={`/video/${video.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="min-w-0 flex-1 truncate font-medium text-fg hover:text-accent"
                          >
                            {video.title}
                          </a>
                        </div>
                      </td>
                      <td className="truncate px-3 text-xs text-fg-muted">{video.author.nickname}</td>
                      <td className="hidden truncate px-3 text-xs text-fg-muted xl:table-cell">
                        {video.category?.name ?? '未分区'}
                      </td>
                      <td className="px-3 text-xs tabular-nums text-fg-muted">{formatDuration(video.duration)}</td>
                      <td className="px-3 text-xs tabular-nums text-fg-muted">{formatCount(video.stats.views)}</td>
                      <td className="px-3">
                        <Badge tone={STATUS_TONES[video.status]}>{VIDEO_STATUS_LABELS[video.status] ?? video.status}</Badge>
                      </td>
                      <td className="hidden px-3 text-xs text-fg-muted xl:table-cell">
                        {video.publishedAt ? formatDate(video.publishedAt) : '未发布'}
                      </td>
                      <td className="px-3">
                        <div className="flex items-center gap-1.5">
                          <a
                            href={`/video/${video.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-7 items-center rounded-[6px] border border-line px-2 text-xs text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                          >
                            查看
                          </a>
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={video.status === 'DELETED'}
                            title={video.status === 'DELETED' ? '该视频已在回收站' : '重新提交人工审核队列'}
                            onClick={() => requestReReview(video)}
                          >
                            重新审核
                          </Button>
                          <Button
                            size="xs"
                            variant="danger"
                            disabled={video.status === 'DELETED' || removeVideo.isPending}
                            title={video.status === 'DELETED' ? '该视频已下架' : '下架并移入回收站'}
                            onClick={() => requestRemove(video)}
                          >
                            下架
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SurfaceCard>
          </div>

          <div className="flex flex-col gap-3 lg:hidden">
            {visible.map((video) => (
              <SurfaceCard key={video.id} className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <span className="h-12 w-20 shrink-0 overflow-hidden rounded-[4px] bg-surface-2">
                    <img src={video.coverUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <a
                      href={`/video/${video.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="line-clamp-2 text-[13px] font-medium text-fg hover:text-accent"
                    >
                      {video.title}
                    </a>
                    <p className="mt-1 text-[11px] text-fg-subtle">
                      {video.author.nickname} · {video.category?.name ?? '未分区'} · {formatDuration(video.duration)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
                  <Badge tone={STATUS_TONES[video.status]}>{VIDEO_STATUS_LABELS[video.status] ?? video.status}</Badge>
                  <span className="tabular-nums">播放 {formatCount(video.stats.views)}</span>
                  <span>{video.publishedAt ? formatDate(video.publishedAt) : '未发布'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`/video/${video.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 flex-1 items-center justify-center rounded-[6px] border border-line text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg"
                  >
                    查看
                  </a>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    disabled={video.status === 'DELETED'}
                    onClick={() => requestReReview(video)}
                  >
                    重新审核
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    className="flex-1"
                    disabled={video.status === 'DELETED' || removeVideo.isPending}
                    onClick={() => requestRemove(video)}
                  >
                    下架
                  </Button>
                </div>
              </SurfaceCard>
            ))}
          </div>

          <Pagination page={page} total={query.data?.total ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}
    </div>
  );
}
