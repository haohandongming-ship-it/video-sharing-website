import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Bookmark,
  Heart,
  MessageCircle,
  Music2,
  Play,
  Share2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatCount } from '@/lib/format';
import { useDanmaku, useSendDanmaku, useShortsFeed, useSubtitles } from '@/hooks/useApi';
import { videoApi } from '@/api/videos';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { usePlayerStore } from '@/stores/playerStore';
import { Avatar, Badge, Button, EmptyState, ErrorState, Spinner } from '@/components/ui';
import { DanmakuButton } from '@/components/video/DanmakuButton';
import { DanmakuLayer } from '@/components/video/DanmakuLayer';
import { ShortsSidePanel, type ShortsPanelTab } from '@/components/video/ShortsSidePanel';
import { ShortVideoPlayer } from '@/components/video/VideoPlayer';
import { ShareDialog } from '@/components/video/ShareDialog';
import { ReportDialog } from '@/components/video/ReportDialog';
import type { Quality, VideoSummary } from '@/api/types';

/** 触摸/鼠标滑动的判定阈值与速度阈值（文档 5.6：指针拖拽 + 速度检测） */
const SWIPE_DISTANCE = 60;
const SWIPE_VELOCITY = 0.45;
/** 长按 2 倍速 */
const LONG_PRESS_MS = 320;

