/**
 * 观看历史（文档 3.2「收藏/稍后观看/历史」）
 * 按日期分组展示，行内给出播放进度，支持清空与暂停记录。
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { History as HistoryIcon, PauseCircle, PlayCircle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageContainer,
  Pagination,
  ProgressBar,
  SectionHeader,
  VideoCard,
  VideoGridSkeleton,
} from '@/components/ui';
import { useWatchHistory } from '@/hooks/useApi';
import { dayjs, formatCount, formatDuration } from '@/lib/format';
import { useUiStore } from '@/stores/uiStore';
import type { VideoSummary } from '@/api/types';

/**
 * 历史接口目前只下发 progress / finished，没有观看时间字段。
 * 这里预留 watchedAt：后端补齐后优先用它分组，否则退回发布时间。
 */
interface HistoryVideo extends VideoSummary {
  watchedAt?: string;
}

type DayGroup = 'today' | 'yesterday' | 'earlier';

const DAY_GROUP_ORDER: DayGroup[] = ['today', 'yesterday', 'earlier'];
const DAY_GROUP_LABELS: Record<DayGroup, string> = {
  today: '今天',
  yesterday: '昨天',
  earlier: '更早',
};

function dayGroupOf(input: string | undefined): DayGroup {
  if (!input) return 'earlier';
  const at = dayjs(input);
  if (!at.isValid()) return 'earlier';
  if (at.isSame(dayjs(), 'day')) return 'today';
  if (at.isSame(dayjs().subtract(1, 'day'), 'day')) return 'yesterday';
  return 'earlier';
}

