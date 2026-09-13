import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getPersistBackend } from '@/lib/storage';
import { registerThemeApplier, useAuthStore } from './authStore';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  action?: { label: string; to?: string; onClick?: () => void };
  duration: number;
}

export interface ConfirmDialogState {
  open: boolean;
  title: string;
  description?: string;
  confirmText: string;
  cancelText: string;
  danger: boolean;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
}

interface UiState {
  theme: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  /** 侧边栏：展开 / 收起（桌面端）、抽屉开关（移动端） */
  sidebarCollapsed: boolean;
  mobileDrawerOpen: boolean;
  /** 播放器偏好 */
  volume: number;
  muted: boolean;
  playbackRate: number;
  /** 无障碍与体验开关 */
  reducedMotion: boolean;
  /** 算法备案要求：可关闭个性化推荐（文档 9.2 / 14.4） */
  personalizationEnabled: boolean;
  /** 青少年模式（文档 14.3） */
  teenagerMode: boolean;
  toasts: Toast[];
  confirm: ConfirmDialogState;

  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  applyTheme: () => void;
  toggleSidebar: () => void;
  setMobileDrawer: (open: boolean) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  setReducedMotion: (value: boolean) => void;
  setPersonalization: (value: boolean) => void;
  setTeenagerMode: (value: boolean) => void;
  toast: (input: Omit<Partial<Toast>, 'id'> & { title: string }) => string;
  dismissToast: (id: string) => void;
  openConfirm: (input: Omit<Partial<ConfirmDialogState>, 'open'> & { title: string }) => void;
  closeConfirm: () => void;
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(theme: ThemeMode): 'light' | 'dark' {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return theme;
}

function applyToDocument(mode: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.style.colorScheme = mode;
  root.classList.toggle('dark-safe', true);
}

let toastSeq = 0;

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      resolvedTheme: resolve('system'),
      sidebarCollapsed: false,
      mobileDrawerOpen: false,
      volume: 0.8,
      muted: false,
      playbackRate: 1,
      reducedMotion: false,
      personalizationEnabled: true,
      teenagerMode: false,
      toasts: [],
      confirm: {
        open: false,
        title: '',
        confirmText: '确认',
        cancelText: '取消',
        danger: false,
      },

      setTheme(theme) {
        const resolved = resolve(theme);
        set({ theme, resolvedTheme: resolved });
        applyToDocument(resolved);
      },

      toggleTheme() {
        const next = get().resolvedTheme === 'dark' ? 'light' : 'dark';
        get().setTheme(next);
      },

      applyTheme() {
        const resolved = resolve(get().theme);
        set({ resolvedTheme: resolved });
        applyToDocument(resolved);
      },

      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setMobileDrawer: (open) => set({ mobileDrawerOpen: open }),
      setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)), muted: volume === 0 }),
      setMuted: (muted) => set({ muted }),
      setPlaybackRate: (playbackRate) => set({ playbackRate }),
      setReducedMotion: (reducedMotion) => {
        set({ reducedMotion });
        if (typeof document !== 'undefined') {
          document.documentElement.classList.toggle('reduce-motion', reducedMotion);
        }
      },
      setPersonalization: (personalizationEnabled) => {
        set({ personalizationEnabled });
        get().toast({
          title: personalizationEnabled ? '已开启个性化推荐' : '已关闭个性化推荐',
          description: personalizationEnabled ? undefined : '首页将仅展示热门与时间线内容',
          tone: 'info',
        });
      },
      setTeenagerMode: (teenagerMode) => set({ teenagerMode }),

      toast(input) {
        const id = `t${(toastSeq += 1)}`;
        const item: Toast = {
          id,
          title: input.title,
          description: input.description,
          tone: input.tone ?? 'info',
          action: input.action,
          duration: input.duration ?? 3200,
        };
        set((state) => ({ toasts: [...state.toasts.slice(-3), item] }));
        if (item.duration > 0 && typeof window !== 'undefined') {
          window.setTimeout(() => get().dismissToast(id), item.duration);
        }
        return id;
      },

      dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

      openConfirm(input) {
        set({
          confirm: {
            open: true,
            title: input.title,
            description: input.description,
            confirmText: input.confirmText ?? '确认',
            cancelText: input.cancelText ?? '取消',
            danger: input.danger ?? false,
            onConfirm: input.onConfirm,
            onCancel: input.onCancel,
          },
        });
      },

      closeConfirm: () => set((state) => ({ confirm: { ...state.confirm, open: false } })),
    }),
    {
      name: 'vs-ui-preference',
      storage: createJSONStorage(() => getPersistBackend('local')),
      partialize: (state) =>
        ({
          theme: state.theme,
          sidebarCollapsed: state.sidebarCollapsed,
          volume: state.volume,
          muted: state.muted,
          playbackRate: state.playbackRate,
          reducedMotion: state.reducedMotion,
          personalizationEnabled: state.personalizationEnabled,
          teenagerMode: state.teenagerMode,
        }) as Partial<UiState>,
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<UiState>;
        return {
          ...current,
          theme: saved.theme ?? current.theme,
          sidebarCollapsed: saved.sidebarCollapsed ?? current.sidebarCollapsed,
          volume: saved.volume ?? current.volume,
          muted: saved.muted ?? current.muted,
          playbackRate: saved.playbackRate ?? current.playbackRate,
          reducedMotion: saved.reducedMotion ?? current.reducedMotion,
          personalizationEnabled: saved.personalizationEnabled ?? current.personalizationEnabled,
          teenagerMode: saved.teenagerMode ?? current.teenagerMode,
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.applyTheme();
      },
    },
  ),
);

// 让 authStore 启动时也能安全地应用主题
registerThemeApplier(() => useUiStore.getState().applyTheme());

// 跟随系统主题变化
if (typeof window !== 'undefined' && window.matchMedia) {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener?.('change', () => {
    if (useUiStore.getState().theme === 'system') useUiStore.getState().applyTheme();
  });
}

/** 便捷方法：登录态判断（供组件层使用，避免重复选择器） */
export const selectIsLogin = () => useAuthStore.getState().status === 'authenticated';
