#!/usr/bin/env node
/**
 * 测试报告缺陷回归 · 端到端校验脚本
 *
 * 针对 COMPREHENSIVE_TEST_REPORT.md / FRONTEND_UI_TEST_REPORT.md 列出的缺陷与加固项，
 * 对**正在运行的真实前后端**逐条断言（默认经 Vite 代理 http://127.0.0.1:5173，
 * 因此链路与浏览器一致：同源代理、CSRF 头、Cookie 作用域）。
 *
 * 用法：
 *   node scripts/report-regression-e2e.mjs [baseUrl]
 *
 * 退出码：全部通过 0，任一失败 1。原始结论打印在末尾，可直接作为验收证据。
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(here, '..', 'backend', 'src', 'main', 'resources', 'demo', 'sample.mp4');

const results = [];
let group = '通用';

function section(name) {
  group = name;
  console.log(`\n── ${name}`);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ group, name, ok: true, detail: detail ?? '' });
    console.log(`   ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    results.push({ group, name, ok: false, detail: error.message });
    console.log(`   ✗ ${name} — ${error.message}`);
  }
}

/** 统一请求封装：写操作自动带 CSRF 头，返回结构化的状态/响应头/JSON。 */
async function call(method, path, { token, body, raw, headers = {}, write = false } = {}) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const init = { method, headers: { ...headers } };
  if (write || method !== 'GET') init.headers['X-Requested-With'] = 'XMLHttpRequest';
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (raw) init.body = raw;
  const response = await fetch(url, init);
  const buffer = Buffer.from(await response.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buffer.toString('utf8'));
  } catch {
    /* 非 JSON（二进制/HTML）响应保持 null */
  }
  return {
    status: response.status,
    headers: response.headers,
    cookies: response.headers.getSetCookie?.() ?? [],
    buffer,
    json,
  };
}
const get = (path, options) => call('GET', path, options);
const post = (path, options) => call('POST', path, { ...options, write: true });
const put = (path, options) => call('PUT', path, { ...options, write: true });
const del = (path, options) => call('DELETE', path, { ...options, write: true });

async function login(account, password = '123456') {
  const response = await post('/auth/login', { body: { account, password, grantType: 'PASSWORD' } });
  assert(response.status === 200, `登录 ${account} 失败：HTTP ${response.status} ${response.json?.message ?? ''}`);
  return response.json.data.accessToken;
}
const data = (response) => {
  assert(response.json, `响应不是 JSON：HTTP ${response.status}`);
  return response.json.data;
};
const ok = (response, expected = 200) => {
  assert(response.status === expected, `期望 HTTP ${expected}，实际 ${response.status}（${response.json?.message ?? ''}）`);
  return response;
};

