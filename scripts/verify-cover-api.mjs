// 走完整的分片上传 API 流程（init → 上传分片 → complete → 轮询转码），
// 并提交一个真实的 WebP 封面，验证「上传时截取的封面」最终写进 videos.cover_url。
//
// 用法：node scripts/verify-cover-api.mjs [baseUrl]
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const VIDEO = process.argv[3] ?? 'test-artifacts/upload-valid.mp4';
const TITLE = process.argv[4] ?? `API封面验证 ${Date.now() % 100000}`;
const API = `${BASE}/api/v1`;

const json = async (path, init = {}) => {
  const res = await fetch(`${API}${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (body.code !== undefined && body.code !== 0) throw new Error(`${path} → ${body.code} ${body.message}`);
  return body.data;
};

// ---- 登录 ----
const login = await json('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
  body: JSON.stringify({ account: 'admin', password: '123456' }),
});
const auth = { Authorization: `Bearer ${login.accessToken}`, 'X-Requested-With': 'XMLHttpRequest' };
console.log('登录成功:', login.user.username);

// ---- 生成一个真实的 WebP 封面（用 canvas 等价的固定字节：这里直接构造最小 WebP 头 + 数据）----
// 为贴近前端产物，用浏览器同款路径不可行（Node 无 canvas），因此提交一个由前一步浏览器
// 实测产出的 WebP 字节：从 /upload-valid.mp4 抓帧得到的封面已保存在 test-artifacts 下。
const coverPath = process.argv[5] ?? 'test-artifacts/cover-from-browser.webp';
let coverBytes;
try {
  coverBytes = readFileSync(coverPath);
} catch {
  console.error(`缺少封面文件 ${coverPath}，请先运行 extract-cover-from-browser.mjs`);
  process.exit(1);
}
console.log(`封面: ${coverBytes.length} 字节, 魔数=${coverBytes.toString('hex', 0, 4)} (RIFF 应为 52494646)`);
const coverDataUrl = `data:image/webp;base64,${coverBytes.toString('base64')}`;

// ---- init ----
const buf = readFileSync(VIDEO);
const sha256 = createHash('sha256').update(buf).digest('hex');
const init = await json('/uploads/init', {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fileName: VIDEO.split(/[\\/]/).pop(),
    fileSize: buf.length,
    sha256,
    videoType: 'SHORT',
    title: TITLE,
    categoryId: 1,
    description: '验证上传截取封面',
    duration: 15,
    coverDataUrl,
  }),
});
console.log(`init: instant=${init.instant} uploadId=${init.uploadId ?? '(秒传)'}`);
if (init.instant) { console.log('命中秒传，无法验证分片路径'); process.exit(0); }

// ---- 上传分片（本地存储模式走带签名的 part 接口）----
for (const part of init.parts) {
  const body = buf.subarray((part.partNumber - 1) * init.partSize, part.partNumber * init.partSize);
  const url = part.url.startsWith('http') ? part.url : `${BASE}${part.url}`;
  const isPresigned = /X-Amz-Signature/.test(url);
  const res = await fetch(url, {
    method: 'PUT',
    headers: isPresigned
      ? { 'Content-Type': 'application/octet-stream' }
      : { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'XMLHttpRequest' },
    body,
  });
  console.log(`  分片 ${part.partNumber}: HTTP ${res.status} (${body.length} 字节, ${isPresigned ? '预签名直传' : '经后端'})`);
  if (!res.ok) throw new Error(`分片上传失败 ${res.status}`);
}
// 本地存储模式：分片接口需要 etag 回填，这里直接调 complete
const done = await json(`/uploads/${init.uploadId}/complete`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ parts: init.parts.map((p) => ({ partNumber: p.partNumber, etag: `etag-${init.uploadId}-${p.partNumber}` })) }),
});
console.log('complete:', JSON.stringify(done));

// ---- 轮询转码，直到完成 ----
let progress;
for (let i = 0; i < 20; i++) {
  progress = await json(`/transcode/${done.videoId}/progress`);
  console.log(`  转码 ${progress.progress}% ${progress.status}`);
  if (progress.status === 'SUCCESS') break;
  await new Promise((r) => setTimeout(r, 500));
}

const detail = await json(`/videos/${done.videoId}`);
console.log('\n=== 最终结果 ===');
console.log('videoId   =', detail.id);
console.log('title     =', detail.title);
console.log('status    =', detail.status);
console.log('coverUrl  =', detail.coverUrl);
console.log('是否真实封面 =', detail.coverUrl && !detail.coverUrl.includes('favicon') ? '是' : '否（仍是占位图）');
process.stdout.write(TITLE);
