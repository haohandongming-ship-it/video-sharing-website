// 为「修复前上传」的视频补上真实封面。
//
// 背景：此前前端截取的封面帧从未提交给后端，UploadService 又把 cover_url 写死成
// /favicon.svg，所以那批视频的封面信息在库里根本不存在、无法还原。
// 唯一诚实的做法是从视频本身重新抓一帧作为封面。
//
// 流程：查出封面为占位图的视频 → 浏览器抓帧（复用前端 captureFrame）→
//       通过 POST /api/v1/videos/{id}/cover 以作者身份上传 → 写回 videos.cover_url。
//
// 用法：node scripts/backfill-covers.mjs [baseUrl]
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const BASE = process.argv[2] ?? 'http://localhost:5173';
const CONTAINER = process.env.MYSQL_CONTAINER ?? 'video-sharing-platform-mysql-1';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const query = (sql) => execFileSync('docker', [
  'exec', '-e', `MYSQL_PWD=${env.MYSQL_PASSWORD}`, CONTAINER,
  'mysql', `-u${env.MYSQL_USER}`, '-D', env.MYSQL_DATABASE, '--default-character-set=utf8mb4', '-N', '-B', '-e', sql,
], { encoding: 'utf8' }).split(/\r?\n/).filter((l) => l.trim() !== '');

const rows = query(`
  SELECT v.id, u.username, v.user_id
  FROM videos v JOIN users u ON u.id = v.user_id
  WHERE (v.cover_url IS NULL OR v.cover_url LIKE '%favicon%')
    AND v.status <> 'DELETED'
  ORDER BY v.id;`);
if (rows.length === 0) { console.log('没有需要补封面的视频。'); process.exit(0); }
console.log(`发现 ${rows.length} 个待补封面的视频。`);

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let nextId = 1; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); } });
const send = (method, params = {}, sid) => new Promise((r, j) => { const id = nextId++; pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify(sid ? { id, method, params, sessionId: sid } : { id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { targetId } = await send('Target.createTarget', { url: `${BASE}/` });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await sleep(3500);

let done = 0;
for (const row of rows) {
  const [id, username] = row.split('\t');
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ account: username, password: '123456' }),
  }).then((r) => r.json());
  if (login.code !== 0) { console.log(`  视频 ${id}：${username} 登录失败，跳过`); continue; }
  const token = login.data.accessToken;

  try {
    const dataUrl = (await send('Runtime.evaluate', {
      expression: `(async () => {
        const mod = await import('/src/features/upload/uploadEngine.ts');
        const res = await fetch('/api/v1/videos/${id}/source');
        if (!res.ok) return 'FETCH_' + res.status;
        const blob = await res.blob();
        const file = new File([blob], 'source.mp4', { type: 'video/mp4' });
        return await mod.captureFrame(file, 1);
      })()`,
      returnByValue: true,
      awaitPromise: true,
    }, sessionId)).result.value;

    if (!dataUrl || !String(dataUrl).startsWith('data:image/')) {
      console.log(`  视频 ${id}：抓帧失败（${dataUrl}）`);
      continue;
    }
    const [meta, b64] = String(dataUrl).split(',');
    const ext = /webp/.test(meta) ? 'webp' : 'png';
    const bytes = Buffer.from(b64, 'base64');

    const form = new FormData();
    form.append('file', new Blob([bytes], { type: `image/${ext}` }), `cover.${ext}`);
    const res = await fetch(`${BASE}/api/v1/videos/${id}/cover`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-Requested-With': 'XMLHttpRequest' },
      body: form,
    });
    const body = await res.json();
    if (body.code !== 0) { console.log(`  视频 ${id}：上传封面失败 → ${body.code} ${body.message}`); continue; }
    console.log(`  视频 ${id}（${username}）：${bytes.length} 字节 .${ext} → ${body.data.coverUrl}`);
    done++;
  } catch (err) {
    console.log(`  视频 ${id}：失败 ${err.message}`);
  }
}

console.log(`\n完成 ${done}/${rows.length}。`);
const left = query(`
  SELECT COUNT(*) FROM videos
  WHERE (cover_url IS NULL OR cover_url LIKE '%favicon%') AND status <> 'DELETED';`)[0];
console.log(`仍为占位封面的视频：${left}`);

await send('Target.closeTarget', { targetId });
ws.close();
