import { useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { queryClient } from './queryClient';
import { ErrorBoundary } from './ErrorBoundary';
import { ConfirmDialog, Toaster } from '@/components/ui';
import { OfflineBanner } from '@/components/ui/States';
import { useAuthStore, useNotificationStore, useUiStore } from '@/stores';
import { subscribeNotifications } from '@/api/realtime';

/** 网络状态监听：离线时顶部细条提示（文档 12.2） */
function NetworkWatcher() {
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' ? !navigator.onLine : false);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return <OfflineBanner visible={offline} />;
}

/**
 * 实时通知订阅：登录后建立 STOMP 连接，后端不可用时降级为轮询（文档 15.2）。
 * 新消息同时写入 notificationStore 与 Toast，未读数红点即时更新。
 */
function RealtimeBridge() {
  const status = useAuthStore((s) => s.status);
  const push = useNotificationStore((s) => s.push);
  const setStatus = useNotificationStore((s) => s.setStatus);
  const toast = useUiStore((s) => s.toast);
  const handleRef = useRef<{ close: () => void } | null>(null);

  useEffect(() => {
    if (status !== 'authenticated') {
      handleRef.current?.close();
      handleRef.current = null;
      setStatus('offline');
      return;
    }
    handleRef.current = subscribeNotifications({
      onStatus: setStatus,
      onNotification: (payload) => {
        push(payload);
        toast({
          title: payload.title,
          description: payload.actor ? `${payload.actor.nickname} · ${payload.content}` : payload.content,
          tone: 'info',
        });
      },
    });
    return () => {
      handleRef.current?.close();
      handleRef.current = null;
    };
  }, [status, push, setStatus, toast]);

  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <NetworkWatcher />
          <RealtimeBridge />
          {children}
          <Toaster />
          <ConfirmDialog />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
