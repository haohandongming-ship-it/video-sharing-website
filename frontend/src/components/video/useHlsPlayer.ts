import { useCallback, useEffect, useRef, useState } from 'react';
import type HlsType from 'hls.js';
import type { Level } from 'hls.js';
import { DEMO_HLS_URL, USE_MOCK } from '@/api/config';

export interface HlsLevel {
  index: number;
  height: number;
  bitrate: number;
  name: string;
}

export interface UseHlsPlayerOptions {
  src?: string | null;
  autoPlay?: boolean;
  startTime?: number;
  onEnded?: () => void;
  onTimeUpdate?: (time: number, duration: number) => void;
  onError?: (message: string) => void;
}

export interface HlsPlayerApi {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  ready: boolean;
  playing: boolean;
  waiting: boolean;
  ended: boolean;
  duration: number;
  currentTime: number;
  buffered: number;
  error: string | null;
  levels: HlsLevel[];
  currentLevel: number;
  /** -1 表示自动（ABR） */
  setLevel: (index: number) => void;
  play: () => Promise<void>;
  pause: () => void;
  toggle: () => void;
  seek: (time: number) => void;
  seekBy: (delta: number) => void;
  setVolume: (volume: number) => void;
}

/**
 * HLS 播放内核（文档 5.1 选型：HLS.js + 自研控制层）
 *
 * - 优先使用 hls.js 实现多清晰度切换与弱网自适应；Safari 等原生支持 HLS 的浏览器直接回退到原生播放；
 * - 加载失败时自动回退到内置演示流，保证演示环境始终可播放（文档 15.2 降级矩阵）。
 */
export function useHlsPlayer({
  src,
  autoPlay = false,
  startTime = 0,
  onEnded,
  onTimeUpdate,
  onError,
}: UseHlsPlayerOptions): HlsPlayerApi {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<HlsType | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [ended, setEnded] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<HlsLevel[]>([]);
  const [currentLevel, setCurrentLevelState] = useState(-1);
  const startTimeRef = useRef(startTime);
  const fallbackUsed = useRef(false);
  /**
   * 回调放进 ref：父组件每次渲染都会传入新的函数身份，
   * 若直接作为 effect 依赖会导致 hls 实例被反复销毁重建（表现为「视频加载失败」）。
   */
  const callbacksRef = useRef({ onEnded, onTimeUpdate, onError });

  useEffect(() => {
    startTimeRef.current = startTime;
  }, [startTime]);

  useEffect(() => {
    callbacksRef.current = { onEnded, onTimeUpdate, onError };
  }, [onEnded, onTimeUpdate, onError]);

  const destroy = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const source = src || (USE_MOCK ? DEMO_HLS_URL : '');
    let cancelled = false;

    destroy();
    setReady(false);
    setError(null);
    setLevels([]);
    setCurrentLevelState(-1);
    fallbackUsed.current = false;

    const attachNative = () => {
      video.src = source;
      setReady(true);
    };

    /** 按需加载 hls.js：首屏不下载媒体库（约 590KB），进入播放页才加载 */
    const setup = async () => {
      if (!source) { setError('视频尚未提供可播放的源文件'); return; }
      // 上传后的源文件通过 /source 提供，URL 没有扩展名；这类地址必须交给浏览器原生媒体管线，不能交给 hls.js。
      if (/\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(source) || /\/api\/v1\/videos\/\d+\/source(?:[?#]|$)/i.test(source)) {
        attachNative();
        return;
      }
      const mod = await import('hls.js');
      if (cancelled) return;
      const Hls = mod.default;

      if (!Hls.isSupported()) {
        attachNative();
        return;
      }

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        capLevelToPlayerSize: true,
        startLevel: -1,
        maxBufferLength: 30,
        backBufferLength: 30,
      });
      hlsRef.current = hls;
      hls.loadSource(source);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        setLevels(
          data.levels.map((level: Level, index: number) => ({
            index,
            height: level.height || 0,
            bitrate: level.bitrate,
            name: level.height ? `${level.height}p` : `${Math.round(level.bitrate / 1000)}kbps`,
          })),
        );
        setReady(true);
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        setCurrentLevelState(hls.autoLevelEnabled ? -1 : data.level);
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        // 致命错误：先尝试用备用演示流恢复，仍失败则报错并展示重试入口
        if (USE_MOCK && !fallbackUsed.current && source !== DEMO_HLS_URL) {
          fallbackUsed.current = true;
          hls.loadSource(DEMO_HLS_URL);
          return;
        }
        const message = data.type === 'networkError' ? '网络异常，播放中断' : '视频加载失败，请稍后重试';
        setError(message);
        callbacksRef.current.onError?.(message);
      });
    };

    void setup().catch(() => {
      if (!cancelled) attachNative();
    });

    return () => {
      cancelled = true;
      destroy();
    };
    // 依赖仅保留 src：回调与音量等偏好通过 ref / 独立 effect 同步
  }, [src, destroy]);

  /* -------------------------- 媒体事件绑定 -------------------------- */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      setDuration(video.duration || 0);
      if (startTimeRef.current > 0 && startTimeRef.current < (video.duration || 0) - 5) {
        video.currentTime = startTimeRef.current;
      }
      if (autoPlay) void video.play().catch(() => undefined);
    };
    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      setDuration(video.duration || 0);
      if (video.buffered.length > 0) {
        try {
          setBuffered(video.buffered.end(video.buffered.length - 1));
        } catch {
          /* buffered 可能在切换源时短暂不一致 */
        }
      }
      callbacksRef.current.onTimeUpdate?.(video.currentTime, video.duration || 0);
    };
    const handlePlay = () => {
      setError(null);
      setPlaying(true);
      setEnded(false);
    };
    const handlePause = () => setPlaying(false);
    const handleWaiting = () => setWaiting(true);
    const handlePlaying = () => setWaiting(false);
    const handleEnded = () => {
      setPlaying(false);
      setEnded(true);
      callbacksRef.current.onEnded?.();
    };
    const handleError = () => {
      const message = video.error?.code === 2 ? '视频网络请求失败，请检查连接后重试'
        : video.error?.code === 3 ? '视频解码失败，文件可能损坏或编码不受支持'
        : '视频源不可用或格式不受支持，请联系作者';
      setWaiting(false);
      setError(message);
      callbacksRef.current.onError?.(message);
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('progress', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('progress', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
    };
  }, [autoPlay]);

  const play = useCallback(async () => {
    try {
      if (videoRef.current?.error) videoRef.current.load();
      await videoRef.current?.play();
      setError(null);
    } catch (error) {
      setError(error instanceof DOMException && error.name === 'NotAllowedError'
        ? '浏览器阻止了自动播放，点击播放按钮继续'
        : '视频源不可用或格式不受支持，请联系作者');
    }
  }, []);

  const pause = useCallback(() => videoRef.current?.pause(), []);
  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    const target = Math.min(Math.max(0, time), video.duration || 0);
    video.currentTime = target;
    setCurrentTime(target);
  }, []);

  const seekBy = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      seek(video.currentTime + delta);
    },
    [seek],
  );

  const setVolume = useCallback((volume: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Math.min(1, Math.max(0, volume));
  }, []);

  const setLevel = useCallback((index: number) => {
    setCurrentLevelState(index);
    if (hlsRef.current) hlsRef.current.currentLevel = index;
  }, []);

  return {
    videoRef,
    ready,
    playing,
    waiting,
    ended,
    duration,
    currentTime,
    buffered,
    error,
    levels,
    currentLevel,
    setLevel,
    play,
    pause,
    toggle,
    seek,
    seekBy,
    setVolume,
  };
}
