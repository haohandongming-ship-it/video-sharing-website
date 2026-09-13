/**
 * Mock 适配层：拦截 /api/** 请求，返回与《项目开发文档 v2.0》第 6 章一致的响应结构。
 *
 * - 只拦截同源 /api 路径，其余请求（HLS 分片、静态资源）原样透传给真实 fetch；
 * - 模拟真实网络延迟与业务错误码（限流、越权、参数校验），便于前端错误态验收；
 * - 所有写操作会真实修改内存态，因此「点赞 → 刷新后仍为已赞」这类链路可端到端验证。
 */
import { API_BASE_URL, BIZ_CODE } from '@/api/config';
import type {
  AdminOverview,
  ApiEnvelope,
  AppNotification,
  CommentItem,
  DirectMessage,
  FeedPost,
  PageData,
  Permission,
  PlatformSettings,
  RankingItem,
  UserProfile,
  VideoDetail,
  VideoSummary,
} from '@/api/types';
import {
  ADMIN_USERS,
  ALL_BRIEFS,
  AUDIT_LOGS,
  CATEGORIES,
  CONVERSATIONS,
  DEMO_ACCOUNTS,
  FEED_POSTS,
  FILE_HASHES,
  NOTIFICATIONS,
  PLATFORM_SETTINGS,
  REPORT_TASKS,
  REVIEW_TASKS,
  UPLOAD_TASKS,
  VIDEO_STORE,
  adminOverview,
  briefOf,
  commentsOf,
  engagement,
  feedCommentsOf,
  findVideo,
  messagesOf,
  now,
  profileOf,
  registerUploadedVideo,
  session,
  toSummary,
  type MockUploadTask,
} from './seed';

/* --------------------------------------------------------------- 工具 */

function envelope<T>(data: T, message = 'ok'): ApiEnvelope<T> {
  return { code: 0, message, data, timestamp: Date.now() };
}

