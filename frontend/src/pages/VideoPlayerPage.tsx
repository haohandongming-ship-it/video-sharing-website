import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Bell,
  ChevronDown,
  MonitorPlay,
  Sparkles,
  Theater,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatCount, formatDate, formatRelative, formatTimecode } from '@/lib/format';
import { QUALITY_LABELS, VIDEO_STATUS_LABELS } from '@/lib/constants';
import {
  usePlaylists,
  useRelatedVideos,
  useVideoDetail,
  useVideoInteractions,
  useVideoPlay,
} from '@/hooks/useApi';
import { videoApi } from '@/api/videos';
import { useAuthStore } from '@/stores/authStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useUiStore } from '@/stores/uiStore';
import {
  Badge,
  Button,
  CommentSkeleton,
  Dropdown,
  EmptyState,
  ErrorState,
  JsonLd,
  ListSkeleton,
  Modal,
  PageContainer,
  Tag,
} from '@/components/ui';
import { VideoPlayer } from '@/components/video/VideoPlayer';
import { VideoCard } from '@/components/video/VideoCard';
import { ActionBar, ChannelCard } from '@/components/video/ActionBar';
import { ShareDialog } from '@/components/video/ShareDialog';
import { ReportDialog } from '@/components/video/ReportDialog';
import { CommentSection } from '@/components/comment/CommentSection';

