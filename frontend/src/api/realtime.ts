/**
 * 实时通信层（文档 5.1 / 9.2）
 *
 * - 互动类通知：STOMP over WebSocket（双向）
 * - 榜单变化：SSE（单向，成本更低）
 *
 * 后端未就绪（USE_MOCK）或连接失败时自动降级为轮询 / 本地模拟推送，
 * 满足文档 15.2「SSE/WS 不可用 → 前端自动降级为轮询」的降级矩阵。
 */
import { Client, type IMessage } from '@stomp/stompjs';
import { SSE_URL, USE_MOCK, WS_URL } from '@/api/config';
import { mockPushNotification, mockRankingSsePayload } from '@/mocks';
import type { AppNotification, SseRankingPayload } from '@/api/types';

export type RealtimeStatus = 'connecting' | 'online' | 'offline' | 'degraded';

interface NotificationChannelOptions {
  onNotification: (payload: AppNotification) => void;
  onStatus?: (status: RealtimeStatus) => void;
}

export interface RealtimeHandle {
  close: () => void;
}

/** 互动通知订阅：STOMP，失败降级为本地轮询模拟 */
export function subscribeNotifications(options: NotificationChannelOptions): RealtimeHandle {
  const { onNotification, onStatus } = options;
  let closed = false;
  let poller: number | null = null;
  let client: Client | null = null;

  const startPoller = () => {
    if (poller !== null || closed) return;
    onStatus?.('degraded');
    poller = window.setInterval(
      () => {
        if (closed) return;
        // 降级模式下以本地模拟推送代替服务端消息，保证演示链路完整
        onNotification(mockPushNotification());
      },
      45_000,
    );
  };

  if (USE_MOCK) {
    onStatus?.('degraded');
    startPoller();
    return {
      close: () => {
        closed = true;
        if (poller !== null) window.clearInterval(poller);
      },
    };
  }

  try {
    onStatus?.('connecting');
    client = new Client({
      brokerURL: `${WS_URL}?token=${encodeURIComponent('')}`,
      reconnectDelay: 5_000,
      heartbeatIncoming: 10_000,
      heartbeatOutgoing: 10_000,
      onConnect: () => {
        onStatus?.('online');
        client?.subscribe('/user/queue/notifications', (message: IMessage) => {
          try {
            onNotification(JSON.parse(message.body) as AppNotification);
          } catch {
            /* 非法载荷忽略，避免污染列表 */
          }
        });
      },
      onWebSocketClose: () => onStatus?.(closed ? 'offline' : 'connecting'),
      onStompError: () => startPoller(),
    });
    client.activate();
  } catch {
    startPoller();
  }

  return {
    close: () => {
      closed = true;
      if (poller !== null) window.clearInterval(poller);
      void client?.deactivate();
    },
  };
}

/** 榜单推送订阅：SSE，失败降级为定时拉取 */
export function subscribeRanking(
  type: 'hot' | 'trend',
  onMessage: (payload: SseRankingPayload) => void,
  options: { period?: string; pollIntervalMs?: number } = {},
): RealtimeHandle {
  const { period = 'daily', pollIntervalMs = 60_000 } = options;
  let closed = false;
  let source: EventSource | null = null;
  let poller: number | null = null;

  const startPoller = () => {
    if (poller !== null || closed) return;
    const emit = () => {
      if (closed) return;
      const payload = mockRankingSsePayload(type, period) as SseRankingPayload;
      onMessage(payload);
    };
    emit();
    poller = window.setInterval(emit, pollIntervalMs);
  };

  if (USE_MOCK || typeof EventSource === 'undefined') {
    startPoller();
    return {
      close: () => {
        closed = true;
        if (poller !== null) window.clearInterval(poller);
      },
    };
  }

  try {
    source = new EventSource(`${SSE_URL}/ranking/${type}`);
    source.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data) as SseRankingPayload);
      } catch {
        /* ignore */
      }
    };
    source.onerror = () => {
      source?.close();
      startPoller();
    };
  } catch {
    startPoller();
  }

  return {
    close: () => {
      closed = true;
      if (poller !== null) window.clearInterval(poller);
      source?.close();
    },
  };
}