async function run() {
  console.log(`报告回归端到端校验 · ${BASE}`);

  /* ---------------------------------------------------------- BUG-01 媒体源 */
  section('BUG-01 种子视频源与 Range 语义');
  const sampleBytes = readFileSync(SAMPLE);
  await check('完整下载种子视频源，字节与打包文件一致', async () => {
    const response = await get('/videos/1/source');
    ok(response);
    assert(response.buffer.equals(sampleBytes), `字节不一致：${response.buffer.length} vs ${sampleBytes.length}`);
    assert(
      (response.headers.get('content-type') ?? '').includes('video/mp4'),
      `Content-Type 异常：${response.headers.get('content-type')}`,
    );
    return `${response.buffer.length} 字节`;
  });
  await check('Range 只返回请求区间（不再多送字节）', async () => {
    const response = await get('/videos/1/source', { headers: { Range: 'bytes=100-199' } });
    ok(response, 206);
    assert(response.headers.get('content-length') === '100', `Content-Length=${response.headers.get('content-length')}`);
    assert(response.buffer.equals(sampleBytes.subarray(100, 200)), '区间内容不匹配');
    return 'bytes=100-199 → 100 字节';
  });
  await check('后缀区间 bytes=-100 可用（读取文件尾部）', async () => {
    const response = await get('/videos/1/source', { headers: { Range: 'bytes=-100' } });
    ok(response, 206);
    assert(response.buffer.equals(sampleBytes.subarray(sampleBytes.length - 100)), '后缀区间内容不匹配');
    return 'bytes=-100 → 尾部 100 字节';
  });
  await check('越界 Range 返回 416 且带 Content-Range', async () => {
    const response = await get('/videos/1/source', { headers: { Range: 'bytes=999999999999999999999-' } });
    ok(response, 416);
    assert((response.headers.get('content-range') ?? '').startsWith('bytes */'), '缺少 Content-Range');
    return response.headers.get('content-range');
  });
  await check('多区间等不支持的 Range 按 RFC 忽略，返回完整内容', async () => {
    const response = await get('/videos/1/source', { headers: { Range: 'bytes=0-99,200-299' } });
    ok(response);
    assert(response.buffer.length === sampleBytes.length, '未回退为完整内容');
    return `200 完整 ${response.buffer.length} 字节`;
  });

  /* ------------------------------------------------------------- 账号与会话 */
  section('登录 / 会话 / 登出（BUG-05）');
  const creator = await login('laowang');
  const admin = await login('admin');
  await check('登录下发 httpOnly 刷新 Cookie 与媒体 Cookie', async () => {
    const response = await post('/auth/login', { body: { account: 'laowang', password: '123456', grantType: 'PASSWORD' } });
    ok(response);
    const refresh = response.cookies.find((c) => c.startsWith('video_refresh='));
    const media = response.cookies.find((c) => c.startsWith('video_media='));
    assert(refresh && refresh.includes('HttpOnly'), '缺少 video_refresh');
    assert(media && media.includes('HttpOnly') && media.includes('Path=/api/v1/videos'), 'video_media 作用域异常');
    return 'video_refresh + video_media 均 HttpOnly';
  });
  await check('媒体 Cookie 只能取源文件，不能访问其他接口', async () => {
    const response = await post('/auth/login', { body: { account: 'laowang', password: '123456', grantType: 'PASSWORD' } });
    const media = response.cookies.find((c) => c.startsWith('video_media=')).split(';')[0];
    const source = await get('/videos/1/source', { headers: { Cookie: media, Range: 'bytes=0-31' } });
    ok(source, 206);
    const me = await get('/users/me', { headers: { Cookie: media } });
    ok(me, 401);
    return '源文件 206 / 其他接口 401';
  });
  await check('登出清除两个 Cookie 且旧令牌立即失效', async () => {
    const session = await post('/auth/login', { body: { account: 'newbie', password: '123456', grantType: 'PASSWORD' } });
    const token = data(session).accessToken;
    const logout = await post('/auth/logout', { token });
    ok(logout);
    assert(
      logout.cookies.some((c) => c.startsWith('video_refresh=') && /Max-Age=0/i.test(c)),
      'video_refresh 未清除',
    );
    assert(logout.cookies.some((c) => c.startsWith('video_media=') && /Max-Age=0/i.test(c)), 'video_media 未清除');
    const me = await get('/users/me', { token });
    ok(me, 401);
    return 'Cookie 清除 + 令牌吊销（401）';
  });

  /* --------------------------------------------------------- BUG-02 计数一致 */
  section('BUG-02 互动计数自洽');
  const likeBaseline = data(await get('/videos/1')).stats.likes;
  await check('点赞后计数 +1，不再塌陷为真实记录数', async () => {
    const liked = await post('/videos/1/like', { token: creator, body: { action: 'LIKE' } });
    ok(liked);
    const after = data(await get('/videos/1')).stats.likes;
    assert(after === likeBaseline + 1, `点赞后 ${likeBaseline} → ${after}`);
    const repeated = await post('/videos/1/like', { token: creator, body: { action: 'LIKE' } });
    assert(data(repeated).count === after, '重复点赞不是幂等');
    return `${likeBaseline} → ${after}（重复点赞保持 ${after}）`;
  });
  await check('取消点赞回到基线', async () => {
    const unliked = await post('/videos/1/like', { token: creator, body: { action: 'UNLIKE' } });
    ok(unliked);
    const after = data(await get('/videos/1')).stats.likes;
    assert(after === likeBaseline, `取消后应为 ${likeBaseline}，实际 ${after}`);
    return `回到 ${after}`;
  });
  await check('收藏计数与收藏夹成员关系一致', async () => {
    // 种子数据里创作者已经收藏过 2 号视频：先把状态归一到「未收藏」，再验证 +1 / -1 往返。
    if (data(await get('/videos/2', { token: creator })).favorited) {
      ok(await post('/videos/2/favorite', { token: creator, body: { action: 'UNFAVORITE' } }));
    }
    const before = data(await get('/videos/2', { token: creator })).stats.favorites;
    ok(await post('/videos/2/favorite', { token: creator, body: { action: 'FAVORITE' } }));
    const after = data(await get('/videos/2', { token: creator })).stats.favorites;
    assert(after === before + 1, `收藏后 ${before} → ${after}`);
    const favorites = data(await get('/videos/favorites?page=1&pageSize=50', { token: creator }));
    const ids = (favorites.items ?? []).map((item) => item.id ?? item.video?.id);
    assert(ids.includes(2), '收藏夹列表未包含该视频');
    ok(await post('/videos/2/favorite', { token: creator, body: { action: 'UNFAVORITE' } }));
    assert(data(await get('/videos/2', { token: creator })).stats.favorites === before, '取消收藏未回到基线');
    return `${before} → ${after} → ${before}，收藏夹同步`;
  });
  await check('并发重复收藏只产生一条记录', async () => {
    if (data(await get('/videos/2', { token: creator })).favorited) {
      ok(await post('/videos/2/favorite', { token: creator, body: { action: 'UNFAVORITE' } }));
    }
    const before = data(await get('/videos/2', { token: creator })).stats.favorites;
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => post('/videos/2/favorite', { token: creator, body: { action: 'FAVORITE' } })),
    );
    assert(responses.every((r) => r.status === 200), '并发收藏出现失败请求');
    const after = data(await get('/videos/2', { token: creator })).stats.favorites;
    assert(after === before + 1, `并发收藏后计数应为 ${before + 1}，实际 ${after}`);
    ok(await post('/videos/2/favorite', { token: creator, body: { action: 'UNFAVORITE' } }));
    return `12 并发 → +1（${after}）`;
  });
  await check('评论计数 = 可见评论数（主楼 + 楼中楼都计入）', async () => {
    const before = data(await get('/videos/1')).stats.comments;
    const created = await post('/videos/1/comments', { token: creator, body: { content: `计数校验 ${Date.now()}` } });
    ok(created);
    const commentId = data(created).id;
    ok(await post(`/comments/${commentId}/reply`, { token: admin, body: { content: '楼中楼校验' } }));
    const after = data(await get('/videos/1')).stats.comments;
    assert(after === before + 2, `主楼 + 回复应 +2：${before} → ${after}`);
    const list = data(await get('/videos/1/comments?sort=new&page=1&pageSize=50'));
    const row = list.items.find((item) => item.id === commentId);
    assert(row, '评论列表缺少新评论');
    assert(row.replyCount === 1, `楼层回复数应为 1，实际 ${row.replyCount}`);
    return `${before} → ${after}（主楼 replyCount=${row.replyCount}）`;
  });
  await check('动态点赞计数与真实点赞一致', async () => {
    const before = data(await get('/feeds/1')).stats.likes;
    const liked = await post('/feeds/1/like', { token: creator, body: { action: 'LIKE' } });
    assert(data(liked).count === before + 1, `动态点赞 ${before} → ${data(liked).count}`);
    ok(await post('/feeds/1/like', { token: creator, body: { action: 'UNLIKE' } }));
    assert(data(await get('/feeds/1')).stats.likes === before, '取消动态点赞未回到基线');
    return `${before} → ${before + 1} → ${before}`;
  });
  await check('动态转发计数随转发与删除同步', async () => {
    const before = data(await get('/feeds/1')).stats.reposts;
    const created = await post('/feeds', { token: creator, body: { content: `转发校验 ${Date.now()}`, repostOfId: 1 } });
    const repostId = data(created).id;
    assert(data(await get('/feeds/1')).stats.reposts === before + 1, '转发后计数未 +1');
    ok(await del(`/feeds/${repostId}`, { token: creator }));
    assert(data(await get('/feeds/1')).stats.reposts === before, '删除转发后计数未回落');
    return `${before} → ${before + 1} → ${before}`;
  });

  /* ------------------------------------------------------------- BUG-03 评论 */
  section('BUG-03 删除回复后列表同步');
  await check('删除楼中楼后回复列表与该楼层回复数同步', async () => {
    const parent = data(await post('/videos/1/comments', { token: creator, body: { content: `楼主 ${Date.now()}` } }));
    const reply = data(await post(`/comments/${parent.id}/reply`, { token: admin, body: { content: '待删除的回复' } }));
    const before = data(await get(`/comments/${parent.id}/replies?page=1&pageSize=20`));
    assert(before.items.some((item) => item.id === reply.id), '回复未出现在列表');
    ok(await del(`/comments/${reply.id}`, { token: admin }));
    const after = data(await get(`/comments/${parent.id}/replies?page=1&pageSize=20`));
    assert(!after.items.some((item) => item.id === reply.id), '删除后回复仍在列表');
    const refreshed = data(await get('/videos/1/comments?sort=new&page=1&pageSize=50'));
    const parentRow = refreshed.items.find((item) => item.id === parent.id);
    assert((parentRow?.replyCount ?? 0) === 0, `楼层回复数未归零：${parentRow?.replyCount}`);
    return `回复删除后列表与 replyCount 同步（${before.items.length} → ${after.items.length}）`;
  });

  /* ------------------------------------------------------------- BUG-04 举报 */
  section('BUG-04 举报补充说明落库并可读');
  const reportText = `回归说明 ${Date.now()}\n联系方式：qa@example.com`;
  await check('举报说明与联系方式写入并在后台可读', async () => {
    const created = await post('/reports', {
      token: creator,
      body: { targetType: 'VIDEO', targetId: 1, reason: 'SPAM', description: reportText },
    });
    ok(created);
    const reportId = data(created).reportId;
    const queue = data(await get('/admin/reports?page=1&pageSize=50', { token: admin }));
    const row = queue.items.find((item) => item.id === reportId);
    assert(row, '后台举报队列缺少该举报');
    assert(row.description === reportText, `说明不一致：${row.description}`);
    return `#${reportId} 说明完整回读`;
  });

  /* --------------------------------------------------------- SEC-02 限流加固 */
  section('SEC-02 失败预算');
  await check('连续 5 次密码错误后第 6 次返回 429', async () => {
    const account = `rateprobe${Date.now() % 100000}`;
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      const response = await post('/auth/login', { body: { account, password: 'wrong-password' } });
      statuses.push(response.status);
    }
    assert(statuses.slice(0, 5).every((s) => s === 401), `前 5 次应 401：${statuses}`);
    assert(statuses[5] === 429, `第 6 次应 429：${statuses}`);
    return statuses.join(',');
  });
  await check('短信验证码校验（登录与重置）按手机号限流', async () => {
    const phone = `139${String(Date.now()).slice(-8)}`;
    const sms = [];
    for (let i = 0; i < 6; i += 1) {
      sms.push(
        (await post('/auth/login', {
          body: { grantType: 'SMS', phone, account: `rotate-${i}`, code: '000000' },
        })).status,
      );
    }
    assert(sms[5] === 429, `短信登录第 6 次应 429：${sms}`);
    const reset = [];
    for (let i = 0; i < 6; i += 1) {
      reset.push(
        (await post('/auth/password/reset', { body: { phone, code: '000000', password: 'new-password-123' } })).status,
      );
    }
    assert(reset[5] === 429, `重置密码第 6 次应 429：${reset}`);
    return `sms=[${sms}] reset=[${reset}]`;
  });
  await check('一个账号被限流不影响同 IP 的其他账号', async () => {
    const blocked = await post('/auth/login', { body: { account: 'laowang', password: 'wrong-password' } });
    assert(blocked.status === 401, `首次错误密码应 401：${blocked.status}`);
    await login('newbie');
    await login('laowang');
    return 'newbie / laowang 仍可登录';
  });

  /* ------------------------------------------------------------ SEC-03 头部 */
  section('SEC-03 安全响应头');
  await check('接口响应带 CSP / nosniff / frame-options', async () => {
    const response = await get('/videos/1');
    const csp = response.headers.get('content-security-policy') ?? '';
    assert(csp.includes("default-src 'none'"), `接口 CSP 异常：${csp}`);
    assert(response.headers.get('x-content-type-options') === 'nosniff', '缺少 nosniff');
    assert(response.headers.get('x-frame-options'), '缺少 X-Frame-Options');
    // HSTS 只在安全连接上有意义：Spring Security 对明文请求不发送该头（浏览器也会忽略）。
    // 因此这里断言「明文不发送」，HTTPS 下发送由 ReportRegressionTest 的 secure 请求用例覆盖。
    assert(!response.headers.get('strict-transport-security'), '明文 HTTP 不应发送 HSTS');
    return 'CSP + nosniff + X-Frame-Options（HSTS 仅 HTTPS）';
  });
  await check('开发文档不被接口级严格 CSP 打白屏', async () => {
    const response = await get(`${BASE}/v3/api-docs`);
    ok(response);
    const csp = response.headers.get('content-security-policy') ?? '';
    assert(!csp.includes("default-src 'none'"), `文档页 CSP 过严：${csp}`);
    return csp || '（仅 frame-ancestors）';
  });

  /* ----------------------------------------------------------- SEC-04 语义 */
  section('SEC-04 状态码语义');
  await check('集合路径未匹配返回 404 而非 500', async () => {
    ok(await get('/videos'), 404);
    return 'GET /videos → 404';
  });
  await check('超大 pageSize 返回 400 而非 500', async () => {
    ok(await get('/videos/recommend?pageSize=99999'), 400);
    return 'pageSize=99999 → 400';
  });
  await check('损坏 JSON 与非法参数返回 400', async () => {
    ok(await post('/videos/1/like', { token: creator, raw: '{not-json', headers: { 'Content-Type': 'application/json' } }), 400);
    ok(await get('/videos/abc'), 400);
    const missing = await get('/videos/999999');
    assert([404].includes(missing.status), `不存在的视频应为 404：${missing.status}`);
    return '损坏 JSON 400 / 非法路径参数 400 / 不存在资源 404';
  });

  /* ------------------------------------------------------------- 接口普查 */
  section('接口普查（真实数据）');
  const publicEndpoints = [
    '/categories',
    '/videos/recommend?pageSize=5',
    '/videos/ranking?type=hot&period=daily',
    '/videos/ranking?type=trend&period=weekly',
    '/videos/ranking?type=newcomer&period=monthly',
    '/videos/search?q=%E5%85%89%E5%BD%B1&pageSize=5',
    '/videos/shorts?pageSize=5',
    '/videos/1',
    '/videos/1/related',
    '/videos/1/comments?sort=hot',
    '/videos/1/play',
    '/feeds?pageSize=5',
    '/feeds/1',
    '/feeds/1/comments',
    '/users/3',
    '/users/3/videos',
    '/users/3/followers',
    '/notifications/unread-count',
  ];
  for (const endpoint of publicEndpoints) {
    await check(`GET ${endpoint}`, async () => {
      const response = await get(endpoint);
      ok(response);
      assert(response.json?.code === 0, `业务码异常：${response.json?.code} ${response.json?.message ?? ''}`);
      return '';
    });
  }
  const authedEndpoints = [
    '/users/me',
    '/notifications?page=1',
    '/videos/history?page=1',
    '/videos/favorites?page=1',
    '/videos/playlists',
    '/creator/dashboard',
    '/messages/conversations',
  ];
  for (const endpoint of authedEndpoints) {
    await check(`GET ${endpoint}（登录）`, async () => {
      const response = await get(endpoint, { token: creator });
      ok(response);
      assert(response.json?.code === 0, `业务码异常：${response.json?.code}`);
      return '';
    });
  }
  const adminEndpoints = ['/admin/overview', '/admin/users', '/admin/videos', '/admin/reviews', '/admin/reports', '/admin/audit-logs', '/admin/settings'];
  for (const endpoint of adminEndpoints) {
    await check(`GET ${endpoint}（管理员）`, async () => {
      const response = await get(endpoint, { token: admin });
      ok(response);
      assert(response.json?.code === 0, `业务码异常：${response.json?.code}`);
      return '';
    });
  }
  await check('普通用户访问管理接口被拒（403）', async () => {
    ok(await get('/admin/overview', { token: creator }), 403);
    return '403';
  });

  /* ------------------------------------------------------------- 上传闭环 */
  section('上传闭环（分片直传 → 合并 → 审核 → 播放 → 进度）');
  let uploadedVideoId = null;
  // 在 mdat 载荷里按随机 nonce 改几个字节：内容仍是合法 MP4，但每次运行的 SHA-256 都不同，
  // 因此走真实的「分片上传 → 合并 → 哈希校验」路径，而不是命中秒传。
  const uploadBytes = Buffer.from(sampleBytes);
  const payloadAt = uploadBytes.indexOf('mdat');
  assert(payloadAt > 0, '样本文件缺少 mdat');
  const nonce = randomBytes(8);
  for (let i = 0; i < nonce.length; i += 1) uploadBytes[payloadAt + 16 + i] ^= nonce[i];
  await check('分片上传、合并与 SHA-256 校验闭环', async () => {
    const sha = createHash('sha256').update(uploadBytes).digest('hex');
    const init = await post('/uploads/init', {
      token: creator,
      body: {
        fileName: 'e2e-sample.mp4',
        sha256: sha,
        title: `E2E 上传校验 ${Date.now()}`,
        description: '报告回归脚本上传',
        fileSize: uploadBytes.length,
        categoryId: 1,
        videoType: 'LONG',
        visibility: 'PUBLIC',
        duration: 0,
        tags: ['e2e'],
      },
    });
    ok(init);
    const session = data(init);
    assert(!session.instant, '内容唯一的上传不应命中秒传');
    for (const part of session.parts) {
      const target = part.url.startsWith('http') ? part.url : `${BASE}${part.url}`;
      // 签名 URL 不需要 Bearer，但写操作仍需带 CSRF 标记头（与浏览器直传行为一致）。
      const response = await fetch(target, {
        method: 'PUT',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body: uploadBytes,
      });
      assert(response.status === 200, `分片 ${part.partNumber} 上传失败：${response.status}`);
    }
    const complete = await post(`/uploads/${session.uploadId}/complete`, {
      token: creator,
      headers: { 'Idempotency-Key': `e2e-${session.uploadId}` },
      body: { parts: session.parts.map((part) => ({ partNumber: part.partNumber, etag: `etag-${session.uploadId}-${part.partNumber}` })) },
    });
    ok(complete);
    uploadedVideoId = data(complete).videoId;
    assert(data(complete).status === 'PROCESSING', `合并后状态异常：${data(complete).status}`);
    return `uploadId=${session.uploadId} → videoId=${uploadedVideoId}（${session.parts.length} 个分片）`;
  });
  await check('上传的源文件可播放且内容一致', async () => {
    assert(uploadedVideoId, '前置上传未完成');
    const response = await get(`/videos/${uploadedVideoId}/source`, { token: creator });
    ok(response);
    assert(response.buffer.equals(uploadBytes), '上传后源文件字节与上传内容不一致');
    return `${response.buffer.length} 字节一致`;
  });
  await check('duration 缺失时播放进度照常保存（续播不丢）', async () => {
    assert(uploadedVideoId, '前置上传未完成');
    const saved = await post(`/videos/${uploadedVideoId}/progress`, { token: creator, body: { progress: 7 } });
    ok(saved);
    assert(data(saved).progress === 7, `进度被压缩为 ${data(saved).progress}`);
    const again = await post(`/videos/${uploadedVideoId}/progress`, { token: creator, body: { progress: 11 } });
    assert(data(again).progress === 11, `续写进度失败：${data(again).progress}`);
    return 'progress=7 → 11 均原样保存';
  });
  await check('转码进度轮询到完成并生成审核任务', async () => {
    assert(uploadedVideoId, '前置上传未完成');
    let status = '';
    let lastProbe = null;
    for (let i = 0; i < 12 && status !== 'SUCCESS'; i += 1) {
      lastProbe = await get(`/transcode/${uploadedVideoId}/progress`);
      assert(
        lastProbe.json?.data,
        `转码进度接口异常：HTTP ${lastProbe.status} ${JSON.stringify(lastProbe.json)}`,
      );
      status = lastProbe.json.data.status;
    }
    assert(status === 'SUCCESS', `转码未完成：${status}（${JSON.stringify(lastProbe?.json?.data)}）`);
    const detailResponse = await get(`/videos/${uploadedVideoId}`, { token: creator });
    assert(detailResponse.json?.data, `视频详情异常：HTTP ${detailResponse.status} ${JSON.stringify(detailResponse.json)}`);
    assert(detailResponse.json.data.status === 'REVIEWING', `转码完成后状态应为 REVIEWING，实际 ${detailResponse.json.data.status}`);
    return '转码 SUCCESS，视频进入 REVIEWING';
  });
  await check('审核通过后进入公开推荐流与观看历史', async () => {
    assert(uploadedVideoId, '前置上传未完成');
    const queue = data(await get('/admin/reviews?status=PENDING&page=1&pageSize=50', { token: admin }));
    const task = queue.items.find((item) => (item.videoId ?? item.video?.id) === uploadedVideoId);
    assert(task, '审核队列缺少该视频');
    const decision = await post(`/admin/reviews/${task.id}/decision`, {
      token: admin,
      headers: { 'Idempotency-Key': `e2e-review-${task.id}` },
      body: { decision: 'APPROVE', note: '端到端校验通过' },
    });
    ok(decision);
    const detail = data(await get(`/videos/${uploadedVideoId}`));
    assert(detail.status === 'PUBLISHED', `审核后状态为 ${detail.status}`);
    const history = data(await get('/videos/history?page=1&pageSize=50', { token: creator }));
    const row = history.items.find((item) => (item.id ?? item.video?.id) === uploadedVideoId);
    assert(row, '观看历史缺少该视频');
    assert(row.progress === 11, `历史中的进度应为 11，实际 ${row.progress}`);
    return `review ${task.id} → PUBLISHED，历史进度 ${row.progress}`;
  });

  /* ------------------------------------------------------------------ 汇总 */
  const failed = results.filter((item) => !item.ok);
  console.log(`\n═══ 汇总：${results.length - failed.length}/${results.length} 通过 ═══`);
  if (failed.length) {
    console.log('失败项：');
    for (const item of failed) console.log(`  ✗ [${item.group}] ${item.name} — ${item.detail}`);
  }
  return failed.length === 0 ? 0 : 1;
}

run()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`脚本执行失败：${error.stack ?? error.message}`);
    process.exit(1);
  });
