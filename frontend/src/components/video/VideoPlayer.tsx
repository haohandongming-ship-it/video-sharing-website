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
import { PlayerControlBar } from './PlayerControlBar';
import { KEYBOARD_SHORTCUTS, QUALITY_TIERS, RATE_OPTIONS } from '@/lib/constants';
import { Dropdown, IconButton, Tooltip } from '@/components/ui';
import { useHlsPlayer } from './useHlsPlayer';
import { useUiStore } from '@/stores/uiStore';
import { usePlayerStore } from '@/stores/playerStore';

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
  /** 快捷键 / 状态提示的定时器句柄（见 flashHint）。 */
  const hintTimer = useRef<number | null>(null);
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
  /** 清晰度偏好与设置页「默认清晰度」共用 playerStore.quality，null = 自动 */
  const storeQuality = usePlayerStore((s) => s.quality);
  const setStoreQuality = usePlayerStore((s) => s.setQuality);

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

  /**
   * 快捷键 / 状态提示：连续触发时必须撤销上一个定时器，否则旧定时器会提前把新提示清掉；
   * 组件卸载时也要撤销，避免在已卸载的组件上 setState。
   */
  const flashHint = useCallback((text: string, durationMs = 900) => {
    setShortcutHint(text);
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => {
      hintTimer.current = null;
      setShortcutHint(null);
    }, durationMs);
  }, []);

  useEffect(
    () => () => {
      if (hintTimer.current !== null) {
        window.clearTimeout(hintTimer.current);
        hintTimer.current = null;
      }
    },
    [],
  );

  const togglePip = useCallback(async () => {
    const video = videoRef.current as (HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }) | null;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture?.();
    } catch {
      flashHint('当前浏览器不支持画中画', 1800);
    }
  }, [videoRef, flashHint]);

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

  /**
   * 键盘操作进度条：←/→ 与 ↑/↓ 步进 5 秒，Home/End 跳到首尾。
   *
   * <p>进度条声明了 {@code role="slider"} 与 {@code tabIndex=0}，屏幕阅读器会承诺它是可操作的，
   * 因此必须真的支持键盘。播放器在 document 上也绑定了同一批快捷键，这里必须阻止冒泡，
   * 否则一次按键会跳两次。</p>
   */
  const handleSeekKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    const step = 5;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = Math.min(duration, currentTime + step);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = Math.max(0, currentTime - step);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = duration;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    player.seek(next);
  };

  const VolumeIcon = storeMuted || storeVolume === 0 ? VolumeX : storeVolume < 0.5 ? Volume1 : Volume2;
  /** 触发按钮显示当前实际生效的梯度：自动档显示 ABR 选中的那一层，固定档显示该层名称。 */
  const qualityLabel = currentLevel === -1 ? '自动' : (levels[currentLevel]?.name ?? '自动');
  const qualityTriggerLabel = storeQuality ? (QUALITY_TIERS.find((t) => t.value === storeQuality)?.label ?? qualityLabel) : qualityLabel;

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
          onKeyDown={handleSeekKeyDown}
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
              side="top"
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
              side="top"
              items={QUALITY_TIERS.map((tier) => {
                const target = player.levelForQuality(tier.value);
                // 固定梯度在本视频清单里不一定存在时，说明会退到哪一档，避免用户以为设置没生效
                const actual = tier.value && levels.length > 0 && target >= 0 ? levels[target]?.name : null;
                const description =
                  tier.value && levels.length > 0 && actual && actual !== tier.label.toLowerCase()
                    ? `${tier.description}（本视频最高 ${actual}）`
                    : tier.description;
                return {
                  key: tier.value ?? 'auto',
                  label: tier.label,
                  description,
                  selected: (storeQuality ?? null) === tier.value,
                  onSelect: () => {
                    setStoreQuality(tier.value);
                    player.setLevel(target);
                    flashHint(
                      tier.value
                        ? `清晰度 ${tier.label}${actual && actual !== tier.label.toLowerCase() ? `（本视频为 ${actual}）` : ''}`
                        : '清晰度自动',
                    );
                  },
                };
              })}
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
                      {qualityOpen ? '' : qualityTriggerLabel}
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
  onTogglePlay,
  playbackRate = 1,
  onTimeUpdate,
  onLevels,
  showControls = false,
  levels = [],
  quality = null,
  onQualityChange,
  onRateChange,
  onVolumeChange,
  hasSubtitles = false,
  subtitlesOn = false,
  onToggleSubtitles,
  danmakuSlot,
  onHint,
}: {
  src?: string | null;
  poster?: string;
  playing: boolean;
  onEnded?: () => void;
  className?: string;
  muted: boolean;
  onToggleMute: () => void;
  /** 单击视频时的行为（短视频为播放/暂停，与长视频一致） */
  onTogglePlay?: () => void;
  playbackRate?: number;
  /** 播放进度回调（秒），短视频弹幕层需要据此投放弹幕 */
  onTimeUpdate?: (time: number, duration: number) => void;
  /** HLS 清晰度清单回调，短视频底部控制栏据此提供清晰度切换 */
  onLevels?: (levels: { index: number; name: string; height: number }[], current: number, setLevel: (index: number) => void) => void;
  /** 是否叠加控制栏（与长视频同一套图标与交互） */
  showControls?: boolean;
  levels?: { index: number; name: string; height: number }[];
  quality?: string | null;
  onQualityChange?: (tier: string | null, levelIndex: number) => void;
  onRateChange?: (rate: number) => void;
  onVolumeChange?: (volume: number) => void;
  hasSubtitles?: boolean;
  subtitlesOn?: boolean;
  onToggleSubtitles?: () => void;
  danmakuSlot?: React.ReactNode;
  onHint?: (text: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<HlsType | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const volume = useUiStore((s) => s.volume);
  const setStoreVolume = useUiStore((s) => s.setVolume);
  const setStoreMuted = useUiStore((s) => s.setMuted);
  /*
   * 回调同步进 ref：父组件传的多是内联函数，每次渲染都会变。
   * 若直接写进 hls 初始化 effect 的依赖，会导致实例被反复销毁重建（视频从头加载）。
   * 因此只在 effect 里更新 ref，不放进依赖数组。
   */
  const timeUpdateRef = useRef(onTimeUpdate);
  const levelsRef = useRef(onLevels);
  useEffect(() => {
    timeUpdateRef.current = onTimeUpdate;
    levelsRef.current = onLevels;
  });

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
        hls.on(HlsCtor.Events.MANIFEST_PARSED, (_event, data) => {
          levelsRef.current?.(
            data.levels.map((level, index) => ({
              index,
              height: level.height || 0,
              name: level.height ? `${level.height}p` : `${Math.round(level.bitrate / 1000)}kbps`,
            })),
            hls.currentLevel,
            (index: number) => {
              hls.currentLevel = index;
            },
          );
        });
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

  /* 进度 / 缓冲：控制栏进度条与时间显示需要 */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      setDuration(video.duration || 0);
      setCurrentTime(video.currentTime || 0);
      const buffered = video.buffered;
      setBufferedPercent(
        buffered.length > 0 && video.duration > 0
          ? Math.min(100, (buffered.end(buffered.length - 1) / video.duration) * 100)
          : 0,
      );
    };
    const onProgress = () => sync();
    video.addEventListener('loadedmetadata', sync);
    video.addEventListener('durationchange', sync);
    video.addEventListener('progress', onProgress);
    return () => {
      video.removeEventListener('loadedmetadata', sync);
      video.removeEventListener('durationchange', sync);
      video.removeEventListener('progress', onProgress);
    };
  }, [src]);

  /* 全屏：容器需要 position:relative，全屏状态下由容器承载 UI */
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrapperRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await wrapperRef.current?.requestFullscreen();
    } catch {
      /* 用户手势缺失或被策略拒绝时忽略 */
    }
  }, []);

  const togglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      /* 不支持画中画时忽略 */
    }
  }, []);

  return (
    <div ref={wrapperRef} className="relative size-full">
      <video
        ref={videoRef}
        poster={poster}
        playsInline
        loop
        preload="metadata"
        onClick={() => {
          // 单击播放/暂停（与长视频一致）；此前是切换静音，与直觉不符。
          // 用户正在选中文字时不打断。
          if (window.getSelection()?.toString()) return;
          onTogglePlay?.();
        }}
        onEnded={onEnded}
        onTimeUpdate={(event) => {
          timeUpdateRef.current?.(event.currentTarget.currentTime, event.currentTarget.duration || 0);
          setCurrentTime(event.currentTarget.currentTime || 0);
        }}
        className={cn('size-full bg-black object-contain', className)}
      >
        {/* 字幕靠条件渲染控制：关闭时不渲染 track，无需再改 textTracks 的 mode */}
        {subtitlesOn && hasSubtitles && <track kind="captions" label="字幕" default />}
      </video>
      {/* 没有源文件时不能只留一块黑屏：长视频页有对应文案，短视频页补上同款提示。 */}
      {!src && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-sm text-white/80">
          视频尚未提供可播放的源文件
        </div>
      )}
      {showControls && (
        <div
          /*
           * relative + z-70：控制栏必须是这个堆叠上下文里最高的一层，
           * 否则页面级的弹幕层（同为 z-70、且在 DOM 中更靠后）会盖住栏内的
           * 倍速/清晰度菜单。菜单自身在 Overlay 里是 z-70，靠这里的上下文层级取胜，
           * 不必把它调到 z-90（那会盖过顶栏与弹窗）。
           *
           * 弹幕输入浮层（DanmakuButton）作为控制栏的子节点渲染，因此自动位于控制栏之上。
           */
          className="absolute inset-x-0 bottom-0 z-70 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pt-8 pb-2.5"
          onClick={(event) => event.stopPropagation()}
        >
          <PlayerControlBar
            playing={playing}
            currentTime={currentTime}
            duration={duration}
            bufferedPercent={bufferedPercent}
            muted={muted}
            volume={volume}
            onTogglePlay={() => {
              const video = videoRef.current;
              if (video) {
                if (video.paused) void video.play().catch(() => undefined);
                else video.pause();
              }
              onTogglePlay?.();
            }}
            onToggleMute={onToggleMute}
            onVolumeChange={(next) => {
              setStoreVolume(next);
              setStoreMuted(next === 0);
              onVolumeChange?.(next);
            }}
            onSeek={(time: number) => {
              const video = videoRef.current;
              if (video) video.currentTime = time;
            }}
            rate={playbackRate}
            onRateChange={(next) => onRateChange?.(next)}
            levels={levels}
            quality={quality}
            onQualityChange={(tier, levelIndex) => onQualityChange?.(tier, levelIndex)}
            hasSubtitles={hasSubtitles}
            subtitlesOn={subtitlesOn}
            onToggleSubtitles={() => onToggleSubtitles?.()}
            danmakuSlot={danmakuSlot}
            onTogglePip={() => void togglePip()}
            fullscreen={fullscreen}
            onToggleFullscreen={() => void toggleFullscreen()}
            onHint={onHint}
          />
        </div>
      )}
    </div>
  );
}