export default function ShortsPage() {
  const [params, setParams] = useSearchParams();
  const initialId = params.get('v') ? Number(params.get('v')) : null;
  const [requestedId] = useState(initialId);
  const requested = useQuery({
    queryKey: ['videos', 'short-deep-link', requestedId],
    queryFn: () => videoApi.detail(requestedId!),
    enabled: requestedId !== null && Number.isSafeInteger(requestedId) && requestedId > 0,
    retry: false,
  });

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage } = useShortsFeed();
  const videos = useMemo(() => {
    const feed = data?.pages.flatMap((page) => page.items) ?? [];
    if (!requested.data) return feed;
    // 深链视频已在推荐流里时保持原有顺序：一旦把它挪到队首，渲染期算出的 index 就会指向别的视频。
    if (feed.some((video) => video.id === requested.data?.id)) return feed;
    return [requested.data, ...feed];
  }, [data, requested.data]);

  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number }[]>([]);
  const [fastForward, setFastForward] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [localLikes, setLocalLikes] = useState<Record<number, boolean>>({});
  const [localFavorites, setLocalFavorites] = useState<Record<number, boolean>>({});

  /* ---- 右侧面板与播放设置（对齐抖音式排版：右侧信息面板 + 底部控制栏） ---- */
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<ShortsPanelTab>('comments');
  const [danmakuOn, setDanmakuOn] = useState(true);
  const [subtitlesOn, setSubtitlesOn] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [levels, setLevels] = useState<{ index: number; name: string; height: number }[]>([]);
  const setPlayerLevelRef = useRef<((index: number) => void) | null>(null);

  /** 清晰度与倍速与长视频共用偏好，保持两处一致 */
  const storeQuality = usePlayerStore((s) => s.quality);
  const setStoreQuality = usePlayerStore((s) => s.setQuality);
  const storeRate = usePlayerStore((s) => s.playbackRate);
  const setStoreRate = usePlayerStore((s) => s.setPlaybackRate);
  const setLocalLike = (videoId: number, active: boolean) =>
    setLocalLikes((prev) => ({ ...prev, [videoId]: active }));

  const containerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ y: number; t: number } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const lastTap = useRef(0);
  const viewedRef = useRef<Set<number>>(new Set());

  const isLogin = useAuthStore((s) => s.status === 'authenticated');
  const toast = useUiStore((s) => s.toast);
  const client = useQueryClient();

  /* 失效的分享链接（已删除/私密）不能拖垮整页：退回推荐流并说明原因 */
  useEffect(() => {
    if (requestedId !== null && requested.isError) {
      toast({ title: '该短视频暂不可用', description: '已为你展示推荐内容', tone: 'info' });
    }
  }, [requested.isError, requestedId, toast]);

  const current: VideoSummary | undefined = videos[index];

  /* 弹幕与字幕：仅在当前视频变化时重新拉取 */
  const danmakuQuery = useDanmaku(current?.id ?? 0);
  const sendDanmaku = useSendDanmaku(current?.id ?? 0);
  const subtitles = useSubtitles(current?.id ?? 0);
  const danmakuItems = danmakuQuery.data ?? [];
  const subtitleTracks = subtitles.data ?? [];

  /* 深链：?v=<id> 定位到指定短视频（渲染期同步，避免首帧闪动） */
  const [deepLinkApplied, setDeepLinkApplied] = useState<number | null>(null);
  if (initialId !== null && initialId !== deepLinkApplied && videos.length > 0) {
    const found = videos.findIndex((v) => v.id === initialId);
    setDeepLinkApplied(initialId);
    if (found >= 0 && found !== index) setIndex(found);
  }

  const goTo = useCallback(
    (next: number) => {
      if (next < 0) {
        toast({ title: '已经是第一个了', tone: 'info' });
        return;
      }
      if (next >= videos.length) {
        if (hasNextPage) { void fetchNextPage(); return; }
        else {
          toast({ title: '已经看完了当前推荐', description: '稍后会有新的内容', tone: 'info' });
          return;
        }
      }
      setDirection(next > index ? 1 : -1);
      setIndex(next);
      setPaused(false);
    },
    [fetchNextPage, hasNextPage, index, toast, videos.length],
  );

  /* 播放计数：短视频观看 ≥1s 即计数（文档 11.3） */
  useEffect(() => {
    if (!current) return;
    if (viewedRef.current.has(current.id)) return;
    const timer = window.setTimeout(() => {
      viewedRef.current.add(current.id);
      void videoApi.reportView(current.id).catch(() => undefined);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [current]);

  /* URL 同步当前视频 */
  useEffect(() => {
    if (!current) return;
    const next = new URLSearchParams(params);
    if (next.get('v') !== String(current.id)) {
      next.set('v', String(current.id));
      setParams(next, { replace: true });
    }
  }, [current, params, setParams]);

  /* 键盘：↑↓ / J K 切换，空格暂停，M 静音 */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      switch (event.key) {
        case 'ArrowDown':
        case 'j':
        case 'J':
          event.preventDefault();
          goTo(index + 1);
          break;
        case 'ArrowUp':
        case 'k':
        case 'K':
          event.preventDefault();
          goTo(index - 1);
          break;
        case ' ':
          event.preventDefault();
          setPaused((v) => !v);
          break;
        case 'm':
        case 'M':
          setMuted((v) => !v);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goTo, index]);

  /** 点赞：本地即时反馈 + 接口写入；成功后让详情缓存同步，避免回到详情页看到旧状态 */
  const likeVideo = useCallback(
    (videoId: number, active: boolean) => {
      void videoApi
        .like(videoId, active)
        .then(() => {
          setLocalLike(videoId, active);
          void client.invalidateQueries({ queryKey: ['videos', 'detail', videoId] });
        })
        .catch(() => toast({ title: '点赞失败，请重试', tone: 'error' }));
    },
    [client, toast],
  );

  /* 滚轮切换（桌面） */
  const wheelLock = useRef(false);
  const handleWheel = useCallback(
    (event: React.WheelEvent) => {
      if (wheelLock.current) return;
      if (Math.abs(event.deltaY) < 24) return;
      wheelLock.current = true;
      window.setTimeout(() => {
        wheelLock.current = false;
      }, 420);
      goTo(event.deltaY > 0 ? index + 1 : index - 1);
    },
    [goTo, index],
  );

  /* 指针拖拽：上滑下一个 / 下滑上一个（文档 5.6 手势控制） */
  const onPointerDown = useCallback((event: React.PointerEvent) => {
    dragStart.current = { y: event.clientY, t: Date.now() };
    longPressTimer.current = window.setTimeout(() => {
      setFastForward(true);
      setHint('2x 快进中');
    }, LONG_PRESS_MS);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const start = dragStart.current;
    if (!start) return;
    if (Math.abs(event.clientY - start.y) > 12) {
      if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
      setFastForward(false);
      setHint(null);
    }
  }, []);

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
      if (fastForward) {
        setFastForward(false);
        setHint(null);
        dragStart.current = null;
        return;
      }
      const start = dragStart.current;
      dragStart.current = null;
      if (!start) return;
      const deltaY = event.clientY - start.y;
      const elapsed = Math.max(1, Date.now() - start.t);
      const velocity = Math.abs(deltaY) / elapsed;

      if (Math.abs(deltaY) > SWIPE_DISTANCE && velocity > SWIPE_VELOCITY) {
        goTo(deltaY < 0 ? index + 1 : index - 1);
        return;
      }

      // 双击点赞（文档 4.2 / 12.3：心形粒子扩散）
      const now = Date.now();
      if (now - lastTap.current < 280) {
        const rect = containerRef.current?.getBoundingClientRect();
        const x = rect ? event.clientX - rect.left : 0;
        const y = rect ? event.clientY - rect.top : 0;
        const id = now;
        setHearts((prev) => [...prev, { id, x, y }]);
        window.setTimeout(() => setHearts((prev) => prev.filter((h) => h.id !== id)), 700);
        if (current && isLogin) likeVideo(current.id, true);
        lastTap.current = 0;
        return;
      }
      lastTap.current = now;
    },
    [current, fastForward, goTo, index, isLogin, likeVideo],
  );


  // 深链详情只有在「推荐流还没内容」时才阻塞渲染：分享链接请求慢或挂起时，
  // 不能让整个短视频页一直转圈，推荐流到了就先播。
  if (isLoading || (requestedId !== null && requested.isLoading && videos.length === 0)) {
    return (
      <div className="grid h-full place-items-center bg-black">
        <Spinner className="text-white" label="正在加载短视频" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="grid h-full place-items-center bg-canvas px-6">
        <ErrorState title="短视频加载失败" description="网络似乎不太稳定，请稍后重试。" onRetry={() => void refetch()} />
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="grid h-full place-items-center bg-canvas px-6">
        <EmptyState
          title="还没有短视频"
          description="成为第一个发布短视频的人，或者回到首页看看长视频。"
          action={
            <Link to="/">
              <Button variant="primary" size="sm">
                返回首页
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    /*
     * 大屏（lg+）下把视频约束到居中的竖屏列 —— 与抖音桌面版一致：
     * 只有视频被约束住，右侧才腾得出空间让评论面板与视频并排显示。
     * 小屏保持全屏沉浸式，评论区改为底部抽屉（右侧确实没有位置）。
     */
    <div className="flex size-full bg-black">
      <div
        ref={containerRef}
        /*
         * 大屏下视频列占视口 1/2（宽屏另有 760px 上限，避免超宽屏上被拉得过大）。
         * 右侧面板是绝对定位的 380px，占半屏时两者不会重叠：720 + 380 = 1100 < 1440。
         *
         * --pcb-height 是播放器控制栏的实测高度（90px）加上少量余量，供底部信息区避让；
         * 放在这里而不是控制栏上，是因为信息区可能在控制栏挂载前就已渲染。
         */
        style={{ '--pcb-height': '6rem' } as React.CSSProperties}
        className="relative h-full w-full touch-none overflow-hidden bg-black lg:mx-auto lg:w-1/2 lg:max-w-[760px]"
        onWheel={handleWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
          dragStart.current = null;
          setFastForward(false);
          setHint(null);
        }}
      >
      {/* 视频层 */}
      <AnimatePresence initial={false} custom={direction}>
        <motion.div
          key={current?.id}
          custom={direction}
          initial={{ y: direction > 0 ? '100%' : '-100%', scale: 0.95 }}
          animate={{ y: 0, scale: 1 }}
          exit={{ y: direction > 0 ? '-28%' : '28%', scale: 0.95, opacity: 0.6 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-0"
        >
          <ShortVideoPlayer
            src={current?.hlsUrl ?? ''}
            playbackRate={storeRate}
            poster={current?.coverUrl}
            playing={!paused}
            muted={muted}
            onToggleMute={() => setMuted((v) => !v)}
            onTogglePlay={() => setPaused((v) => !v)}
            onTimeUpdate={(time) => setCurrentTime(time)}
            onLevels={(next, _current, setLevel) => {
              setLevels(next);
              setPlayerLevelRef.current = setLevel;
            }}
            /* 与长视频同一套控制栏：倍速 / 清晰度 / 字幕 / 画中画 / 全屏 */
            showControls
            levels={levels}
            quality={storeQuality}
            onQualityChange={(tier, levelIndex) => {
              setStoreQuality(tier as Quality | null);
              setPlayerLevelRef.current?.(levelIndex);
            }}
            onRateChange={setStoreRate}
            hasSubtitles={subtitleTracks.length > 0}
            subtitlesOn={subtitlesOn}
            onToggleSubtitles={() => setSubtitlesOn((v) => !v)}
            danmakuSlot={
              <DanmakuButton
                enabled={danmakuOn}
                onToggleEnabled={() => setDanmakuOn((v) => !v)}
                currentTime={currentTime}
                onSend={async (content: string) => {
                  if (!isLogin) {
                    toast({ title: '登录后即可发送弹幕', tone: 'warning' });
                    throw new Error('unauthorized');
                  }
                  await sendDanmaku.mutateAsync({ content, timeMs: Math.round(currentTime * 1000) });
                  setHint('弹幕已发送');
                }}
              />
            }
            onHint={(text) => setHint(text)}
          />
        </motion.div>
      </AnimatePresence>

      {/* 弹幕层：置于视频之上、控制栏之下（控制栏 z-20），pointer-events 关闭以免挡手势 */}
      <DanmakuLayer items={danmakuItems} currentTime={currentTime} visible={danmakuOn} />

      {/* 播放/暂停指示 */}
      <AnimatePresence>
        {paused && (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            onClick={() => setPaused(false)}
            aria-label="继续播放"
            className="absolute inset-0 z-10 grid place-items-center bg-black/25"
          >
            <span className="grid size-16 place-items-center rounded-full bg-black/55 text-white">
              <Play className="size-7 translate-x-[2px] fill-current" />
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* 顶部返回与进度 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-3 bg-gradient-to-b from-black/60 to-transparent p-4 safe-top">
        <Link
          to="/"
          aria-label="返回首页"
          className="pointer-events-auto grid size-9 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <span className="text-sm font-medium text-white/90">短视频</span>
        <span className="pointer-events-auto ml-auto rounded-pill bg-black/40 px-2.5 py-1 text-[11px] text-white/85 backdrop-blur-sm">
          {index + 1} / {videos.length}
          {hasNextPage ? '+' : ''}
        </span>
      </div>

      {/* 右侧互动栏（文档 4.2） */}
      {current && (
        <div className="absolute right-3 bottom-32 z-20 flex flex-col items-center gap-4 sm:right-5">
          <Link to={`/user/${current.author.id}`} className="relative">
            <Avatar src={current.author.avatar} name={current.author.nickname} size="lg" className="ring-2 ring-white/70" />
          </Link>

          <InteractionButton
            icon={<Heart className={cn('size-7', (localLikes[current.id] ?? current.liked) && 'fill-current text-brand')} />}
            label="点赞"
            count={current.stats.likes + Number(localLikes[current.id] ?? current.liked ?? false) - Number(current.liked ?? false)}
            active={Boolean(localLikes[current.id] ?? current.liked)}
            onClick={() => {
              if (!isLogin) {
                toast({ title: '登录后即可点赞', tone: 'warning' });
                return;
              }
              likeVideo(current.id, !(localLikes[current.id] ?? current.liked));
            }}
          />
          <InteractionButton
            icon={<MessageCircle className="size-7" />}
            label="评论"
            count={current.stats.comments}
            onClick={() => {
              setPanelTab('comments');
              setPanelOpen(true);
            }}
          />
          <InteractionButton
            icon={<Bookmark className={cn('size-7', (localFavorites[current.id] ?? current.favorited) && 'fill-current text-brand')} />}
            label="收藏"
            count={current.stats.favorites + Number(localFavorites[current.id] ?? current.favorited ?? false) - Number(current.favorited ?? false)}
            active={localFavorites[current.id] ?? current.favorited}
            onClick={() => {
              if (!isLogin) {
                toast({ title: '登录后即可收藏', tone: 'warning' });
                return;
              }
              const active = !(localFavorites[current.id] ?? current.favorited);
              void videoApi.favorite(current.id, active).then(() => {
                setLocalFavorites((previous) => ({ ...previous, [current.id]: active }));
                // 收藏夹列表与详情缓存都要失效，否则「我的收藏」在 staleTime 内仍是旧成员关系。
                void client.invalidateQueries({ queryKey: ['videos', 'favorites'] });
                void client.invalidateQueries({ queryKey: ['videos', 'detail', current.id] });
                toast({ title: '已更新收藏', tone: 'success' });
              }).catch(() => toast({ title: '收藏失败，请重试', tone: 'error' }));
            }}
          />
          <InteractionButton icon={<Share2 className="size-7" />} label="分享" onClick={() => setShareOpen(true)} />
          <InteractionButton
            icon={muted ? <VolumeX className="size-6" /> : <Volume2 className="size-6" />}
            label={muted ? '取消静音' : '静音'}
            onClick={() => setMuted((v) => !v)}
          />
          <button
            type="button"
            aria-label="举报"
            onClick={() => setReportOpen(true)}
            className="text-[10px] text-white/70 hover:text-white"
          >
            举报
          </button>
        </div>
      )}

      {/* 底部信息区：给下方控制栏留出高度并多留 8px 余量，避免两者贴边重叠 */}
      {current && (
        <div
          className="pointer-events-none absolute inset-x-0 z-20 px-4 pb-2"
          style={{ bottom: 'calc(var(--pcb-height, 5.5rem) + 8px)' }}
        >
          <div className="max-w-[76%] rounded-card bg-black/45 px-3 py-2 backdrop-blur-sm">
            <Link to={`/user/${current.author.id}`} className="pointer-events-auto flex items-center gap-2">
              <span className="text-sm font-semibold text-white">@{current.author.nickname}</span>
              {current.author.certified && <Badge tone="brand">认证</Badge>}
            </Link>
            <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-white/92">{current.title}</p>
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-white/70">
              <Music2 className="size-3" aria-hidden />
              原声 · {current.author.nickname}
              <span aria-hidden>·</span>
              {formatCount(current.stats.views)} 次播放
              <span aria-hidden>·</span>
              {current.category?.name}
            </p>
          </div>
        </div>
      )}

      {/* 操作提示 */}
      <AnimatePresence>
        {hint && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute top-20 left-1/2 z-30 -translate-x-1/2 rounded-pill bg-black/65 px-3 py-1.5 text-xs text-white"
          >
            {hint}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 双击点赞心形粒子 */}
      <div className="pointer-events-none absolute inset-0 z-30">
        <AnimatePresence>
          {hearts.map((heart) => (
            <motion.span
              key={heart.id}
              initial={{ opacity: 0, scale: 0, rotate: -12 }}
              animate={{ opacity: [0, 1, 1, 0], scale: [0, 1.4, 0.8, 1.15], rotate: [-12, 6, 0, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.66, ease: [0.22, 1, 0.36, 1] }}
              className="absolute text-brand"
              style={{ left: heart.x - 32, top: heart.y - 32 }}
            >
              <Heart className="size-16 fill-current drop-shadow-lg" />
              {Array.from({ length: 6 }, (_, i) => {
                const angle = (i / 6) * Math.PI * 2;
                return (
                  <motion.span
                    key={i}
                    initial={{ opacity: 0.9, x: 0, y: 0, scale: 1 }}
                    animate={{
                      opacity: 0,
                      x: Math.cos(angle) * 52,
                      y: Math.sin(angle) * 52,
                      scale: 0.4,
                    }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                    className="absolute top-1/2 left-1/2 size-2 rounded-full bg-brand"
                  />
                );
              })}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>

      {/* 手势提示：底部信息区最高约 11rem，这里抬到其上方，避免压住弹幕输入框 */}
      <div className="pointer-events-none absolute bottom-[12rem] left-1/2 z-20 hidden -translate-x-1/2 text-[11px] text-white/55 lg:block">
        上滑看下一个 · 双击点赞 · 长按 2 倍速
      </div>
      </div>

      {current && (
        <>
          <ShareDialog
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            title={current.title}
            path={`/shorts?v=${current.id}`}
            coverUrl={current.coverUrl}
          />
          <ReportDialog
            open={reportOpen}
            onClose={() => setReportOpen(false)}
            targetType="VIDEO"
            targetId={current.id}
            targetTitle={current.title}
          />
        </>
      )}

      {/* 右侧信息面板：详情 / TA的作品 / 评论 / 相关推荐（对齐抖音式排版） */}
      {panelOpen && (
        <ShortsSidePanel
          video={current}
          tab={panelTab}
          onTabChange={setPanelTab}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
  );
}

function InteractionButton({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className="flex flex-col items-center gap-1 text-white transition-transform active:scale-90"
    >
      <span
        className={cn(
          'grid size-11 place-items-center rounded-full bg-black/35 backdrop-blur-sm transition-colors',
          active && 'bg-brand-soft',
        )}
      >
        {icon}
      </span>
      {count !== undefined && <span className="text-[11px] tabular-nums text-white/85">{formatCount(count)}</span>}
    </button>
  );
}
