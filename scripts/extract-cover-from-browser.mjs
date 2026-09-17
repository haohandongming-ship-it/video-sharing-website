// 通过 CDP 调用前端真实的 captureFrame，把产出的封面字节写到磁盘，
// 供 verify-cover-api.mjs 用作「浏览器真实产物」的封面输入。
//   node scripts/extract-cover-from-browser.mjs <输出路径> [视频URL] [baseUrl]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'test-artifacts/cover-from-browser.webp');
const videoUrl = process.argv[3] ?? 'http://localhost:5173/upload-valid.mp4';
const base = process.argv[4] ?? 'http://localhost:5173';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let nextId = 1; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); } });
const send = (method, params = {}, sid) => new Promise((r, j) => { const id = nextId++; pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify(sid ? { id, method, params, sessionId: sid } : { id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { targetId } = await send('Target.createTarget', { url: `${base}/upload` });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await sleep(4000);

const r = await send('Runtime.evaluate', {
  expression: `(async () => {
    const mod = await import('/src/features/upload/uploadEngine.ts');
    const res = await fetch('${videoUrl}');
    const blob = await res.blob();
    const file = new File([blob], 'probe.mp4', { type: 'video/mp4' });
    const cover = await mod.captureFrame(file, 1);
    return cover;
  })()`,
  returnByValue: true,
  awaitPromise: true,
}, sessionId);

const dataUrl = r.result.value;
if (!dataUrl || !dataUrl.startsWith('data:image/')) {
  console.error('抓帧失败:', dataUrl);
  process.exit(1);
}
const [meta, b64] = dataUrl.split(',');
writeFileSync(out, Buffer.from(b64, 'base64'));
console.log(`封面已写出: ${out}`);
console.log(`格式: ${meta}`);
console.log(`字节: ${Buffer.from(b64, 'base64').length}`);

await send('Target.closeTarget', { targetId });
ws.close();
