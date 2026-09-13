import { create } from 'zustand';
import type { AppNotification, NotificationType } from '@/api/types';

interface NotificationState {
  items: AppNotification[];
  unreadCount: number;
  realtimeStatus: 'connecting' | 'online' | 'offline' | 'degraded';
  /** 新到达的实时消息（用于顶部 Toast 提示 + 未读红点弹跳） */
  latest: AppNotification | null;

  setItems: (items: AppNotification[]) => void;
  push: (item: AppNotification) => void;
  setUnread: (count: number) => void;
  markRead: (ids?: number[]) => void;
  setStatus: (status: NotificationState['realtimeStatus']) => void;
  clearLatest: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  items: [],
  unreadCount: 0,
  realtimeStatus: 'connecting',
  latest: null,

  setItems: (items) => set({ items }),
  push: (item) =>
    set((state) => ({
      items: [item, ...state.items].slice(0, 200),
      unreadCount: state.unreadCount + (item.isRead ? 0 : 1),
      latest: item,
    })),
  setUnread: (unreadCount) => set({ unreadCount }),
  markRead: (ids) =>
    set((state) => {
      const target = ids && ids.length > 0 ? new Set(ids) : null;
      const items = state.items.map((item) =>
        !target || target.has(item.id) ? { ...item, isRead: true } : item,
      );
      return { items, unreadCount: target ? Math.max(0, state.unreadCount - target.size) : 0 };
    }),
  setStatus: (realtimeStatus) => set({ realtimeStatus }),
  clearLatest: () => set({ latest: null }),
}));

/** 按类型分组统计（通知中心 Tab 使用） */
export function countByType(items: AppNotification[]): Record<NotificationType | 'ALL', number> {
  const base = {
    ALL: items.length,
    LIKE: 0,
    COMMENT: 0,
    REPLY: 0,
    FOLLOW: 0,
    FAVORITE: 0,
    SYSTEM: 0,
    REVIEW: 0,
    SUBSCRIPTION: 0,
  } satisfies Record<NotificationType | 'ALL', number>;
  for (const item of items) base[item.type] += 1;
  return base;
}
