import { describe, expect, it, afterEach } from 'vitest';
import {
  formatCount,
  formatDuration,
  formatDurationText,
  formatFileSize,
  formatPercent,
  formatRelative,
  formatDate,
  maskPhone,
  formatTimecode,
} from '@/lib/format';
import { storage, getPersistBackend } from '@/lib/storage';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/cn';
import { countByType, useNotificationStore } from '@/stores/notificationStore';
import { watchedPercent, usePlayerStore } from '@/stores/playerStore';
import { subscribeRanking, subscribeNotifications } from '@/api/realtime';
import type { AppNotification } from '@/api/types';

describe('格式化工具', () => {
  it('播放量按万/亿归一化', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(9_999)).toBe('9999');
    expect(formatCount(12_500)).toBe('1.3万');
    expect(formatCount(1_250_000)).toBe('125万');
    expect(formatCount(320_000_000)).toBe('3.2亿');
    expect(formatCount(null)).toBe('0');
  });

  it('时长格式化为 mm:ss 或 h:mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(3_723)).toBe('1:02:03');
    expect(formatDuration(-5)).toBe('00:00');
    expect(formatTimecode(90)).toBe('01:30');
  });

  it('时长文案使用中文单位', () => {
    expect(formatDurationText(45)).toBe('45 秒');
    expect(formatDurationText(150)).toBe('2 分 30 秒');
    expect(formatDurationText(5_400)).toBe('1 小时 30 分');
  });

  it('文件体积自适应单位', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2_048)).toBe('2.0 KB');
    expect(formatFileSize(8 * 1024 ** 3)).toBe('8.0 GB');
  });

  it('相对时间覆盖刚刚/分钟/小时/昨天/同年/跨年', () => {
    const now = Date.now();
    expect(formatRelative(new Date(now - 10_000))).toBe('刚刚');
    expect(formatRelative(new Date(now - 5 * 60_000))).toMatch(/分钟前/);
    expect(formatRelative(null)).toBe('');
    expect(formatRelative('not-a-date')).toBe('');
  });

  it('日期与百分比格式化', () => {
    expect(formatDate('2026-09-13T10:00:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(formatPercent(0.4235)).toBe('42.4%');
    expect(formatPercent(0.5, 0)).toBe('50%');
  });

  it('手机号按合规要求脱敏', () => {
    expect(maskPhone('13812341234')).toBe('138****1234');
    expect(maskPhone(null)).toBe('');
  });

  it('cn 合并冲突的 Tailwind 类名', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    const isHidden = false;
    expect(cn('text-fg', isHidden && 'hidden', 'mt-2')).toBe('text-fg mt-2');
  });
});

describe('本地存储（仅允许非敏感偏好）', () => {
  afterEach(() => localStorage.clear());

  it('读写与移除键值并带命名空间前缀', () => {
    storage.set('demo', { a: 1 });
    expect(localStorage.getItem('vs-demo')).toBe('{"a":1}');
    expect(storage.get('demo', { a: 0 })).toEqual({ a: 1 });
    storage.remove('demo');
    expect(storage.get('demo', { a: 0 })).toEqual({ a: 0 });
  });

  it('内容损坏时回退默认值而不抛错', () => {
    localStorage.setItem('vs-broken', '{not json');
    expect(storage.get('broken', 'fallback')).toBe('fallback');
  });

  it('persist 后端提供 StateStorage 接口', () => {
    const backend = getPersistBackend('local');
    backend.setItem('k', 'v');
    expect(backend.getItem('k')).toBe('v');
    backend.removeItem('k');
    expect(backend.getItem('k')).toBeNull();
  });
});

