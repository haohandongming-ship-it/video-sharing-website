import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type HlsType from 'hls.js';
import {
  Gauge,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  Settings2,
  Subtitles,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { KEYBOARD_SHORTCUTS, RATE_OPTIONS } from '@/lib/constants';
import { Dropdown, IconButton, Tooltip } from '@/components/ui';
import { useHlsPlayer } from './useHlsPlayer';
import { useUiStore } from '@/stores/uiStore';

export interface VideoPlayerProps {
  src?: string | null;
  poster?: string;
  title: string;
  /** 记忆播放起始位置（秒） */
  startTime?: number;
  autoPlay?: boolean;
  className?: string;
  /** 播放达到该秒数后回调一次（用于播放计数，文档 11.3 ≥3s） */
  onViewCounted?: () => void;
  /** 播放进度回调，节流由调用方处理 */
  onProgress?: (time: number, duration: number) => void;
  onEnded?: () => void;
  /** 快捷键提示浮层 */
  showShortcuts?: boolean;
}

const VIEW_THRESHOLD = 3;

/**
 * 长视频播放器：自研控制层（文档 5.2 组件树 PlayerContainer / PlayerControls / QualitySelector / ProgressBar）
 *
 * 键盘快捷键（文档 5.6）：空格暂停、←→±5s、↑↓音量、F 全屏、M 静音、0-9 跳转。
 */
export function VideoPlayer({
  src,
  poster,
  title,
  startTime = 0,
  autoPlay = false,
  className,
  onViewCounted,
  onProgress,
  onEnded,
  showShortcuts = true,
}: VideoPlayerProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const countedRef = useRef(false);
  const hideTimer = useRef<number | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [shortcutHint, setShortcutHint] = useState<string | null>(null);
  const [subtitlesOn, setSubtitlesOn] = useState(false);

  const storeVolume = useUiStore((s) => s.volume);
  const storeMuted = useUiStore((s) => s.muted);
  const storeRate = useUiStore((s) => s.playbackRate);
  const setStoreVolume = useUiStore((s) => s.setVolume);
  const setStoreMuted = useUiStore((s) => s.setMuted);
  const setStoreRate = useUiStore((s) => s.setPlaybackRate);

  const player = useHlsPlayer({
    src,
    autoPlay,
    startTime,
    onEnded,
    onTimeUpdate: (time, duration) => {
      onProgress?.(time, duration);
      if (!countedRef.current && time >= VIEW_THRESHOLD) {
        countedRef.current = true;
        onViewCounted?.();
      }
    },
  });

  const { videoRef, playing, ready, waiting, duration, currentTime, buffered, error, levels, currentLevel } = player;

  /* 把持久化的偏好同步到媒体元素（副作用作用于外部系统，不触发 React 渲染） */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = storeVolume;
    video.muted = storeMuted;
    video.playbackRate = storeRate;
  }, [videoRef, storeVolume, storeMuted, storeRate, ready]);

  /* 控制栏自动隐藏（文档 12.3：悬停时从底部滑入 200ms） */
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!videoRef.current?.paused) setControlsVisible(false);
    }, 2600);
  }, [videoRef]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    // 仅调度外部定时器，不直接触发 React 状态更新
    scheduleHide();
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [scheduleHide]);

  /* 全屏状态同步 */
  useEffect(() => {
    const handler = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const node = containerRef.current;
    if (!node) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await node.requestFullscreen();
    } catch {
      /* iOS Safari 不支持容器全屏，降级为 video 元素全屏 */
      const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
      video?.webkitEnterFullscreen?.();
    }
  }, [videoRef]);

  const togglePip = useCallback(async () => {
    const video = videoRef.current as (HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }) | null;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture?.();
    } catch {
      setShortcutHint('当前浏览器不支持画中画');
      window.setTimeout(() => setShortcutHint(null), 1800);
    }
  }, [videoRef]);

  const flashHint = useCallback((text: string) => {
    setShortcutHint(text);
    window.setTimeout(() => setShortcutHint(null), 900);
  }, []);

  /* 键盘快捷键 */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (target?.isContentEditable) return;

      switch (event.key) {
        case ' ':
        case 'k':
        case 'K':
          event.preventDefault();
          player.toggle();
          flashHint(player.playing ? '暂停' : '播放');
          break;
        case 'ArrowLeft':
          event.preventDefault();
          player.seekBy(-5);
          flashHint('« 5 秒');
          break;
        case 'ArrowRight':
          event.preventDefault();
          player.seekBy(5);
          flashHint('5 秒 »');
          break;
        case 'ArrowUp': {
          event.preventDefault();
          const next = Math.min(1, storeVolume + 0.05);
          setStoreVolume(next);
          setStoreMuted(false);
          flashHint(`音量 ${Math.round(next * 100)}%`);
          break;
        }
        case 'ArrowDown': {
          event.preventDefault();
          const next = Math.max(0, storeVolume - 0.05);
          setStoreVolume(next);
          flashHint(`音量 ${Math.round(next * 100)}%`);
          break;
        }
        case 'f':
        case 'F':
          event.preventDefault();
          void toggleFullscreen();
          break;
        case 'm':
        case 'M':
          event.preventDefault();
          setStoreMuted(!storeMuted);
          flashHint(storeMuted ? '取消静音' : '静音');
          break;
        case 'c':
        case 'C':
          setSubtitlesOn((v) => !v);
          flashHint(subtitlesOn ? '关闭字幕' : '开启字幕');
          break;
        default:
          if (/^[0-9]$/.test(event.key) && duration > 0) {
            const ratio = Number(event.key) / 10;
            player.seek(duration * ratio);
            flashHint(`跳转 ${Math.round(ratio * 100)}%`);
          }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [player, storeVolume, storeMuted, setStoreVolume, setStoreMuted, toggleFullscreen, duration, flashHint, subtitlesOn]);

  const percent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;

  const handleSeekClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    player.seek(ratio * duration);
  };

  const VolumeIcon = storeMuted || storeVolume === 0 ? VolumeX : storeVolume < 0.5 ? Volume1 : Volume2;
  const qualityLabel = currentLevel === -1 ? '自动' : (levels[currentLevel]?.name ?? '自动');

  return (
    <div
      ref={(node) => {
        containerRef.current = node;
        setContainer(node);
      }}
      className={cn(
        'group/player relative aspect-video w-full overflow-hidden rounded-card bg-black select-none',
        className,
      )}
      onMouseMove={revealControls}
      onMouseLeave={() => playing && setControlsVisible(false)}
      onDoubleClick={() => void toggleFullscreen()}
      tabIndex={0}
      role="region"
      aria-label={`播放器：${title}`}
    >
      <video
        ref={videoRef}
        poster={poster}
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
        className="size-full bg-black object-contain"
        onClick={player.toggle}
      >
        {subtitlesOn && <track kind="captions" label="中文（自动生成）" default />}
      </video>

      {/* 加载中 / 缓冲 */}
      {(waiting || !ready) && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="size-10 animate-spin rounded-full border-2 border-white/25 border-t-white" aria-label="缓冲中" />
        </div>
      )}

      {/* 错误态：不打断页面，提供重试 */}
      {error && (
        <div className="absolute inset-0 grid place-items-center bg-black/72 px-6 text-center">
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-white/90">{error}</p>
            <button
              type="button"
              onClick={() => {
                countedRef.current = false;
                player.seek(0);
                void player.play();
              }}
              className="inline-flex items-center gap-1.5 rounded-pill bg-white/15 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-white/25"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              重新播放
            </button>
          </div>
        </div>
      )}

      {/* 中央播放按钮（暂停时） */}
      {!playing && !error && ready && (
        <button
          type="button"
          onClick={player.toggle}
          aria-label="播放"
          className="absolute inset-0 grid place-items-center bg-black/15 transition-colors hover:bg-black/25"
        >
          <span className="grid size-16 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-transform duration-200 hover:scale-105">
            <Play className="size-7 translate-x-[2px] fill-current" />
          </span>
        </button>
      )}

      {/* 快捷键提示浮层 */}
      {shortcutHint && (
        <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-pill bg-black/72 px-3 py-1.5 text-xs font-medium text-white">
          {shortcutHint}
        </div>
      )}

      {/* 控制栏 */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pt-10 pb-2.5 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
          controlsVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
        )}
      >
        {/* 进度条 */}
        <div
          className="group/bar relative mb-1 h-3 cursor-pointer"
          onClick={handleSeekClick}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            setHoverTime(ratio * duration);
            setHoverX(event.clientX - rect.left);
          }}
          onMouseLeave={() => setHoverTime(null)}
          role="slider"
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
          tabIndex={0}
        >
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-pill bg-white/25 transition-[height] group-hover/bar:h-1.5">
            <div className="h-full rounded-pill bg-white/35" style={{ width: `${bufferedPercent}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-pill bg-brand" style={{ width: `${percent}%` }} />
            <div
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand opacity-0 transition-opacity group-hover/bar:opacity-100"
              style={{ left: `${percent}%` }}
            />
          </div>
          {hoverTime !== null && (
            <div
              className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded-[6px] bg-black/85 px-2 py-1 text-[11px] tabular-nums text-white"
              style={{ left: hoverX }}
            >
              {formatDuration(hoverTime)}
            </div>
          )}
        </div>

        {/* 按钮区 */}
        <div className="flex items-center gap-1 text-white">
          <IconButton
            label={playing ? '暂停 (K)' : '播放 (K)'}
            variant="ghost"
            size="icon-sm"
            className="text-white hover:bg-white/15 hover:text-white"
            onClick={player.toggle}
          >
            {playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
          </IconButton>

          <div className="group/vol flex items-center">
            <IconButton
              label={storeMuted ? '取消静音 (M)' : '静音 (M)'}
              variant="ghost"
              size="icon-sm"
              className="text-white hover:bg-white/15 hover:text-white"
              onClick={() => setStoreMuted(!storeMuted)}
            >
              <VolumeIcon className="size-4" />
            </IconButton>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={storeMuted ? 0 : storeVolume}
              aria-label="音量"
              onChange={(event) => {
                setStoreVolume(Number(event.target.value));
                setStoreMuted(Number(event.target.value) === 0);
              }}
              className="range-media h-1 w-0 opacity-0 transition-[width,opacity] duration-200 group-hover/vol:w-20 group-hover/vol:opacity-100 focus:w-20 focus:opacity-100"
            />
          </div>

          <span className="ml-1 text-xs tabular-nums text-white/90">
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>

          <div className="ml-auto flex items-center gap-0.5">
            <Dropdown
              align="end"
              items={RATE_OPTIONS.map((rate) => ({
                key: String(rate),
                label: rate === 1 ? '正常速度' : `${rate}x`,
                onSelect: () => {
                  setStoreRate(rate);
                  flashHint(`倍速 ${rate}x`);
                },
              }))}
              trigger={({ toggle }) => (
                <Tooltip content="播放速度">
                  <IconButton
                    label="播放速度"
                    variant="ghost"
                    size="icon-sm"
                    className="text-white hover:bg-white/15 hover:text-white"
                    onClick={() => {
                      setRateOpen((v) => !v);
                      toggle();
                    }}
                  >
                    <span className="text-[11px] font-semibold tabular-nums">
                      {storeRate === 1 && !rateOpen ? <Gauge className="size-4" /> : `${storeRate}x`}
                    </span>
                  </IconButton>
                </Tooltip>
              )}
            />

            <Dropdown
              align="end"
              items={[
                { key: 'auto', label: levels.length ? `自动（当前 ${qualityLabel}）` : '原始文件', onSelect: () => player.setLevel(-1) },
                ...levels.map((level) => ({
                  key: String(level.index),
                  label: level.name,
                  onSelect: () => player.setLevel(level.index),
                })),
              ]}
              trigger={({ toggle }) => (
                <Tooltip content="清晰度">
                  <IconButton
                    label="清晰度"
                    variant="ghost"
                    size="icon-sm"
                    className="text-white hover:bg-white/15 hover:text-white"
                    onClick={() => {
                      setQualityOpen((v) => !v);
                      toggle();
                    }}
                  >
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold">
                      <Settings2 className="size-3.5" />
                      {qualityOpen ? '' : qualityLabel}
                    </span>
                  </IconButton>
                </Tooltip>
              )}
            />

            <Tooltip content="字幕 (C)">
              <IconButton
                label="字幕"
                variant="ghost"
                size="icon-sm"
                className={cn('text-white hover:bg-white/15 hover:text-white', subtitlesOn && 'text-brand')}
                onClick={() => setSubtitlesOn((v) => !v)}
              >
                <Subtitles className="size-4" />
              </IconButton>
            </Tooltip>

            <Tooltip content="画中画">
              <IconButton
                label="画中画"
                variant="ghost"
                size="icon-sm"
                className="text-white hover:bg-white/15 hover:text-white"
                onClick={() => void togglePip()}
              >
                <PictureInPicture2 className="size-4" />
              </IconButton>
            </Tooltip>

            <Tooltip content={fullscreen ? '退出全屏 (F)' : '全屏 (F)'}>
              <IconButton
                label={fullscreen ? '退出全屏' : '全屏'}
                variant="ghost"
                size="icon-sm"
                className="text-white hover:bg-white/15 hover:text-white"
                onClick={() => void toggleFullscreen()}
              >
                {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
              </IconButton>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* 全屏模式下的快捷键面板（通过 Portal 注入到容器内，避免嵌套异常） */}
      {showShortcuts &&
        fullscreen &&
        container &&
        createPortal(
          <div className="pointer-events-none absolute top-4 right-4 rounded-card bg-black/70 px-3 py-2 text-[11px] leading-relaxed text-white/85">
            {KEYBOARD_SHORTCUTS.slice(0, 5).map((item) => (
              <div key={item.keys} className="flex items-center gap-2">
                <kbd className="rounded-[4px] bg-white/15 px-1.5 py-px font-mono">{item.keys}</kbd>
                <span>{item.action}</span>
              </div>
            ))}
          </div>,
          container,
        )}
    </div>
  );
}

/** 短视频播放器：无控制条、自动循环、静音起步（点击后开启声音） */
export function ShortVideoPlayer({
  src,
  poster,
  playing,
  onEnded,
  className,
  muted,
  onToggleMute,
  playbackRate = 1,
}: {
  src?: string | null;
  poster?: string;
  playing: boolean;
  onEnded?: () => void;
  className?: string;
  muted: boolean;
  onToggleMute: () => void;
  playbackRate?: number;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<HlsType | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const source = src || '';
    // 上传的视频由后端直接提供 MP4 源文件。短视频之前一律交给 hls.js，
    // 导致真实上传文件无法播放（hls.js 只支持 HLS 清单）。
    const nativeSource = /\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/i.test(source)
      || /\/api\/v1\/videos\/\d+\/source(?:[?#]|$)/i.test(source);
    let cancelled = false;

    const setup = async () => {
      if (!source) return;
      if (nativeSource) {
        video.src = source;
        return;
      }
      const { default: HlsCtor } = await import('hls.js');
      if (cancelled) return;
      if (HlsCtor.isSupported()) {
        const hls = new HlsCtor({ enableWorker: true, capLevelToPlayerSize: true });
        hlsRef.current = hls;
        hls.loadSource(source);
        hls.attachMedia(video);
      } else {
        video.src = source;
      }
    };
    void setup();

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
  }, [muted]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) void video.play().catch(() => undefined);
    else video.pause();
  }, [playing]);

  return (
    <>
      <video
        ref={videoRef}
        poster={poster}
        playsInline
        loop
        preload="metadata"
        onClick={onToggleMute}
        onEnded={onEnded}
        className={cn('size-full bg-black object-contain', className)}
      />
      {/* 没有源文件时不能只留一块黑屏：长视频页有对应文案，短视频页补上同款提示。 */}
      {!src && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-sm text-white/80">
          视频尚未提供可播放的源文件
        </div>
      )}
    </>
  );
}