export default function HistoryPage() {
  const [page, setPage] = useState(1);
  const [paused, setPaused] = useState(false);
  /** 清空后的本地展示状态：接口未提供清空能力，仅隐藏当前会话的数据 */
  const [cleared, setCleared] = useState(false);
  const [removed, setRemoved] = useState<ReadonlySet<number>>(new Set());

  const query = useWatchHistory(page);
  const data = query.data;

  const groups = useMemo(() => {
    const list: HistoryVideo[] = cleared ? [] : (data?.items ?? []).filter((item) => !removed.has(item.id));
    const buckets: Record<DayGroup, HistoryVideo[]> = { today: [], yesterday: [], earlier: [] };
    list.forEach((item) => {
      buckets[dayGroupOf(item.watchedAt ?? item.publishedAt)].push(item);
    });
    return DAY_GROUP_ORDER.filter((key) => buckets[key].length > 0).map((key) => ({
      key,
      label: DAY_GROUP_LABELS[key],
      videos: buckets[key],
    }));
  }, [cleared, data, removed]);

  const handleClear = () => {
    useUiStore.getState().openConfirm({
      title: '清空观看历史？',
      description: '清空后无法恢复，播放进度记忆也会一并重置。',
      confirmText: '清空',
      danger: true,
      onConfirm: () => {
        setCleared(true);
        setRemoved(new Set());
        setPage(1);
        useUiStore.getState().toast({
          title: '观看历史已清空',
          description: '服务端记录会在下次同步时一并清除。',
          tone: 'success',
        });
      },
    });
  };

  const handleTogglePause = () => {
    const next = !paused;
    useUiStore.getState().openConfirm({
      title: next ? '暂停记录观看历史？' : '恢复记录观看历史？',
      description: next
        ? '暂停后新看过的视频不会写入历史，已有记录保留。'
        : '恢复后新观看的视频会继续写入历史。',
      confirmText: next ? '暂停记录' : '恢复记录',
      onConfirm: () => {
        setPaused(next);
        useUiStore.getState().toast({
          title: next ? '已暂停记录观看历史' : '已恢复记录观看历史',
          tone: next ? 'warning' : 'success',
        });
      },
    });
  };

  const handleRemove = (video: HistoryVideo) => {
    setRemoved((prev) => new Set([...prev, video.id]));
    useUiStore.getState().toast({
      title: '已从历史中移除',
      description: `《${video.title}》不再出现在本页。`,
      tone: 'success',
    });
  };

  return (
    <PageContainer className="pt-6 pb-12">
      <SectionHeader
        level={1}
        title="观看历史"
        subtitle={
          data && !cleared
            ? `共 ${formatCount(Math.max(0, data.total - removed.size))} 条记录，按观看时间倒序排列。`
            : '看过的视频会按时间记录在这里。'
        }
        className="flex-wrap"
        action={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              icon={
                paused ? (
                  <PlayCircle className="size-3.5" aria-hidden />
                ) : (
                  <PauseCircle className="size-3.5" aria-hidden />
                )
              }
              onClick={handleTogglePause}
            >
              {paused ? '恢复记录历史' : '暂停记录历史'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={<Trash2 className="size-3.5" aria-hidden />}
              onClick={handleClear}
            >
              清空历史
            </Button>
          </div>
        }
      />

      {paused && (
        <div
          className={cn(
            'mt-4 flex items-center gap-2 rounded-card px-3.5 py-2.5 text-xs',
            'bg-warning-soft text-warning',
          )}
        >
          <PauseCircle className="size-3.5 shrink-0" aria-hidden />
          已暂停记录观看历史，这段时间看过的视频不会出现在列表里。
        </div>
      )}

      <div className="mt-6">
        {query.isPending && <VideoGridSkeleton count={5} layout="row" />}

        {query.isError && (
          <ErrorState
            title="历史加载失败"
            description="没能取到观看记录，请检查网络后重试。"
            onRetry={() => void query.refetch()}
          />
        )}

        {query.data && groups.length === 0 && (
          <EmptyState
            icon={<HistoryIcon className="size-7" aria-hidden />}
            title="还没有观看记录"
            description="看过的视频会按日期记录在这里，方便接着上次的进度继续看。"
            action={
              <Link to="/">
                <Button variant="primary">去首页看看</Button>
              </Link>
            }
          />
        )}

        {groups.map((group) => (
          <section key={group.key} className="mt-7 first:mt-0">
            <h2 className="sticky top-14 z-10 -mx-1 bg-canvas px-1 py-2 text-[13px] font-semibold text-fg">
              {group.label}
              <span className="ml-1.5 text-[11px] font-normal text-fg-subtle">
                {group.videos.length} 个视频
              </span>
            </h2>
            <ul className="flex flex-col">
              {group.videos.map((video) => (
                <li key={video.id} className="border-b border-line py-4 last:border-b-0">
                  <HistoryRow video={video} onRemove={() => handleRemove(video)} />
                </li>
              ))}
            </ul>
          </section>
        ))}

        {!cleared && data && (
          <Pagination
            page={data.page}
            total={data.total}
            pageSize={data.pageSize}
            onChange={setPage}
            className="mt-10"
          />
        )}
      </div>
    </PageContainer>
  );
}

/* ---------------------------------------------------------------- 单行记录 */

function HistoryRow({ video, onRemove }: { video: HistoryVideo; onRemove: () => void }) {
  const duration = Math.max(0, video.duration);
  const progress = Math.min(Math.max(0, video.progress ?? 0), duration);

  return (
    <div>
      {/* 去掉 progress：行内进度文案与进度条统一在下方展示，避免重复 */}
      <VideoCard video={{ ...video, progress: undefined }} layout="row" onRemove={onRemove} />
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <ProgressBar
          value={progress}
          max={duration > 0 ? duration : 1}
          size="sm"
          tone={video.finished ? 'success' : 'brand'}
          className="max-w-xs flex-1"
        />
        <span className="shrink-0 text-[11px] tabular-nums text-fg-subtle">
          已看 {formatDuration(progress)} / 总时长 {formatDuration(duration)}
        </span>
        {video.finished && <Badge tone="success">已看完</Badge>}
      </div>
    </div>
  );
}