function ok<T>(data: T): Response {
  return new Response(JSON.stringify(envelope(data)), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fail(code: number, message: string, status = 200): Response {
  return new Response(JSON.stringify({ code, message, data: null, timestamp: Date.now() } satisfies ApiEnvelope<null>), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const latency = () => 90 + Math.floor(Math.random() * 220);

function pageOf<T>(items: T[], page: number, pageSize: number): PageData<T> {
  const start = (page - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return { items: slice, total: items.length, page, pageSize, hasMore: start + slice.length < items.length };
}

function cursorOf<T>(items: T[], cursor: string | null, pageSize: number) {
  const start = cursor ? Number(cursor) || 0 : 0;
  const slice = items.slice(start, start + pageSize);
  const next = start + slice.length;
  return { items: slice, nextCursor: next < items.length ? String(next) : null, hasMore: next < items.length };
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== 'string') return {};
  try {
    return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 要求登录；未登录时抛 401 信封 */
function requireLogin(): UserProfile {
  const user = session.currentUser();
  if (!user) throw new MockError(BIZ_CODE.UNAUTHORIZED, '请先登录', 401);
  return user;
}

function requirePermission(permission: Permission): UserProfile {
  const user = requireLogin();
  if (!user.permissions.includes(permission)) {
    throw new MockError(BIZ_CODE.FORBIDDEN, '没有权限执行该操作', 403);
  }
  return user;
}

class MockError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly status = 200,
  ) {
    super(message);
  }
}

/** uploadId → sha256：合并完成时据此登记内容寻址记录，支撑秒传 */
const PENDING_UPLOADS = new Map<string, string>();

/* --------------------------------------------------------- 互动状态注入 */

function decorate(detail: VideoDetail): VideoDetail {
  const e = engagement;
  return {
    ...detail,
    liked: e.liked.has(detail.id),
    disliked: e.disliked.has(detail.id),
    favorited: e.favorited.has(detail.id),
    subscribed: e.subscribed.has(detail.author.id),
    stats: {
      ...detail.stats,
      likes: detail.stats.likes + (e.liked.has(detail.id) ? 1 : 0),
      favorites: detail.stats.favorites + (e.favorited.has(detail.id) ? 1 : 0),
    },
  };
}

/* --------------------------------------------------------------- 视频查询 */

function publishedLong(): VideoDetail[] {
  return VIDEO_STORE.filter((v) => v.detail.videoType === 'LONG' && v.detail.status === 'PUBLISHED').map(
    (v) => v.detail,
  );
}

function publishedShort(): VideoDetail[] {
  return VIDEO_STORE.filter((v) => v.detail.videoType === 'SHORT' && v.detail.status === 'PUBLISHED').map(
    (v) => v.detail,
  );
}

function hotScore(detail: VideoDetail): number {
  // 文档 8.3：热度 = 对数归一化，避免播放量主导
  const { views, likes, comments, favorites, shares = 0 } = detail.stats;
  return (
    Math.log10(views + 1) * 1.0 +
    Math.log10(likes + 1) * 3.0 +
    Math.log10(comments + 1) * 3.5 +
    Math.log10(favorites + 1) * 4.0 +
    Math.log10(shares + 1) * 5.0
  );
}

function rankingOf(type: string, period: string, categoryId: number | null, pageSize = 30): RankingItem[] {
  let pool = publishedLong();
  if (type === 'newcomer') {
    pool = pool.filter((v) => v.author.id >= 9);
  }
  if (categoryId) pool = pool.filter((v) => v.category?.id === categoryId);
  const scored = pool
    .map((detail) => ({ detail, score: hotScore(detail) * (period === 'weekly' ? 1.04 : period === 'monthly' ? 0.97 : 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, pageSize);

  return scored.map((item, index) => {
    const delta = ((item.detail.id % 7) - 3) as number;
    return {
      rank: index + 1,
      video: toSummary(item.detail),
      score: Number(item.score.toFixed(2)),
      delta,
      trend: index < 2 && item.detail.id % 2 === 0 ? 'new' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'same',
    } satisfies RankingItem;
  });
}

/* ------------------------------------------------------------- 路由分发 */

type Ctx = {
  method: string;
  pathname: string;
  query: URLSearchParams;
  body: Record<string, unknown>;
  parts: string[];
};

async function route(ctx: Ctx): Promise<Response> {
  const { method, pathname, query, body, parts } = ctx;
  const viewer = session.userId;

  /* ---------------- 认证 ---------------- */
  if (pathname === '/api/v1/auth/captcha' && method === 'GET') {
    return ok({ captchaId: `cap_${Date.now().toString(36)}`, imageUrl: '', question: '3 + 5 = ?' });
  }
  if (pathname === '/api/v1/auth/sms-code' && method === 'POST') {
    const phone = String(body.phone ?? '');
    if (!/^1[3-9]\d{9}$/.test(phone)) return fail(BIZ_CODE.PARAM_INVALID, '手机号格式不正确');
    await delay(360);
    return ok({ sent: true, expiresIn: 300, mockCode: '123456' });
  }
  if (pathname === '/api/v1/auth/login' && method === 'POST') {
    const account = String(body.account ?? '');
    const password = String(body.password ?? '');
    const code = body.code ? String(body.code) : null;
    await delay(320);
    if (code !== null) {
      if (code !== '123456') return fail(BIZ_CODE.BAD_SMS_CODE, '验证码错误或已失效');
      session.login(3);
      return ok({ accessToken: session.accessToken, expiresIn: 900, user: profileOf(3, 3) });
    }
    const found = DEMO_ACCOUNTS.find(
      (a) => (a.account === account || `${a.account}@example.com` === account) && a.password === password,
    );
    if (!found) return fail(BIZ_CODE.BAD_CREDENTIALS, '账号或密码错误');
    session.login(found.userId);
    return ok({ accessToken: session.accessToken, expiresIn: 900, user: profileOf(found.userId, found.userId) });
  }
  if (pathname === '/api/v1/auth/register' && method === 'POST') {
    await delay(360);
    if (!body.agreeTerms) return fail(BIZ_CODE.PARAM_INVALID, '请先同意用户协议与隐私政策');
    const username = String(body.username ?? '');
    if (username.length < 4) return fail(BIZ_CODE.PARAM_INVALID, '用户名至少 4 个字符');
    if (String(body.password ?? '').length < 6) return fail(BIZ_CODE.PARAM_INVALID, '密码至少 6 位');
    session.login(11);
    return ok({ accessToken: session.accessToken, expiresIn: 900, user: profileOf(11, 11) });
  }
  if (pathname === '/api/v1/auth/refresh' && method === 'POST') {
    if (session.userId === null) return fail(BIZ_CODE.UNAUTHORIZED, '登录状态已过期，请重新登录', 401);
    return ok({ accessToken: session.accessToken, expiresIn: 900, user: profileOf(session.userId, session.userId) });
  }
  if (pathname === '/api/v1/auth/logout' && method === 'POST') {
    session.logout();
    return ok({ success: true });
  }
  if (pathname === '/api/v1/auth/oauth/authorize-url' && method === 'GET') {
    const provider = query.get('provider') ?? 'wechat';
    const state = `st_${Math.random().toString(36).slice(2, 12)}`;
    return ok({ url: `https://open.${provider}.com/oauth?state=${state}`, state });
  }
  if (pathname === '/api/v1/users/me' && method === 'GET') {
    const user = requireLogin();
    return ok(user);
  }
  if (pathname === '/api/v1/users/me' && method === 'PUT') {
    const user = requireLogin();
    return ok({ ...user, ...(body as Partial<UserProfile>) });
  }
  if (pathname === '/api/v1/users/me/deactivate' && method === 'POST') {
    requireLogin();
    await delay(300);
    return ok({ scheduledAt: new Date(now() + 7 * 86_400_000).toISOString(), coolDownDays: 7 });
  }
  if (pathname === '/api/v1/users/me/real-name' && method === 'POST') {
    requireLogin();
    await delay(500);
    return ok({ status: 'PENDING' });
  }
  if (pathname === '/api/v1/users/me/password' && method === 'PUT') {
    requireLogin();
    if (String(body.oldPassword ?? '').length < 6) return fail(BIZ_CODE.PARAM_INVALID, '原密码不正确');
    return ok({ success: true });
  }

  /* ---------------- 分类 ---------------- */
  if (pathname === '/api/v1/categories' && method === 'GET') {
    return ok(CATEGORIES);
  }

  /* ---------------- 视频 ---------------- */
  if (pathname === '/api/v1/videos/recommend' && method === 'GET') {
    const page = Number(query.get('page') ?? 1);
    const pageSize = Number(query.get('pageSize') ?? 20);
    const sort = query.get('sort') ?? 'recommend';
    const pool = publishedLong();
    if (sort === 'latest') pool.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
    else if (sort === 'views') pool.sort((a, b) => b.stats.views - a.stats.views);
    else if (sort === 'hot') pool.sort((a, b) => hotScore(b) - hotScore(a));
    else pool.sort((a, b) => hotScore(b) * (b.id % 5 + 1) - hotScore(a) * (a.id % 5 + 1));
    return ok(pageOf(pool.map(toSummary), page, pageSize));
  }

  if (pathname === '/api/v1/videos/ranking' && method === 'GET') {
    const type = query.get('type') ?? 'hot';
    const period = query.get('period') ?? 'daily';
    const categoryId = query.get('categoryId') ? Number(query.get('categoryId')) : null;
    return ok(rankingOf(type, period, categoryId));
  }

  if (pathname === '/api/v1/videos/search' && method === 'GET') {
    const q = (query.get('q') ?? '').trim();
    const page = Number(query.get('page') ?? 1);
    const pageSize = Number(query.get('pageSize') ?? 20);
    const sort = query.get('sort') ?? 'relevance';
    if (!q) return ok(pageOf([], page, pageSize));
    const lower = q.toLowerCase();
    let pool = publishedLong().filter(
      (v) =>
        v.title.toLowerCase().includes(lower) ||
        v.tags.some((t) => t.toLowerCase().includes(lower)) ||
        v.author.nickname.toLowerCase().includes(lower),
    );
    const duration = query.get('duration');
    if (duration === 'short') pool = pool.filter((v) => v.duration < 300);
    if (duration === 'medium') pool = pool.filter((v) => v.duration >= 300 && v.duration < 1800);
    if (duration === 'long') pool = pool.filter((v) => v.duration >= 1800);
    if (sort === 'latest') pool = pool.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
    if (sort === 'views') pool = pool.sort((a, b) => b.stats.views - a.stats.views);
    await delay(180);
    return ok({
      ...pageOf(pool.map(toSummary), page, pageSize),
      suggestions: ['架构设计', '性能优化', '家常菜', '骑行'],
      costMs: 42,
    });
  }

  if (pathname === '/api/v1/videos/shorts' && method === 'GET') {
    const cursor = query.get('cursor');
    const pageSize = Number(query.get('pageSize') ?? 8);
    const items = publishedShort().map((detail) => ({
      ...toSummary(detail),
      hlsUrl: detail.hlsUrl,
      liked: engagement.liked.has(detail.id),
      favorited: engagement.favorited.has(detail.id),
    }));
    return ok(cursorOf(items, cursor, pageSize));
  }

  if (pathname === '/api/v1/videos/history' && method === 'GET') {
    requireLogin();
    const page = Number(query.get('page') ?? 1);
    const pageSize = Number(query.get('pageSize') ?? 20);
    const items = [...engagement.history.entries()].map(([videoId, progress]) => {
      const record = findVideo(videoId);
      if (!record) return null;
      const summary = toSummary(record.detail);
      return { ...summary, progress, finished: progress >= record.detail.duration - 5 };
    });
    return ok(pageOf(items.filter(Boolean) as VideoSummary[], page, pageSize));
  }

  if (pathname === '/api/v1/videos/favorites' && method === 'GET') {
    requireLogin();
    const page = Number(query.get('page') ?? 1);
    const pageSize = Number(query.get('pageSize') ?? 20);
    const folderId = query.get('folderId') ? Number(query.get('folderId')) : null;
    const all = VIDEO_STORE.filter((v) => engagement.favorited.has(v.detail.id)).map((v) => toSummary(v.detail));
    // 空收藏必须保持为空；用视频列表兜底会让“移出收藏”刷新后重新出现。
    const pool = all;
    void folderId;
    return ok({ ...pageOf(pool, page, pageSize), folders: engagement.favoriteFolders });
  }

  if (pathname === '/api/v1/videos/playlists' && method === 'GET') {
    requireLogin();
    return ok(engagement.playlists);
  }

  // /api/v1/videos/{id}
  if (parts[2] === 'videos' && parts.length >= 4 && /^\d+$/.test(parts[3] ?? '')) {
    const id = Number(parts[3]);
    const record = findVideo(id);
    if (!record) return fail(BIZ_CODE.NOT_FOUND, '资源不存在或已被删除', 404);
    const sub = parts[4];

    if (!sub && method === 'GET') return ok(decorate(record.detail));

    if (!sub && (method === 'PUT' || method === 'DELETE')) {
      const user = requireLogin();
      const isOwner = record.detail.author.id === user.id;
      const canManage = user.permissions.includes('moderation:review');
      if (!isOwner && !canManage) return fail(BIZ_CODE.FORBIDDEN, '没有权限执行该操作', 403);
      if (method === 'DELETE') {
        record.detail.status = 'DELETED';
        await delay(240);
        return ok({ success: true, recoverableUntil: new Date(now() + 30 * 86_400_000).toISOString() });
      }
      Object.assign(record.detail, body, { updatedAt: new Date().toISOString() });
      return ok(decorate(record.detail));
    }

    if (sub === 'play' && method === 'GET') {
      return ok({
        hlsUrl: record.detail.hlsUrl,
        qualities: record.detail.qualities,
        expiresAt: new Date(now() + 3600_000).toISOString(),
        poster: record.detail.coverUrl,
      });
    }

    if (sub === 'related' && method === 'GET') {
      const related = publishedLong()
        .filter((v) => v.id !== id && v.category?.id === record.detail.category?.id)
        .slice(0, 12)
        .map((v) => ({ ...toSummary(v), recommendReason: `同属「${v.category?.name}」分区` }));
      const fill = publishedLong()
        .filter((v) => v.id !== id)
        .slice(0, 12 - related.length)
        .map((v) => ({ ...toSummary(v), recommendReason: '根据观看历史推荐' }));
      return ok(related.concat(fill));
    }

    if (sub === 'view' && method === 'POST') {
      record.detail.stats.views += 1;
      return ok({ counted: true, views: record.detail.stats.views });
    }

    if (sub === 'progress' && method === 'POST') {
      const progress = Number(body.progress ?? 0);
      engagement.history.set(id, progress);
      return ok({ saved: true, progress });
    }

    if (sub === 'download' && method === 'GET') {
      const user = requireLogin();
      if (!record.detail.downloadEnabled && !user.permissions.includes('video:download')) {
        return fail(BIZ_CODE.FORBIDDEN, '作者未开启下载', 403);
      }
      return ok({
        url: `/demo/hls/master.m3u8?sig=mock&exp=${Math.floor(now() / 1000) + 600}`,
        expiresIn: 600,
        quality: record.detail.qualities[record.detail.qualities.length - 1],
      });
    }

    if (['like', 'dislike', 'favorite', 'subscribe'].includes(sub ?? '')) {
      requireLogin();
      const action = String(body.action ?? 'LIKE');
      const on = !(action === 'OFF' || action === 'UN' || action.startsWith('UN'));
      if (sub === 'like') {
        const wasLiked = engagement.liked.has(id);
        if (on) engagement.liked.add(id);
        else engagement.liked.delete(id);
        // 幂等：状态未变化时不重复计数
        if (wasLiked !== on) record.detail.stats.likes += on ? 1 : -1;
        return ok({ active: on, count: Math.max(0, record.detail.stats.likes) });
      }
      if (sub === 'dislike') {
        if (on) engagement.disliked.add(id);
        else engagement.disliked.delete(id);
        return ok({ active: on, count: record.detail.stats.dislikes });
      }
      if (sub === 'favorite') {
        const wasFavorited = engagement.favorited.has(id);
        if (on) engagement.favorited.add(id);
        else engagement.favorited.delete(id);
        if (wasFavorited !== on) record.detail.stats.favorites += on ? 1 : -1;
        return ok({ active: on, count: Math.max(0, record.detail.stats.favorites) });
      }
      if (on) engagement.subscribed.add(record.detail.author.id);
      else engagement.subscribed.delete(record.detail.author.id);
      return ok({ active: on });
    }

    if (sub === 'comments' && method === 'GET') {
      const sort = query.get('sort') ?? 'hot';
      const page = Number(query.get('page') ?? 1);
      const pageSize = Number(query.get('pageSize') ?? 20);
      const all = [...commentsOf(id)];
      if (sort === 'hot') all.sort((a, b) => b.likeCount - a.likeCount);
      else all.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      return ok(pageOf(all, page, pageSize));
    }

    if (sub === 'comments' && method === 'POST') {
      const user = requireLogin();
      const content = String(body.content ?? '').trim();
      if (!content) return fail(BIZ_CODE.PARAM_INVALID, '评论内容不能为空');
      if (content.length > 1000) return fail(BIZ_CODE.PARAM_INVALID, '评论长度不能超过 1000 字');
      const list: CommentItem[] = commentsOf(id);
      const item: CommentItem = {
        id: id * 1000 + 900 + list.length,
        videoId: id,
        parentId: null,
        rootId: null,
        content,
        user: briefOf(user.id),
        likeCount: 0,
        replyCount: 0,
        liked: false,
        status: 'VISIBLE',
        createdAt: new Date().toISOString(),
        replies: [],
        isVideoAuthor: record.detail.author.id === user.id,
      };
      list.unshift(item);
      record.detail.stats.comments += 1;
      await delay(260);
      return ok(item);
    }
  }

  /* ---------------- 评论楼中楼 ---------------- */
  if (parts[2] === 'comments' && parts.length >= 4 && /^\d+$/.test(parts[3] ?? '')) {
    const commentId = Number(parts[3]);
    const sub = parts[4];
    if (sub === 'replies' && method === 'GET') {
      const page = Number(query.get('page') ?? 1);
      const pageSize = Number(query.get('pageSize') ?? 10);
      const videoId = Math.floor(commentId / 1000);
      const root = commentsOf(videoId).find((c) => c.id === commentId);
      const replies = root?.replies ?? [];
      const generated: CommentItem[] = Array.from(
        { length: Math.max(0, (root?.replyCount ?? 0) - replies.length) },
        (_, i) => ({
          id: commentId * 10 + replies.length + i,
          videoId,
          parentId: commentId,
          rootId: commentId,
          content: '补充一句：这个结论在读写比 10:1 的场景下尤其成立。',
          user: ALL_BRIEFS[(commentId + i) % ALL_BRIEFS.length],
          likeCount: (i * 7) % 40,
          replyCount: 0,
          liked: false,
          status: 'VISIBLE' as const,
          createdAt: new Date(now() - (i + 1) * 3_600_000).toISOString(),
        }),
      );
      const all: CommentItem[] = [...replies, ...generated];
      return ok(pageOf(all, page, pageSize));
    }
    if (sub === 'reply' && method === 'POST') {
      const user = requireLogin();
      const content = String(body.content ?? '').trim();
      if (!content) return fail(BIZ_CODE.PARAM_INVALID, '回复内容不能为空');
      const videoId = Math.floor(commentId / 1000);
      const root = commentsOf(videoId).find((c) => c.id === commentId);
      const reply: CommentItem = {
        id: commentId * 10 + 900 + (root?.replies.length ?? 0),
        videoId,
        parentId: commentId,
        rootId: commentId,
        content,
        user: briefOf(user.id),
        likeCount: 0,
        replyCount: 0,
        liked: false,
        status: 'VISIBLE',
        createdAt: new Date().toISOString(),
      };
      root?.replies.push(reply);
      if (root) root.replyCount += 1;
      await delay(220);
      return ok(reply);
    }
    if (sub === 'like' && method === 'POST') {
      requireLogin();
      return ok({ active: body.action !== 'UNLIKE', count: Math.floor(Math.random() * 200) });
    }
    if (method === 'DELETE') {
      const user = requireLogin();
      void user;
      const videoId = Math.floor(commentId / 1000);
      const list = commentsOf(videoId);
      const index = list.findIndex((c) => c.id === commentId);
      if (index >= 0) list.splice(index, 1);
      return ok({ success: true });
    }
  }

  /* ---------------- 动态 ---------------- */
  if (pathname === '/api/v1/feeds' && method === 'GET') {
    const type = query.get('type') ?? 'recommend';
    const cursor = query.get('cursor');
    const pageSize = Number(query.get('pageSize') ?? 10);
    let pool = [...FEED_POSTS];
    if (type === 'following') pool = pool.filter((p) => p.user.id % 2 === 0);
    if (type === 'hot') pool = pool.sort((a, b) => b.stats.likes - a.stats.likes);
    const items = cursorOf(pool, cursor, pageSize).items.map((p) => ({
      ...p,
      liked: p.liked || engagement.liked.has(p.id),
    }));
    const meta = cursorOf(pool, cursor, pageSize);
    return ok({ items, nextCursor: meta.nextCursor, hasMore: meta.hasMore });
  }
  if (pathname === '/api/v1/feeds' && method === 'POST') {
    const user = requireLogin();
    const content = String(body.content ?? '').trim();
    if (!content) return fail(BIZ_CODE.PARAM_INVALID, '动态内容不能为空');
    if (content.length > 2000) return fail(BIZ_CODE.PARAM_INVALID, '动态内容不能超过 2000 字');
    const post: FeedPost = {
      id: 39_000 + FEED_POSTS.length,
      type: body.repostOfId ? 'REPOST' : 'ORIGINAL',
      content,
      user: briefOf(user.id),
      media: [],
      topic: body.topicName ? { id: 99, name: String(body.topicName) } : null,
      mentions: [],
      repostOf: body.repostOfId ? (FEED_POSTS.find((p) => p.id === Number(body.repostOfId)) ?? null) : null,
      stats: { likes: 0, comments: 0, reposts: 0 },
      liked: false,
      createdAt: new Date().toISOString(),
      isOwner: true,
    };
    FEED_POSTS.unshift(post);
    await delay(300);
    return ok(post);
  }
  if (parts[2] === 'feeds' && parts.length >= 4 && /^\d+$/.test(parts[3] ?? '')) {
    const feedId = Number(parts[3]);
    const post = FEED_POSTS.find((p) => p.id === feedId) ?? FEED_POSTS[0];
    const sub = parts[4];
    if (!sub && method === 'GET') return ok(post);
    if (!sub && method === 'DELETE') {
      requireLogin();
      const index = FEED_POSTS.findIndex((p) => p.id === feedId);
      if (index >= 0) FEED_POSTS.splice(index, 1);
      return ok({ success: true });
    }
    if (sub === 'like' && method === 'POST') {
      requireLogin();
      const on = body.action !== 'UNLIKE';
      post.liked = on;
      post.stats.likes += on ? 1 : -1;
      return ok({ active: on, count: post.stats.likes });
    }
    if (sub === 'repost' && method === 'POST') {
      requireLogin();
      post.stats.reposts += 1;
      return ok({ count: post.stats.reposts });
    }
    if (sub === 'comments' && method === 'GET') {
      const page = Number(query.get('page') ?? 1);
      const pageSize = Number(query.get('pageSize') ?? 20);
      return ok(pageOf(feedCommentsOf(feedId), page, pageSize));
    }
    if (sub === 'comments' && method === 'POST') {
      const user = requireLogin();
      const item: CommentItem = {
        id: feedId * 100 + 99,
        videoId: feedId,
        parentId: null,
        rootId: null,
        content: String(body.content ?? ''),
        user: briefOf(user.id),
        likeCount: 0,
        replyCount: 0,
        liked: false,
        status: 'VISIBLE',
        createdAt: new Date().toISOString(),
      };
      await delay(200);
      return ok(item);
    }
  }

  /* ---------------- 用户 ---------------- */
  if (pathname === '/api/v1/users/suggested' && method === 'GET') {
    return ok(ALL_BRIEFS.slice(2, 10).map((b) => ({ ...b, reason: '你关注的人也在关注' })));
  }
  if (parts[2] === 'users' && parts.length >= 4) {
    const userId = Number(parts[3]);
    if (!Number.isFinite(userId)) return fail(BIZ_CODE.NOT_FOUND, '用户不存在', 404);
    const sub = parts[4];
    if (!sub && method === 'GET') return ok(profileOf(userId, viewer));
    if (sub === 'videos' && method === 'GET') {
      const page = Number(query.get('page') ?? 1);
      const pageSize = Number(query.get('pageSize') ?? 12);
      const pool = VIDEO_STORE.filter((v) => v.detail.author.id === userId).map((v) => toSummary(v.detail));
      const list = pool.length > 0 ? pool : VIDEO_STORE.slice(0, 18).map((v) => toSummary(v.detail));
      return ok(pageOf(list, page, pageSize));
    }
    if (sub === 'feeds' && method === 'GET') {
      const page = Number(query.get('page') ?? 1);
      const pageSize = Number(query.get('pageSize') ?? 10);
      const pool = FEED_POSTS.filter((p) => p.user.id === userId);
      const list = pool.length > 0 ? pool : FEED_POSTS.slice(0, 12);
      return ok(pageOf(list, page, pageSize));
    }
    if (sub === 'favorites' && method === 'GET') {
      const page = Number(query.get('page') ?? 1);
      const pageSize = Number(query.get('pageSize') ?? 12);
      return ok(pageOf(VIDEO_STORE.slice(6, 30).map((v) => toSummary(v.detail)), page, pageSize));
    }
    if (sub === 'followers' || sub === 'following') {
      const page = Number(query.get('page') ?? 1);
      const pageSize = Number(query.get('pageSize') ?? 20);
      const list = ALL_BRIEFS.filter((b) => b.id !== userId).map((b) => ({
        ...b,
        followed: engagement.followed.has(b.id),
        mutual: b.id % 5 === 0,
        followedAt: new Date(now() - b.id * 86_400_000).toISOString(),
      }));
      if (method === 'GET') return ok(pageOf(list, page, pageSize));
    }
    if (sub === 'follow' && method === 'POST') {
      requireLogin();
      const on = body.action !== 'UNFOLLOW';
      if (on) engagement.followed.add(userId);
      else engagement.followed.delete(userId);
      await delay(180);
      return ok({ active: on, mutual: userId % 5 === 0 });
    }
  }

  /* ---------------- 举报 ---------------- */
  if (pathname === '/api/v1/reports' && method === 'POST') {
    requireLogin();
    if (!body.reason) return fail(BIZ_CODE.PARAM_INVALID, '请选择举报类型');
    await delay(320);
    return ok({ reportId: 90_000 + Math.floor(Math.random() * 999), status: 'PENDING' });
  }

  /* ---------------- 通知 ---------------- */
  if (pathname === '/api/v1/notifications' && method === 'GET') {
    requireLogin();
    const page = Number(query.get('page') ?? 1);
    const pageSize = Number(query.get('pageSize') ?? 20);
    const type = query.get('type');
    const pool = type && type !== 'ALL' ? NOTIFICATIONS.filter((n) => n.type === type) : NOTIFICATIONS;
    return ok({ ...pageOf(pool, page, pageSize), unreadCount: NOTIFICATIONS.filter((n) => !n.isRead).length });
  }
  if (pathname === '/api/v1/notifications/unread-count' && method === 'GET') {
    return ok({ count: session.userId ? NOTIFICATIONS.filter((n) => !n.isRead).length : 0 });
  }
  if (pathname === '/api/v1/notifications/read' && method === 'POST') {
    requireLogin();
    const ids = (body.ids as number[] | undefined) ?? [];
    NOTIFICATIONS.forEach((n) => {
      if (ids.length === 0 || ids.includes(n.id)) n.isRead = true;
    });
    return ok({ success: true });
  }

  /* ---------------- 私信 ---------------- */
  if (pathname === '/api/v1/messages/conversations' && method === 'GET') {
    requireLogin();
    return ok(CONVERSATIONS);
  }
  if (parts[2] === 'messages' && parts[3] === 'conversations' && parts[4] && parts[5] === 'messages') {
    const conversationId = Number(parts[4]);
    if (method === 'GET') {
      requireLogin();
      return ok(messagesOf(conversationId));
    }
    if (method === 'POST') {
      const user = requireLogin();
      const list = messagesOf(conversationId);
      const message: DirectMessage = {
        id: conversationId * 100 + 900 + list.length,
        conversationId,
        senderId: user.id,
        content: String(body.content ?? ''),
        attachment: null,
        createdAt: new Date().toISOString(),
        mine: true,
      };
      list.push(message);
      await delay(200);
      return ok(message);
    }
  }

  /* ---------------- 上传 ---------------- */
  if (pathname === '/api/v1/uploads/init' && method === 'POST') {
    requireLogin();
    const sha256 = String(body.sha256 ?? '');
    const fileSize = Number(body.fileSize ?? 0);
    const partSize = 8 * 1024 * 1024;
    await delay(320);

    const existingFileId = FILE_HASHES.get(sha256);
    if (existingFileId) {
      return ok({ instant: true, fileId: existingFileId, videoId: 10_001 + (existingFileId % 50) });
    }
    const uploadId = `up_${sha256.slice(0, 12) || Math.random().toString(36).slice(2, 14)}`;
    PENDING_UPLOADS.set(uploadId, sha256);
    const totalParts = Math.max(1, Math.ceil(fileSize / partSize));
    const task: MockUploadTask = {
      uploadId,
      videoId: 30_000 + UPLOAD_TASKS.size + 1,
      title: String(body.title ?? '未命名视频'),
      fileName: String(body.fileName ?? 'video.mp4'),
      fileSize,
      description: String(body.description ?? ''),
      categoryId: Number(body.categoryId ?? 1),
      duration: Number(body.duration ?? 0),
      visibility: (body.visibility as MockUploadTask['visibility']) ?? 'PUBLIC',
      videoType: (body.videoType as MockUploadTask['videoType']) ?? 'LONG',
      partSize,
      totalParts,
      uploadedParts: [],
      createdAt: now(),
      status: 'UPLOADING',
      transcodeProgress: 0,
    };
    UPLOAD_TASKS.set(uploadId, task);
    return ok({
      instant: false,
      uploadId,
      partSize,
      videoId: task.videoId,
      parts: Array.from({ length: totalParts }, (_, i) => ({
        partNumber: i + 1,
        url: `/api/v1/mock-minio/${uploadId}/part-${i + 1}?X-Amz-Signature=mock`,
      })),
      uploadedParts: [],
    });
  }
  if (parts[2] === 'uploads' && parts[4] === 'complete' && method === 'POST') {
    requireLogin();
    const uploadId = parts[3];
    const task = UPLOAD_TASKS.get(uploadId);
    await delay(280);
    if (task) {
      task.status = 'TRANSCODING';
      task.transcodeProgress = 0;
      // 合并完成后登记内容寻址记录，后续相同 SHA-256 的重复上传即可秒传（文档 10.1）
      const sha256 = PENDING_UPLOADS.get(uploadId);
      if (sha256) FILE_HASHES.set(sha256, 9000 + UPLOAD_TASKS.size);
    }
    return ok({
      videoId: task?.videoId ?? 30_001,
      status: 'PROCESSING' as const,
      message: '上传完成，已进入转码队列',
    });
  }
  if (parts[2] === 'uploads' && parts[4] === 'abort' && method === 'POST') {
    requireLogin();
    UPLOAD_TASKS.delete(parts[3]);
    return ok({ success: true });
  }
  if (parts[2] === 'transcode' && parts[4] === 'progress' && method === 'GET') {
    const videoId = Number(parts[3]);
    const task = [...UPLOAD_TASKS.values()].find((t) => t.videoId === videoId);
    if (task) {
      if (task.status === 'TRANSCODING') {
        task.transcodeProgress = Math.min(100, task.transcodeProgress + 7 + Math.floor(Math.random() * 9));
        if (task.transcodeProgress >= 100) {
          task.status = 'REVIEWING';
          registerUploadedVideo(task, session.userId ?? 3);
        }
      } else if (task.status === 'REVIEWING' && Math.random() > 0.65) {
        task.status = 'PUBLISHED';
        const record = registerUploadedVideo(task, session.userId ?? 3);
        record.detail.status = 'PUBLISHED';
      }
    }
    const status =
      task?.status === 'TRANSCODING'
        ? 'RUNNING'
        : task?.status === 'REVIEWING' || task?.status === 'PUBLISHED'
          ? 'SUCCESS'
          : 'QUEUED';
    return ok({
      videoId,
      taskId: videoId * 10 + 1,
      quality: '720p',
      status,
      progress: task?.transcodeProgress ?? 100,
      errorMsg: null,
      retryCount: 0,
      videoStatus: task?.status ?? 'PUBLISHED',
    });
  }

  /* ---------------- 创作者中心 ---------------- */
  if (pathname === '/api/v1/creator/videos' && method === 'GET') {
    const user = requireLogin();
    const page = Number(query.get('page') ?? 1);
    const pageSize = Number(query.get('pageSize') ?? 10);
    const status = query.get('status');
    let pool = VIDEO_STORE.filter((v) => v.detail.author.id === user.id || v.detail.author.id === 3);
    if (status && status !== 'ALL') pool = pool.filter((v) => v.detail.status === status);
    const list = pool.map((v) => ({
      ...toSummary(v.detail),
      transcodeProgress: v.transcode.progress,
      rejectReason: v.detail.status === 'REJECTED' ? '封面与内容不符' : null,
      views7d: Math.floor(v.detail.stats.views * 0.14),
    }));
    return ok(pageOf(list, page, pageSize));
  }
  if (pathname === '/api/v1/creator/dashboard' && method === 'GET') {
    requireLogin();
    const days = Number(query.get('days') ?? 30);
    const trend = Array.from({ length: days }, (_, i) => {
      const base = 3200 + i * 42;
      return {
        date: new Date(now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
        views: base + (i % 5) * 380,
        likes: Math.floor((base + (i % 5) * 380) * 0.08),
        comments: Math.floor((base + (i % 5) * 380) * 0.014),
        favorites: Math.floor((base + (i % 5) * 380) * 0.03),
        followers: 120 + i * 3,
      };
    });
    const totals = trend.reduce(
      (acc, d) => ({
        views: acc.views + d.views,
        likes: acc.likes + d.likes,
        comments: acc.comments + d.comments,
        favorites: acc.favorites + d.favorites,
      }),
      { views: 0, likes: 0, comments: 0, favorites: 0 },
    );
    return ok({ trend, totals, followerTotal: 12_480, followerDelta: 386, avgWatchSeconds: 214, completionRate: 0.42 });
  }

  /* ---------------- 管理后台 ---------------- */
  if (pathname === '/api/v1/admin/overview' && method === 'GET') {
    requirePermission('admin:analytics');
    return ok(adminOverview() satisfies AdminOverview);
  }
  if (pathname === '/api/v1/admin/reviews' && method === 'GET') {
    requirePermission('moderation:review');
    const page = Number(query.get('page') ?? 1);
    const pageSize = Number(query.get('pageSize') ?? 10);
    const status = query.get('status');
    const risk = query.get('riskLevel');
    let pool = [...REVIEW_TASKS];
    if (status && status !== 'ALL') pool = pool.filter((t) => t.status === status);
    if (risk && risk !== 'ALL') pool = pool.filter((t) => t.riskLevel === risk);
    return ok(pageOf(pool, page, pageSize));
  }
  if (parts[2] === 'admin' && parts[3] === 'reviews' && parts[5] === 'decision' && method === 'POST') {
    const reviewer = requirePermission('moderation:review');
    const taskId = Number(parts[4]);
    const task = REVIEW_TASKS.find((t) => t.id === taskId);
    const decision = String(body.decision ?? 'APPROVE');
    if (task) {
      task.status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      task.reviewerId = reviewer.id;
      task.reviewNote = String(body.note ?? (decision === 'APPROVE' ? '人工复核通过' : '内容违规，不予发布'));
      const record = VIDEO_STORE.find((v) => v.detail.id === task.video.id);
      if (record) {
        record.detail.status = decision === 'APPROVE' ? 'PUBLISHED' : 'REJECTED';
        if (decision !== 'APPROVE') record.detail.reviewNote = task.reviewNote;
      }
    }
    await delay(240);
    return ok({ success: true, status: task?.status ?? 'APPROVED' });
  }
  if (pathname === '/api/v1/admin/reports' && method === 'GET') {
    requirePermission('moderation:report');
    const page = Number(query.get('page') ?? 1);
    const pageSize = Number(query.get('pageSize') ?? 10);
    const status = query.get('status');
    const reason = query.get('reason');
    let pool = [...REPORT_TASKS];
    if (status && status !== 'ALL') pool = pool.filter((t) => t.status === status);
    if (reason && reason !== 'ALL') pool = pool.filter((t) => t.reason === reason);
    return ok(pageOf(pool.sort((a, b) => b.priority - a.priority), page, pageSize));
  }
  if (parts[2] === 'admin' && parts[3] === 'reports' && parts[5] === 'handle' && method === 'POST') {
    const handler = requirePermission('moderation:report');
    const reportId = Number(parts[4]);
    const task = REPORT_TASKS.find((t) => t.id === reportId);
    if (task) {
      task.status = (body.status as typeof task.status) ?? 'RESOLVED';
      task.handlerId = handler.id;
      task.handledAt = new Date().toISOString();
    }
    await delay(220);
    return ok({ success: true, status: task?.status ?? 'RESOLVED' });
  }
  if (pathname === '/api/v1/admin/users' && method === 'GET') {
    requirePermission('admin:user_manage');
    const page = Number(query.get('page') ?? 1);
    const pageSize = Number(query.get('pageSize') ?? 10);
    const keyword = (query.get('keyword') ?? '').trim().toLowerCase();
    const role = query.get('role');
    const status = query.get('status');
    let pool = [...ADMIN_USERS];
    if (keyword) {
      pool = pool.filter(
        (u) =>
          u.username.toLowerCase().includes(keyword) ||
          u.nickname.toLowerCase().includes(keyword) ||
          u.email.toLowerCase().includes(keyword),
      );
    }
    if (role && role !== 'ALL') pool = pool.filter((u) => u.role === role);
    if (status && status !== 'ALL') pool = pool.filter((u) => u.status === status);
    return ok(pageOf(pool, page, pageSize));
  }
  if (parts[2] === 'admin' && parts[3] === 'users' && parts[4] && parts[5] === 'status' && method === 'PUT') {
    requirePermission('admin:user_manage');
    const user = ADMIN_USERS.find((u) => u.id === Number(parts[4]));
    if (user) user.status = (body.status as typeof user.status) ?? 'ACTIVE';
    return ok({ success: true, status: user?.status ?? 'ACTIVE' });
  }
  if (parts[2] === 'admin' && parts[3] === 'users' && parts[4] && parts[5] === 'role' && method === 'PUT') {
    requirePermission('admin:role_assign');
    const user = ADMIN_USERS.find((u) => u.id === Number(parts[4]));
    if (user) user.role = (body.role as typeof user.role) ?? 'USER';
    return ok({ success: true, role: user?.role ?? 'USER' });
  }
  if (pathname === '/api/v1/admin/videos' && method === 'GET') {
    requirePermission('moderation:review');
    const page = Number(query.get('page') ?? 1);
    const pageSize = Number(query.get('pageSize') ?? 10);
    const status = query.get('status');
    let pool = VIDEO_STORE.map((v) => toSummary(v.detail));
    if (status && status !== 'ALL') pool = pool.filter((v) => v.status === status);
    return ok(pageOf(pool, page, pageSize));
  }
  if (pathname === '/api/v1/admin/audit-logs' && method === 'GET') {
    requirePermission('admin:analytics');
    const page = Number(query.get('page') ?? 1);
    const pageSize = Number(query.get('pageSize') ?? 15);
    return ok(pageOf(AUDIT_LOGS, page, pageSize));
  }
  if (pathname === '/api/v1/admin/settings' && method === 'GET') {
    requirePermission('admin:system_config');
    return ok(PLATFORM_SETTINGS satisfies PlatformSettings);
  }
  if (pathname === '/api/v1/admin/settings' && method === 'PUT') {
    requirePermission('admin:system_config');
    Object.assign(PLATFORM_SETTINGS, body);
    await delay(260);
    return ok(PLATFORM_SETTINGS);
  }

  return fail(BIZ_CODE.NOT_FOUND, `Mock 未实现的接口：${method} ${pathname}`, 404);
}

/* --------------------------------------------------- MinIO 分片直传模拟 */

async function handleMockMinio(ctx: Ctx): Promise<Response> {
  const uploadId = ctx.parts[2];
  const partNumber = Number((ctx.parts[3] ?? '').replace('part-', ''));
  const task = UPLOAD_TASKS.get(uploadId);
  if (ctx.method === 'PUT') {
    await delay(120 + Math.random() * 280);
    if (task && !task.uploadedParts.includes(partNumber)) task.uploadedParts.push(partNumber);
    return new Response(null, { status: 200, headers: { ETag: `"etag-${uploadId}-${partNumber}"` } });
  }
  if (ctx.method === 'GET') {
    const uploaded = task?.uploadedParts ?? [];
    return ok({ uploadedParts: uploaded, totalParts: task?.totalParts ?? 0, status: task?.status ?? 'UNKNOWN' });
  }
  return fail(BIZ_CODE.NOT_FOUND, '分片不存在', 404);
}

/* ------------------------------------------------------------ 入口 */

export async function mockFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return fetch(input, init);
  }

  const apiBase = API_BASE_URL || '';
  const isApi =
    url.pathname.startsWith('/api/') || (apiBase.length > 0 && url.pathname.startsWith(new URL(apiBase, base).pathname));
  if (!isApi) return fetch(input, init);

  await delay(latency());

  const parts = url.pathname.split('/').filter(Boolean);
  const ctx: Ctx = {
    method: (init.method ?? 'GET').toUpperCase(),
    pathname: url.pathname,
    query: url.searchParams,
    body: bodyOf(init),
    parts,
  };

  try {
    if (parts[2] === 'mock-minio') return await handleMockMinio(ctx);
    return await route(ctx);
  } catch (error) {
    if (error instanceof MockError) return fail(error.code, error.message, error.status);
    // 便于开发期发现 mock 自身缺陷，同时不打断页面
    console.error('[mocks] 处理请求失败：', ctx.method, ctx.pathname, error);
    return fail(BIZ_CODE.SERVER_ERROR, '服务开小差了，请稍后重试', 500);
  }
}

/** 供实时层复用：模拟 STOMP 推送的通知 */
export function mockPushNotification(): AppNotification {
  const pool: AppNotification['type'][] = ['LIKE', 'COMMENT', 'FOLLOW', 'REPLY', 'SYSTEM', 'SUBSCRIPTION'];
  const type = pool[Math.floor(Math.random() * pool.length)];
  return {
    id: 99_000 + Math.floor(Math.random() * 999),
    type,
    title: type === 'FOLLOW' ? '新的关注者' : '收到新的互动',
    content: '演示用实时推送消息，可通过设置关闭。',
    actor: ALL_BRIEFS[Math.floor(Math.random() * ALL_BRIEFS.length)],
    targetType: 'VIDEO',
    targetId: 10_001,
    isRead: false,
    createdAt: new Date().toISOString(),
  };
}

export function mockRankingSsePayload(type: 'hot' | 'trend', period: string) {
  const items = rankingOf(type, period, null, 20).map((r) => ({
    rank: r.rank,
    videoId: r.video.id,
    title: r.video.title,
    score: r.score,
    delta: r.delta,
  }));
  return { type, period, updatedAt: new Date().toISOString(), items };
}

