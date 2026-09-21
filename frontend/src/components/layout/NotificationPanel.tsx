import { useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Circle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';
import { NOTIFICATION_TYPE_LABELS } from '@/lib/constants';
import { useNotificationStore } from '@/stores/notificationStore';
import { useMarkNotificationsRead, useNotifications } from '@/hooks/useApi';
import { Avatar, Badge, Button, EmptyState, ListSkeleton } from '@/components/ui';

/** 顶部通知面板：下拉浮层，支持全部已读与跳转（文档 3.1 通知） */
export function NotificationPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { data, isLoading } = useNotifications({ page: 1, pageSize: 8 });
  const markRead = useMarkNotificationsRead();
  const storeItems = useNotificationStore((s) => s.items);
  const unread = useNotificationStore((s) => s.unreadCount);
  const setUnread = useNotificationStore((s) => s.setUnread);
  const markStoreRead = useNotificationStore((s) => s.markRead);
  const realtimeStatus = useNotificationStore((s) => s.realtimeStatus);

  /*
   * 服务端列表是事实来源；实时推送来的通知可能还没被下一次拉取覆盖，按 id 去重后置于最前。
   * 此前是「本地有内容就整块用本地」，导致收到一条推送之后，服务端的分页与已读状态
   * 就再也不会生效（面板永久显示那份本地快照）。
   */
  const items = useMemo(() => {
    const server = data?.items ?? [];
    const seen = new Set(server.map((item) => item.id));
    const fresh = storeItems.filter((item) => !seen.has(item.id));
    return [...fresh, ...server].slice(0, 8);
  }, [data?.items, storeItems]);

  useEffect(() => {
    if (data?.unreadCount !== undefined && storeItems.length === 0) setUnread(data.unreadCount);
  }, [data?.unreadCount, setUnread, storeItems.length]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const esc = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', esc);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="通知"
      className="absolute top-[calc(100%+8px)] right-0 z-80 w-[min(92vw,380px)] overflow-hidden rounded-card border border-line bg-surface shadow-pop"
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-fg">通知</h2>
          {unread > 0 && <Badge tone="brand">{unread} 条未读</Badge>}
        </div>
        <Button
          size="xs"
          variant="ghost"
          icon={<CheckCheck className="size-3.5" />}
          disabled={unread === 0}
          onClick={() => {
            markRead.mutate([]);
            markStoreRead();
          }}
        >
          全部已读
        </Button>
      </header>

      <div className="max-h-[420px] overflow-y-auto">
        {isLoading && storeItems.length === 0 ? (
          <div className="p-3">
            <ListSkeleton rows={4} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState compact title="暂无通知" description="互动消息、审核结果都会出现在这里。" icon={<Bell className="size-5" />} />
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    markRead.mutate([item.id]);
                    markStoreRead([item.id]);
                    if (item.targetType === 'VIDEO' && item.targetId) navigate(`/video/${item.targetId}`);
                    else if (item.targetType === 'USER' && item.targetId) navigate(`/user/${item.targetId}`);
                    else if (item.targetType === 'FEED' && item.targetId) navigate(`/feed/${item.targetId}`);
                    onClose();
                  }}
                  className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                >
                  {item.actor ? (
                    <Avatar src={item.actor.avatar} name={item.actor.nickname} size="sm" />
                  ) : (
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                      <Bell className="size-4" aria-hidden />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-fg">{item.title}</span>
                      {!item.isRead && <Circle className="size-1.5 shrink-0 fill-current text-brand" aria-label="未读" />}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-fg-muted">
                      {item.actor ? `${item.actor.nickname}：` : ''}
                      {item.content}
                    </span>
                    <span className="mt-1 block text-[11px] text-fg-subtle">
                      {NOTIFICATION_TYPE_LABELS[item.type]} · {formatRelative(item.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
          <span
            className={cn(
              'size-1.5 rounded-full',
              realtimeStatus === 'online'
                ? 'bg-success'
                : realtimeStatus === 'connecting'
                  ? 'animate-pulse-dot bg-warning'
                  : 'bg-fg-subtle',
            )}
            aria-hidden
          />
          {realtimeStatus === 'online'
            ? '实时推送已连接'
            : realtimeStatus === 'connecting'
              ? '正在建立实时连接'
              : '实时推送不可用，已降级为轮询'}
        </span>
        <Link
          to="/messages?tab=notification"
          onClick={onClose}
          className="text-xs font-medium text-accent hover:underline"
        >
          查看全部
        </Link>
      </footer>
    </div>
  );
}
