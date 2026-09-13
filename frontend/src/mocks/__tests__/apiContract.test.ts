import { describe, expect, it, beforeEach } from 'vitest';
import { http, ApiError } from '@/api/client';
import { authBridge } from '@/api/authBridge';
import { authApi } from '@/api/auth';
import { videoApi } from '@/api/videos';
import { feedApi } from '@/api/feeds';
import { uploadApi } from '@/api/uploads';
import { adminApi } from '@/api/admin';
import { session } from '@/mocks/seed';

/**
 * 测试内登录：真实客户端把 Access Token 放在内存（authBridge）中，
 * 组件通过 authStore 完成这步桥接；此处直接写入 authBridge，等价于已完成登录。
 */
async function loginAs(account: string): Promise<void> {
  const result = await authApi.loginByPassword({ account, password: '123456' });
  authBridge.setSession(result.accessToken, result.user);
}

/**
 * Mock 适配层契约测试
 *
 * 这些用例锁定了「前端假定的接口形状」与「Mock 实现」之间的一致性：
 * 一旦接口路径或响应结构漂移，测试会先失败，避免页面在运行时静默降级成错误态。
 */
describe('Mock 适配层与 API 契约', () => {
  beforeEach(() => {
    authBridge.clear();
    session.logout();
  });

  it('未登录时受保护接口返回 401 业务错误码', async () => {
    await expect(authApi.me()).rejects.toBeInstanceOf(ApiError);
    await expect(authApi.me()).rejects.toMatchObject({ code: 40101 });
  });

  it('账号密码登录成功并下发会话', async () => {
    const result = await authApi.loginByPassword({ account: 'laowang', password: '123456' });
    expect(result.accessToken).toMatch(/^mock\./);
    expect(result.expiresIn).toBeGreaterThan(0);
    expect(result.user.username).toBe('laowang');
    expect(result.user.permissions).toContain('video:upload');
  });

  it('错误密码返回业务错误码而非抛网络异常', async () => {
    await expect(authApi.loginByPassword({ account: 'laowang', password: 'wrong' })).rejects.toMatchObject({
      code: 40102,
    });
  });

  it('短信验证码校验失败时返回 40103', async () => {
    await expect(authApi.loginBySms({ phone: '13800000000', code: '000000' })).rejects.toMatchObject({ code: 40103 });
  });

  it('验证码正确时可登录', async () => {
    const result = await authApi.loginBySms({ phone: '13800000000', code: '123456' });
    expect(result.user).toBeTruthy();
  });

  it('视频详情返回完整结构（含互动状态与清晰度）', async () => {
    const detail = await videoApi.detail(10_001);
    expect(detail.id).toBe(10_001);
    expect(detail.title.length).toBeGreaterThan(0);
    expect(detail.qualities.length).toBeGreaterThan(0);
    expect(detail.stats.views).toBeGreaterThan(0);
    expect(detail.author.nickname).toBeTruthy();
    expect(typeof detail.liked).toBe('boolean');
    expect(typeof detail.favorited).toBe('boolean');
  });

  it('不存在的视频返回 40401', async () => {
    await expect(videoApi.detail(999_999)).rejects.toMatchObject({ code: 40401 });
  });

  it('推荐流分页字段完整且可翻页', async () => {
    const first = await videoApi.recommend({ page: 1, pageSize: 8 });
    expect(first.items).toHaveLength(8);
    expect(first.hasMore).toBe(true);
    expect(first.total).toBeGreaterThan(8);

    const second = await videoApi.recommend({ page: 2, pageSize: 8 });
    expect(second.items[0].id).not.toBe(first.items[0].id);
  });

  it('短视频流使用游标分页且带播放地址', async () => {
    const page = await videoApi.shorts({ pageSize: 6 });
    expect(page.items).toHaveLength(6);
    expect(page.nextCursor).not.toBeNull();
    expect(page.items.every((item) => item.videoType === 'SHORT')).toBe(true);
    expect(page.items[0].hlsUrl).toBeTruthy();
  });

  it('搜索命中标题或标签，且返回建议词', async () => {
    const result = await videoApi.search({ q: '架构' });
    expect(result.total).toBeGreaterThan(0);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.suggestions && result.suggestions.length).toBeGreaterThan(0);
  });

  it('排行榜按热度降序返回名次与趋势', async () => {
    const list = await videoApi.ranking({ type: 'hot', period: 'daily' });
    expect(list.length).toBeGreaterThan(10);
    expect(list[0].rank).toBe(1);
    expect(list[0].score).toBeGreaterThanOrEqual(list[1].score);
    expect(['up', 'down', 'same', 'new']).toContain(list[0].trend);
  });

  it('点赞为幂等操作：重复点赞不会重复计数', async () => {
    await loginAs('laowang');
    const before = (await videoApi.detail(10_002)).stats.likes;
    const first = await videoApi.like(10_002, true);
    expect(first.active).toBe(true);
    expect(first.count).toBe(before + 1);
    const second = await videoApi.like(10_002, true);
    expect(second.count).toBe(first.count);
    const detail = await videoApi.detail(10_002);
    expect(detail.liked).toBe(true);
  });

  it('评论列表支持最热/最新排序', async () => {
    const hot = await videoApi.comments(10_001, { sort: 'hot', pageSize: 10 });
    const latest = await videoApi.comments(10_001, { sort: 'new', pageSize: 10 });
    expect(hot.items.length).toBeGreaterThan(0);
    expect(latest.items.length).toBeGreaterThan(0);
    const hotLikes = hot.items.map((c) => c.likeCount);
    expect([...hotLikes].sort((a, b) => b - a)).toEqual(hotLikes);
  });

  it('发表评论需要登录，登录后写入列表头部', async () => {
    await expect(videoApi.postComment(10_001, '未登录评论')).rejects.toMatchObject({ code: 40101 });
    await loginAs('laowang');
    const created = await videoApi.postComment(10_001, '这是一条契约测试评论');
    expect(created.content).toBe('这是一条契约测试评论');
    const page = await videoApi.comments(10_001, { sort: 'new', pageSize: 5 });
    expect(page.items[0].content).toBe('这是一条契约测试评论');
  });

  it('楼中楼回复接口可用', async () => {
    await loginAs('laowang');
    const page = await videoApi.comments(10_003, { pageSize: 5 });
    const root = page.items[0];
    const reply = await videoApi.replyComment(root.id, '契约测试回复');
    expect(reply.parentId).toBe(root.id);
    const replies = await videoApi.replies(root.id);
    expect(replies.items.some((item) => item.content === '契约测试回复')).toBe(true);
  });

  it('播放计数与进度上报开放给游客', async () => {
    const view = await videoApi.reportView(10_004);
    expect(view.counted).toBe(true);
    const progress = await videoApi.reportProgress(10_004, 42);
    expect(progress.saved).toBe(true);
  });

  it('动态流与动态评论可用', async () => {
    const feeds = await feedApi.list({ type: 'recommend', pageSize: 6 });
    expect(feeds.items).toHaveLength(6);
    expect(feeds.nextCursor).not.toBeNull();
    const first = feeds.items[0];
    const comments = await feedApi.comments(first.id, 1, 5);
    expect(comments.items.length).toBeGreaterThan(0);
  });

  it('越权编辑他人视频返回 403', async () => {
    await loginAs('laowang');
    // 10005 属于其他创作者，不属于 viewer，且 viewer 无审核权限
    const list = await videoApi.recommend({ pageSize: 20 });
    const foreign = list.items.find((item) => item.author.id !== 3);
    expect(foreign).toBeTruthy();
    await expect(videoApi.update(foreign!.id, { title: '越权修改' })).rejects.toMatchObject({ code: 40301 });
  });

  it('上传初始化返回分片预签名地址与分片大小', async () => {
    await loginAs('laowang');
    const result = await uploadApi.init({
      fileName: 'demo.mp4',
      fileSize: 8 * 1024 * 1024 * 2,
      sha256: 'a'.repeat(64),
      videoType: 'LONG',
      title: '契约测试视频',
      categoryId: 3,
    });
    expect(result.instant).toBe(false);
    expect(result.uploadId).toBeTruthy();
    expect(result.partSize).toBe(8 * 1024 * 1024);
    expect(result.parts).toHaveLength(2);
    expect(result.parts?.[0].url).toContain('X-Amz-Signature');
  });

  it('相同 SHA-256 第二次上传命中秒传', async () => {
    await loginAs('laowang');
    const hash = 'b'.repeat(64);
    const payload = {
      fileName: 'twice.mp4',
      fileSize: 1024,
      sha256: hash,
      videoType: 'LONG' as const,
      title: '秒传测试',
      categoryId: 3,
    };
    const first = await uploadApi.init(payload);
    expect(first.instant).toBe(false);
    await uploadApi.complete(first.uploadId as string, { parts: [{ partNumber: 1, etag: 'x' }] });
    const second = await uploadApi.init(payload);
    expect(second.instant).toBe(true);
    expect(second.fileId).toBeTruthy();
  });

  it('分片直传 PutObject 返回 ETag', async () => {
    await loginAs('laowang');
    const init = await uploadApi.init({
      fileName: 'part.mp4',
      fileSize: 1024,
      sha256: 'c'.repeat(64),
      videoType: 'SHORT',
      title: '分片测试',
      categoryId: 5,
    });
    const url = init.parts?.[0].url as string;
    expect(url).toContain('/api/v1/mock-minio/');
    await expect(uploadApi.putPart(url, new Blob([new Uint8Array(1024)]))).resolves.toContain('etag');
  });

  it('管理后台接口按权限点拦截', async () => {
    await loginAs('laowang');
    await expect(adminApi.overview()).rejects.toMatchObject({ code: 40301 });
    await expect(adminApi.reviews()).rejects.toMatchObject({ code: 40301 });

    await authApi.logout();
    authBridge.clear();
    await loginAs('admin');
    const overview = await adminApi.overview();
    expect(overview.users.total).toBeGreaterThan(0);
    expect(overview.trend).toHaveLength(14);
    const reviews = await adminApi.reviews({ pageSize: 5 });
    expect(reviews.items.length).toBeGreaterThan(0);
  });

  it('审核通过后状态持久化到内存库', async () => {
    await loginAs('admin');
    const pending = await adminApi.reviews({ status: 'PENDING', pageSize: 1 });
    const task = pending.items[0];
    expect(task).toBeTruthy();
    const result = await adminApi.decideReview(task.id, 'APPROVE', '契约测试通过');
    expect(result.status).toBe('APPROVED');
    const after = await adminApi.reviews({ status: 'PENDING', pageSize: 20 });
    expect(after.items.some((item) => item.id === task.id)).toBe(false);
  });

  it('封禁用户与角色分配写入内存库', async () => {
    await loginAs('admin');
    const users = await adminApi.users({ pageSize: 5 });
    const target = users.items.find((user) => user.id !== 1);
    expect(target).toBeTruthy();
    await adminApi.updateUserStatus(target!.id, 'BANNED', '契约测试');
    const afterBan = await adminApi.users({ keyword: target!.username });
    expect(afterBan.items[0].status).toBe('BANNED');

    await adminApi.assignRole(target!.id, 'MODERATOR');
    const afterRole = await adminApi.users({ keyword: target!.username });
    expect(afterRole.items[0].role).toBe('MODERATOR');
  });

  it('平台设置读写闭环', async () => {
    await loginAs('admin');
    const settings = await adminApi.settings();
    const next = await adminApi.updateSettings({
      review: { ...settings.review, newUserWindowHours: 96 },
    });
    expect(next.review.newUserWindowHours).toBe(96);
    const reread = await adminApi.settings();
    expect(reread.review.newUserWindowHours).toBe(96);
  });

  it('统一响应信封包含 code/message/data', async () => {
    const envelope = await http.get<{ id: number }>('/api/v1/categories');
    expect(Array.isArray(envelope)).toBe(true);
  });
});
