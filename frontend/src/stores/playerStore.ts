import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getPersistBackend, storage } from '@/lib/storage';
import { PROGRESS_REPORT_INTERVAL } from '@/lib/constants';
import type { Quality, VideoSummary } from '@/api/types';

export interface PlayerSnapshot {
  videoId: number;
  progress: number;
  duration: number;
  updatedAt: number;
}

interface PlayerState {
  /** 当前播放的视频（长视频页 / 短视频流共享） */
  current: VideoSummary | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  buffered: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  quality: Quality | null;
  /** 自动连播（长视频页） */
  autoplayNext: boolean;
  theaterMode: boolean;
  /** 记忆播放：videoId → 进度 */
  memory: Record<number, PlayerSnapshot>;

  setCurrent: (video: VideoSummary | null) => void;
  setPlaying: (playing: boolean) => void;
  setTime: (currentTime: number, duration?: number, buffered?: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  /** null = 自动（ABR）；与设置页「默认清晰度」共用同一字段 */
  setQuality: (quality: Quality | null) => void;
  setAutoplayNext: (value: boolean) => void;
  setTheaterMode: (value: boolean) => void;
  /** 记录并（节流）上报播放进度，文档 5.6：每 15s + 离开页面上报 */
  recordProgress: (videoId: number, progress: number, duration: number, options?: { force?: boolean }) => boolean;
  getMemory: (videoId: number) => PlayerSnapshot | null;
  clearMemory: (videoId?: number) => void;
}

/** 上次上报时间（内存态，避免持久化噪音） */
const lastReportAt = new Map<number, number>();

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      current: null,
      playing: false,
      currentTime: 0,
      duration: 0,
      buffered: 0,
      volume: 0.8,
      muted: false,
      playbackRate: 1,
      quality: null,
      autoplayNext: true,
      theaterMode: false,
      memory: {},

      setCurrent: (current) => set({ current, currentTime: 0, duration: 0, buffered: 0 }),
      setPlaying: (playing) => set({ playing }),
      setTime: (currentTime, duration, buffered) =>
        set((state) => ({
          currentTime,
          duration: duration ?? state.duration,
          buffered: buffered ?? state.buffered,
        })),
      setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)), muted: volume === 0 }),
      setMuted: (muted) => set({ muted }),
      setPlaybackRate: (playbackRate) => set({ playbackRate }),
      setQuality: (quality) => set({ quality }),
      setAutoplayNext: (autoplayNext) => set({ autoplayNext }),
      setTheaterMode: (theaterMode) => set({ theaterMode }),

      recordProgress(videoId, progress, duration, options) {
        const snapshot: PlayerSnapshot = { videoId, progress, duration, updatedAt: Date.now() };
        set((state) => ({ memory: { ...state.memory, [videoId]: snapshot } }));
        const last = lastReportAt.get(videoId) ?? 0;
        const due = Date.now() - last >= PROGRESS_REPORT_INTERVAL;
        if (options?.force || due) {
          lastReportAt.set(videoId, Date.now());
          storage.set(`progress:${videoId}`, snapshot);
          return true;
        }
        return false;
      },

      getMemory(videoId) {
        const fromState = get().memory[videoId];
        if (fromState) return fromState;
        return storage.get<PlayerSnapshot | null>(`progress:${videoId}`, null);
      },

      clearMemory(videoId) {
        if (videoId === undefined) {
          set({ memory: {} });
          return;
        }
        set((state) => {
          const next = { ...state.memory };
          delete next[videoId];
          return { memory: next };
        });
        storage.remove(`progress:${videoId}`);
      },
    }),
    {
      name: 'vs-player-preference',
      storage: createJSONStorage(() => getPersistBackend('local')),
      // 只落盘偏好类状态，避免把播放中的瞬时状态写入存储
      partialize: (state) =>
        ({
          volume: state.volume,
          muted: state.muted,
          playbackRate: state.playbackRate,
          quality: state.quality,
          autoplayNext: state.autoplayNext,
          memory: state.memory,
        }) as Partial<PlayerState>,
      // 仅回填偏好类状态（音量/倍速/连播/记忆进度），播放中的瞬时状态不入库
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<PlayerState>;
        return {
          ...current,
          volume: saved.volume ?? current.volume,
          muted: saved.muted ?? current.muted,
          playbackRate: saved.playbackRate ?? current.playbackRate,
          quality: saved.quality ?? current.quality,
          autoplayNext: saved.autoplayNext ?? current.autoplayNext,
          memory: saved.memory ?? current.memory,
        };
      },
    },
  ),
);

/** 组件层便捷读取：上次播放进度百分比 */
export function watchedPercent(videoId: number, duration: number): number {
  const snapshot = usePlayerStore.getState().getMemory(videoId);
  if (!snapshot || duration <= 0) return 0;
  return Math.min(100, Math.round((snapshot.progress / duration) * 100));
}
