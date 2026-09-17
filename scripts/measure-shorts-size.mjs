// 测量短视频列与视频元素的实际尺寸，用于调整屏幕占比。
//   node scripts/measure-shorts-size.mjs [baseUrl] [视口宽] [视口高]
const base = process.argv[2] ?? 'http://localhost:5173';
const width = Number(process.argv[3] ?? 1440);
const height = Number(process.argv[4] ?? 900);
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let nextId = 1; const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
});
const send = (method, params = {}, sid) => new Promise((r, j) => { const id = nextId++; pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify(sid ? { id, method, params, sessionId: sid } : { id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr, sid) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.value;

const { targetId } = await send('Target.createTarget', { url: `${base}/shorts` });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  if (await evalJs(`!!document.querySelector('video')`, sessionId)) break;
}

console.log(`=== 视口 ${width}x${height} ===`);
console.log(await evalJs(`(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), 占视口宽: Math.round((r.width / window.innerWidth) * 100) + '%' };
  };
  const shell = document.querySelector('div.flex.size-full.bg-black');
  const stage = shell ? shell.firstElementChild : null;
  const video = document.querySelector('video');
  const cs = video ? getComputedStyle(video) : null;
  return JSON.stringify({
    视口: { w: window.innerWidth, h: window.innerHeight },
    视频列: box(stage),
    video元素: box(video),
    视频固有尺寸: video ? { w: video.videoWidth, h: video.videoHeight } : null,
    objectFit: cs ? cs.objectFit : null,
    显示尺寸: cs ? { width: cs.width, height: cs.height } : null,
    父容器: video && video.parentElement ? box(video.parentElement) : null,
  }, null, 1);
})()`, sessionId));

await send('Target.closeTarget', { targetId });
ws.close();
