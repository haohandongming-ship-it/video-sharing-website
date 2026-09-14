/**
 * 实时通信层（文档 5.1 / 9.2）
 *
 * - 互动类通知：STOMP over WebSocket（双向）
 * - 榜单变化：SSE（单向，成本更低）
 *
 * 后端不可用（USE_MOCK）或连接失败时自动降级为轮询，
 * 满足文档 15.2「SSE/WS 不可用 → 前端自动降级为轮询」的降级矩阵。
 *
 * 打包约定：Mock 适配层只在 `VITE_USE_MOCK=true` 的构建里被引用。
 * `USE_MOCK` 是构建期常量，生产构建下这两个 `import('@/mocks')` 会被整体摇掉，
 * 因此 Mock 种子数据不会进入生产产物；降级轮询改为请求真实接口。
 */
import { Client, type IMessage } from '@stomp/stompjs';
import { SSE_URL, USE_MOCK, WS_URL } from '@/api/config';
import { authBridge } from '@/api/authBridge';
import { notificationApi } from '@/api/uploads';
import { videoApi } from '@/api/videos';
import type { AppNotification, RankingQuery, SseRankingPayload } from '@/api/types';

export type RealtimeStatus = 'connecting' | 'online' | 'offline' | 'degraded';

const NOTIFICATION_POLL_MS = 45_000;
const RANKING_PERIODS = ['daily', 'weekly', 'monthly', 'all'] as const;
type RankingPeriod = (typeof RANKING_PERIODS)[number];

interface NotificationChannelOptions {
  onNotification: (payload: AppNotification) => void;
  onStatus?: (status: RealtimeStatus) => void;
}

export interface RealtimeHandle {
  close: () => void;
}

/* ------------------------------------------------------------------ 降级数据源 */

/** Mock 模式：本地模拟一条通知。仅存在于 VITE_USE_MOCK=true 的构建。 */
async function mockNotification(): Promise<AppNotification> {
  const { mockPushNotification } = await import('@/mocks');
  return mockPushNotification();
}

/** Mock 模式：本地模拟一份榜单推送。仅存在于 VITE_USE_MOCK=true 的构建。 */
async function mockRanking(type: 'hot' | 'trend', period: string): Promise<SseRankingPayload> {
  const { mockRankingSsePayload } = await import('@/mocks');
  return mockRankingSsePayload(type, period) as SseRankingPayload;
}

function toRankingPeriod(period: string): RankingPeriod {
  return (RANKING_PERIODS as readonly string[]).includes(period) ? (period as RankingPeriod) : 'daily';
}

/** 真实降级：轮询排行榜接口，映射成与 SSE 相同的事件载荷。 */
async function fetchRanking(type: 'hot' | 'trend', period: string): Promise<SseRankingPayload> {
  const items = await videoApi.ranking({ type, period: toRankingPeriod(period) } as RankingQuery);
  return {
    type,
    period,
    updatedAt: new Date().toISOString(),
    items: items.map((item) => ({
      rank: item.rank,
      videoId: item.video.id,
      title: item.video.title,
      score: item.score,
      delta: item.delta,
    })),
  };
}

/**
 * 真实降级：轮询通知接口。
 *
 * 首次成功轮询只记录水位线（当前最大通知 id），不补发历史通知，避免登录瞬间弹出一堆提醒；
 * 之后只推送 id 大于水位线的新通知，天然去重。
 */
function createNotificationPoller(
  onNotification: (payload: AppNotification) => void,
  isClosed: () => boolean,
  onError: () => void,
) {
  let watermark: number | null = null;
  return async () => {
    if (isClosed()) return;
    try {
      const page = await notificationApi.list({ page: 1, pageSize: 10 });
      const items = page.items ?? [];
      if (watermark === null) {
        watermark = items.reduce((max, item) => Math.max(max, item.id), 0);
        return;
      }
      const fresh = items.filter((item) => item.id > (watermark as number)).sort((a, b) => a.id - b.id);
      if (fresh.length > 0) watermark = fresh[fresh.length - 1].id;
      fresh.forEach(onNotification);
    } catch {
      onError();
    }
  };
}

/* ------------------------------------------------------------------ 通知通道 */

/** 互动通知订阅：STOMP，失败降级为轮询 */
export function subscribeNotifications(options: NotificationChannelOptions): RealtimeHandle {
  const { onNotification, onStatus } = options;
  let closed = false;
  let poller: number | null = null;
  let client: Client | null = null;

  const mockEmit = async () => {
    const payload = await mockNotification();
    if (!closed) onNotification(payload);
  };
  const realEmit = createNotificationPoller(onNotification, () => closed, () => onStatus?.('connecting'));

  const startPoller = () => {
    if (poller !== null || closed) return;
    onStatus?.('degraded');
    // USE_MOCK 是构建期常量：生产构建下三元表达式会被折叠，Mock 分支整体消失。
    const emit = USE_MOCK ? mockEmit : realEmit;
    void emit();
    poller = window.setInterval(() => void emit(), NOTIFICATION_POLL_MS);
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
      brokerURL: WS_URL,
      connectHeaders: authBridge.getToken()
        ? { Authorization: `Bearer ${authBridge.getToken()}` }
        : {},
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

/* ------------------------------------------------------------------ 榜单通道 */

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
    const emit = async () => {
      if (closed) return;
      try {
        const payload = USE_MOCK ? await mockRanking(type, period) : await fetchRanking(type, period);
        if (!closed) onMessage(payload);
      } catch {
        /* 单次失败保留上一次快照，等下一次重试 */
      }
    };
    void emit();
    poller = window.setInterval(() => void emit(), pollIntervalMs);
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