export default function VideoPlayerPage() {
  const { id: idParam } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const videoId = Number(idParam);

  const { data: video, isLoading, isError, refetch } = useVideoDetail(videoId);
  const { data: playInfo } = useVideoPlay(videoId);
  const { data: related, isLoading: relatedLoading } = useRelatedVideos(videoId);

  const { like, favorite, subscribe, dislike } = useVideoInteractions(videoId);
  const toast = useUiStore((s) => s.toast);
  const autoplayNext = usePlayerStore((s) => s.autoplayNext);
  const setAutoplayNext = usePlayerStore((s) => s.setAutoplayNext);
  const theaterMode = usePlayerStore((s) => s.theaterMode);
  const setTheaterMode = usePlayerStore((s) => s.setTheaterMode);
  const recordProgress = usePlayerStore((s) => s.recordProgress);
  const getMemory = usePlayerStore((s) => s.getMemory);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const [descOpen, setDescOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [showResumeHint, setShowResumeHint] = useState(false);
  const viewCounted = useRef(false);

  /** 断点续播：读取本地记忆进度（文档 5.6 记忆播放） */
  const startTime = useMemo(() => {
    const timeParam = params.get('t');
    if (timeParam) return Number(timeParam) || 0;
    const memory = getMemory(videoId);
    if (memory && memory.progress > 15) return memory.progress;
    return 0;
  }, [getMemory, params, videoId]);

  // 切换视频时重置页面级状态：使用「渲染期同步前值」模式，避免 effect 中的级联渲染
  const [prevVideoKey, setPrevVideoKey] = useState(`${videoId}:${startTime}`);
  const videoKey = `${videoId}:${startTime}`;
  if (videoKey !== prevVideoKey) {
    setPrevVideoKey(videoKey);
    setShowResumeHint(startTime > 15);
    setDescOpen(false);
  }

  useEffect(() => {
    viewCounted.current = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [videoId]);

  /** 播放计数：观看 ≥3s 且 24h 去重（文档 11.3），由服务端最终判定 */
  const handleViewCounted = useCallback(() => {
    if (viewCounted.current) return;
    viewCounted.current = true;
    void videoApi.reportView(videoId).catch(() => undefined);
  }, [videoId]);

  /** 进度上报：store 内部按 15s 节流（文档 5.6） */
  const handleProgress = useCallback(
    (time: number, duration: number) => {
      const shouldReport = recordProgress(videoId, time, duration);
      if (shouldReport) void videoApi.reportProgress(videoId, time).catch(() => undefined);
    },
    [recordProgress, videoId],
  );

  /** 离开页面时强制上报一次进度 */
  useEffect(() => {
    const flush = () => {
      const state = usePlayerStore.getState();
      if (state.current?.id === videoId && state.currentTime > 0) {
        recordProgress(videoId, state.currentTime, state.duration, { force: true });
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [recordProgress, videoId]);

  /** 从推荐位跳转的连续播放：?list=1 时自动连播下一个 */
  const handleEnded = useCallback(() => {
    if (!autoplayNext || !related || related.length === 0) return;
    const next = related[0];
    toast({
      title: '即将播放下一个视频',
      description: next.title,
      tone: 'info',
      action: { label: '立即播放', onClick: () => navigate(`/video/${next.id}`) },
    });
    window.setTimeout(() => navigate(`/video/${next.id}`), 2600);
  }, [autoplayNext, navigate, related, toast]);

  const clearResume = () => {
    setShowResumeHint(false);
    void videoApi.reportProgress(videoId, 0).catch(() => undefined);
  };

  if (isLoading) return <PlayerSkeleton />;

  if (isError || !video) {
    return (
      <PageContainer className="py-10">
        <ErrorState
          title="视频加载失败"
          description="视频可能已被删除或设为私密，也可能是网络问题。"
          onRetry={() => void refetch()}
        />
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" size="sm" onClick={() => navigate('/')}>
            返回首页
          </Button>
        </div>
      </PageContainer>
    );
  }

  const isOwner = currentUserId !== null && currentUserId === video.author.id;
  const unavailable = video.status !== 'PUBLISHED';

  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'VideoObject',
          name: video.title,
          description: video.description,
          thumbnailUrl: video.coverUrl,
          uploadDate: video.publishedAt,
          duration: `PT${Math.floor(video.duration / 60)}M${video.duration % 60}S`,
          interactionStatistic: {
            '@type': 'InteractionCounter',
            interactionType: 'https://schema.org/WatchAction',
            userInteractionCount: video.stats.views,
          },
        }}
      />

      <PageContainer className="py-4 lg:py-6">
        {/* 移动端返回 */}
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-3 inline-flex min-h-11 min-w-11 items-center gap-1 px-2 text-[13px] text-fg-muted hover:text-fg lg:hidden"
        >
          <ArrowLeft className="size-4" />
          返回
        </button>

        <div className={cn('flex flex-col gap-6', !theaterMode && 'xl:flex-row')}>
          {/* 主列 */}
          <div className={cn('min-w-0 flex-1', theaterMode && 'xl:max-w-none')}>
            <div className="relative">
              {unavailable ? (
                <div className="grid aspect-video w-full place-items-center rounded-card bg-surface-2 px-6 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <Badge tone="warning">{VIDEO_STATUS_LABELS[video.status]}</Badge>
                    <p className="max-w-md text-sm leading-relaxed text-fg-muted">
                      {video.status === 'PROCESSING' && '视频正在转码，处理完成后即可播放。'}
                      {video.status === 'REVIEWING' && '视频正在审核中，审核通过后自动发布。'}
                      {video.status === 'REJECTED' &&
                        `该视频未通过审核${video.reviewNote ? `：${video.reviewNote}` : ''}。`}
                      {video.status === 'DELETED' && '该视频已被删除，30 天内可在创作者中心恢复。'}
                    </p>
                    {isOwner && (
                      <Link to="/creator">
                        <Button size="sm" variant="secondary">
                          前往创作者中心
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              ) : (
                <VideoPlayer
                  src={playInfo?.hlsUrl ?? video.hlsUrl}
                  poster={video.coverUrl}
                  title={video.title}
                  startTime={startTime}
                  autoPlay
                  onViewCounted={handleViewCounted}
                  onProgress={handleProgress}
                  onEnded={handleEnded}
                />
              )}

              {/* 续播提示 */}
              <AnimatePresence>
                {showResumeHint && !unavailable && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="absolute top-3 left-3 flex items-center gap-2 rounded-card bg-black/72 px-3 py-2 text-xs text-white backdrop-blur-sm"
                  >
                    <span>已为你从 {formatTimecode(startTime)} 继续播放</span>
                    <button type="button" onClick={clearResume} className="font-medium text-white/85 underline">
                      从头开始
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* 标题与元信息 */}
            <div className="mt-4">
              <h1 className="text-[17px] leading-snug font-semibold tracking-[-0.01em] text-fg sm:text-xl">
                {video.title}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                <span>{formatCount(video.stats.views)} 次播放</span>
                <span aria-hidden>·</span>
                <span>{formatRelative(video.publishedAt)}</span>
                {video.category && (
                  <>
                    <span aria-hidden>·</span>
                    <Link to={`/?category=${video.category.id}`} className="hover:text-fg">
                      {video.category.name}
                    </Link>
                  </>
                )}
                {video.recommendReason && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1 text-fg-subtle">
                      <Sparkles className="size-3" aria-hidden />
                      {video.recommendReason}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* 操作栏 */}
            <div className="mt-4">
              <ActionBar
                video={video}
                onLike={(active) => like.mutate(active)}
                onDislike={(active) => dislike.mutate(active)}
                onFavorite={(active) => favorite.mutate(active)}
                onSubscribe={(active) => subscribe.mutate(active)}
                onShare={() => setShareOpen(true)}
                onDownload={() =>
                  void videoApi
                    .download(videoId)
                    .then((res) => {
                      toast({
                        title: '下载链接已生成',
                        description: `有效期 ${Math.round(res.expiresIn / 60)} 分钟 · ${QUALITY_LABELS[res.quality] ?? '原始文件'}`,
                        tone: 'success',
                        action: { label: '开始下载', onClick: () => window.open(res.url, '_blank') },
                      });
                    })
                    .catch(() => undefined)
                }
                onReport={() => setReportOpen(true)}
              />
            </div>

            {/* 频道卡 + 简介 */}
            <div className="mt-4 rounded-card border border-line bg-surface p-4">
              <ChannelCard
                author={video.author}
                subscribed={video.subscribed}
                onSubscribe={(active) => subscribe.mutate(active)}
              />

              <div className="mt-4">
                <div
                  className={cn(
                    'text-[13px] leading-[1.8] whitespace-pre-wrap text-fg',
                    !descOpen && 'line-clamp-3',
                  )}
                >
                  {video.description}
                </div>
                <button
                  type="button"
                  onClick={() => setDescOpen((v) => !v)}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg"
                >
                  {descOpen ? '收起' : '展开更多'}
                  <ChevronDown className={cn('size-3.5 transition-transform', descOpen && 'rotate-180')} />
                </button>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {video.tags.map((tag) => (
                    <Link key={tag} to={`/search?q=${encodeURIComponent(tag)}`}>
                      <Tag label={`#${tag}`} size="sm" />
                    </Link>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-subtle">
                  <span>发布于 {formatDate(video.publishedAt)}</span>
                  <span>可用清晰度：{video.qualities.map((q) => QUALITY_LABELS[q]).join(' / ')}</span>
                  {video.downloadEnabled && <span>作者已开启下载</span>}
                </div>
              </div>
            </div>

            {/* 播放器辅助操作 */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setTheaterMode(!theaterMode)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-btn px-2.5 text-xs font-medium transition-colors',
                  theaterMode ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-fg-muted hover:text-fg',
                )}
              >
                <Theater className="size-3.5" />
                影院模式
              </button>
              <button
                type="button"
                onClick={() => setAutoplayNext(!autoplayNext)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-btn px-2.5 text-xs font-medium transition-colors',
                  autoplayNext ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-fg-muted hover:text-fg',
                )}
              >
                <MonitorPlay className="size-3.5" />
                自动连播 {autoplayNext ? '已开启' : '已关闭'}
              </button>
              <Dropdown
                align="start"
                items={[
                  { key: 'watch-later', label: '加入「稍后观看」', onSelect: () => favorite.mutate(true) },
                  { key: 'playlist', label: '加入播放列表…', onSelect: () => setPlaylistOpen(true) },
                  {
                    key: 'copy-time',
                    label: '复制当前时间点链接',
                    onSelect: () => {
                      const time = usePlayerStore.getState().currentTime;
                      void navigator.clipboard
                        ?.writeText(`${window.location.origin}/video/${videoId}?t=${Math.floor(time)}`)
                        .then(() => toast({ title: '已复制带时间点的链接', tone: 'success' }))
                        .catch(() => toast({ title: '复制失败', tone: 'warning' }));
                    },
                  },
                  { key: 'notify', label: '接收该 UP 主更新提醒', onSelect: () => subscribe.mutate(true) },
                ]}
                trigger={({ toggle }) => (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Bell className="size-3.5" />}
                    onClick={toggle}
                    className="h-8 text-xs"
                  >
                    更多
                  </Button>
                )}
              />
            </div>

            {/* 评论区 */}
            <div className="mt-8">
              <CommentSection videoId={videoId} commentCount={video.stats.comments} authorId={video.author.id} />
            </div>
          </div>

          {/* 侧边推荐（桌面端右侧 / 移动端底部，文档 4.1） */}
          <aside className={cn('w-full shrink-0', theaterMode ? 'xl:hidden' : 'xl:w-[380px]')}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-fg">相关推荐</h2>
              <Link to="/ranking" className="text-xs text-accent hover:underline">
                查看榜单
              </Link>
            </div>

            {relatedLoading ? (
              <ListSkeleton rows={6} />
            ) : !related || related.length === 0 ? (
              <EmptyState compact title="暂无相关推荐" description="换个分区看看其他内容。" />
            ) : (
              <div className="flex flex-col gap-3">
                {related.map((item) => (
                  <VideoCard key={item.id} video={item} layout="compact" showAuthor showStats />
                ))}
              </div>
            )}

            <div className="mt-6 rounded-card border border-line bg-surface-2 p-3.5">
              <h3 className="text-xs font-semibold text-fg">播放小贴士</h3>
              <ul className="mt-2 flex flex-col gap-1.5 text-[11px] leading-relaxed text-fg-muted">
                <li>空格暂停，← → 快退快进 5 秒，F 全屏，M 静音</li>
                <li>数字键 0-9 可跳转到 0% - 90%</li>
                <li>进度会自动记忆，下次打开从上次位置继续</li>
              </ul>
            </div>
          </aside>
        </div>
      </PageContainer>

      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title={video.title}
        path={`/video/${videoId}`}
        coverUrl={video.coverUrl}
      />
      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="VIDEO"
        targetId={videoId}
        targetTitle={video.title}
      />
      <PlaylistDialog open={playlistOpen} onClose={() => setPlaylistOpen(false)} videoId={videoId} />
    </>
  );
}

/* --------------------------------------------------------- 加入播放列表 */

function PlaylistDialog({ open, onClose, videoId }: { open: boolean; onClose: () => void; videoId: number }) {
  const toast = useUiStore((s) => s.toast);
  const { data: playlists } = usePlaylists();
  const [selected, setSelected] = useState<number[]>([]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="加入播放列表"
      description="可以选择加入多个列表，稍后观看已默认勾选"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              toast({
                title: selected.length > 0 ? `已加入 ${selected.length} 个播放列表` : '请至少选择 1 个列表',
                tone: selected.length > 0 ? 'success' : 'warning',
              });
              if (selected.length > 0) onClose();
            }}
          >
            确认加入
          </Button>
        </>
      }
    >
      {!playlists || playlists.length === 0 ? (
        <p className="text-sm text-fg-muted">还没有创建播放列表，可在「我的收藏」页面新建。</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {(playlists ?? []).map((item) => (
          <li key={item.id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-btn border border-line px-3 py-2.5 transition-colors hover:bg-surface-2">
              <input
                type="checkbox"
                className="size-3.5 accent-[var(--c-accent)]"
                checked={selected.includes(item.id)}
                onChange={(event) =>
                  setSelected((prev) =>
                    event.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id),
                  )
                }
              />
              <img src={item.cover} alt="" className="h-9 w-16 rounded-[6px] object-cover" loading="lazy" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-fg">{item.name}</span>
                <span className="block text-[11px] text-fg-subtle">{item.count} 个视频</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-fg-subtle">
        视频 #{videoId} · 播放列表管理入口在「我的收藏」页面
      </p>
    </Modal>
  );
}

function PlayerSkeleton() {
  return (
    <PageContainer className="py-4 lg:py-6">
      <div className="flex flex-col gap-6 xl:flex-row">
        <div className="min-w-0 flex-1">
          <div className="skeleton-sheen aspect-video w-full rounded-card" />
          <div className="mt-4 flex flex-col gap-3">
            <div className="skeleton-sheen h-5 w-3/4 rounded-[6px]" />
            <div className="skeleton-sheen h-3.5 w-40 rounded-[6px]" />
            <div className="skeleton-sheen h-10 w-full rounded-btn" />
            <div className="skeleton-sheen h-24 w-full rounded-card" />
          </div>
          <div className="mt-8">
            <CommentSkeleton count={4} />
          </div>
        </div>
        <div className="w-full shrink-0 xl:w-[380px]">
          <ListSkeleton rows={6} />
        </div>
      </div>
    </PageContainer>
  );
}