describe('Query key 规范（文档 5.4）', () => {
  it('视频相关 key 结构稳定', () => {
    expect(queryKeys.videos.detail(1001)).toEqual(['videos', 'detail', 1001]);
    expect(queryKeys.videos.related(1001)).toEqual(['videos', 'related', 1001]);
    expect(queryKeys.videos.ranking({ type: 'hot', period: 'daily' })).toEqual([
      'videos',
      'ranking',
      { type: 'hot', period: 'daily' },
    ]);
  });

  it('评论与动态 key 带分页参数', () => {
    expect(queryKeys.comments.list(1001, { sort: 'hot', page: 1 })).toEqual([
      'comments',
      1001,
      { sort: 'hot', page: 1 },
    ]);
    expect(queryKeys.feeds.list({ type: 'following' })).toEqual(['feed', 'following', { cursor: null, topicId: undefined }]);
  });

  it('用户与管理后台 key 可区分查询条件', () => {
    expect(queryKeys.user.videos(3, 2)).toEqual(['user', 3, 'videos', { page: 2 }]);
    expect(queryKeys.admin.reviews({ status: 'PENDING', page: 1 })).toEqual([
      'admin',
      'reviews',
      { status: 'PENDING', page: 1 },
    ]);
  });
});

describe('通知 store', () => {
  const makeNotification = (id: number, isRead = false): AppNotification => ({
    id,
    type: 'LIKE',
    title: '收到新的点赞',
    content: '赞了你的视频',
    actor: null,
    targetType: 'VIDEO',
    targetId: 1001,
    isRead,
    createdAt: new Date().toISOString(),
  });

  it('实时推送累加未读数并保留最新一条', () => {
    useNotificationStore.setState({ items: [], unreadCount: 0, latest: null });
    useNotificationStore.getState().push(makeNotification(1));
    useNotificationStore.getState().push(makeNotification(2));
    expect(useNotificationStore.getState().unreadCount).toBe(2);
    expect(useNotificationStore.getState().latest?.id).toBe(2);
    expect(useNotificationStore.getState().items[0].id).toBe(2);
  });

  it('已读标记按 id 精确扣减未读数', () => {
    useNotificationStore.setState({ items: [makeNotification(1), makeNotification(2), makeNotification(3)], unreadCount: 3 });
    useNotificationStore.getState().markRead([1, 3]);
    expect(useNotificationStore.getState().unreadCount).toBe(1);
    expect(useNotificationStore.getState().items.filter((n) => !n.isRead)).toHaveLength(1);
  });

  it('不传 id 时全部标记已读', () => {
    useNotificationStore.setState({ items: [makeNotification(1), makeNotification(2)], unreadCount: 2 });
    useNotificationStore.getState().markRead();
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });

  it('按类型分组统计', () => {
    const items = [makeNotification(1), { ...makeNotification(2), type: 'FOLLOW' as const }];
    const counts = countByType(items);
    expect(counts.ALL).toBe(2);
    expect(counts.LIKE).toBe(1);
    expect(counts.FOLLOW).toBe(1);
    expect(counts.SYSTEM).toBe(0);
  });
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('实时层降级（文档 15.2 降级矩阵）', () => {
  /*
   * 使用真实计时器：Mock 载荷改为按需动态 import（生产构建会整块摇掉），
   * 该 import 的解析依赖宏任务，fake timers 会把它一并冻结。
   */
  it('Mock 模式下榜单订阅以轮询兜底并立即推送一次', async () => {
    const received: string[] = [];
    const handle = subscribeRanking('hot', (payload) => received.push(payload.type), { pollIntervalMs: 60 });
    await wait(25);
    expect(received.length).toBe(1);
    await wait(150);
    expect(received.length).toBeGreaterThanOrEqual(3);
    handle.close();
    const before = received.length;
    await wait(150);
    expect(received.length).toBe(before);
  });

  it('Mock 模式下通知订阅进入 degraded 状态且可关闭', () => {
    const statuses: string[] = [];
    const handle = subscribeNotifications({
      onNotification: () => undefined,
      onStatus: (status) => statuses.push(status),
    });
    expect(statuses).toContain('degraded');
    handle.close();
  });
});

describe('播放进度百分比', () => {
  it('根据记忆进度计算百分比并做上限保护', () => {
    usePlayerStore.setState({ memory: {} });
    usePlayerStore.getState().recordProgress(88_001, 150, 600, { force: true });
    expect(watchedPercent(88_001, 600)).toBe(25);
    expect(watchedPercent(88_001, 0)).toBe(0);
    usePlayerStore.getState().recordProgress(88_002, 900, 600, { force: true });
    expect(watchedPercent(88_002, 600)).toBe(100);
  });
});
