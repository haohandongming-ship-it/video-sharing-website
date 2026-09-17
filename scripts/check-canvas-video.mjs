// 检查浏览器能否解码测试视频，以及 canvas 是否支持 webp 编码。
const base = process.argv[2] ?? 'http://localhost:5173';
const videoUrl = process.argv[3] ?? 'http://localhost:5173/demo/hls/init_720.mp4';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let nextId = 1; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); } });
const send = (method, params = {}, sid) => new Promise((r, j) => { const id = nextId++; pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify(sid ? { id, method, params, sessionId: sid } : { id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr, sid) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.value;

const { targetId } = await send('Target.createTarget', { url: `${base}/` });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await sleep(3000);

console.log('=== canvas 编码支持 ===');
console.log(await evalJs(`(() => {
  const c = document.createElement('canvas'); c.width = 8; c.height = 8;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#0f0'; ctx.fillRect(0,0,8,8);
  const webp = c.toDataURL('image/webp', 0.8);
  const png = c.toDataURL('image/png');
  return JSON.stringify({ webpPrefix: webp.slice(0, 22), webpSupported: webp.startsWith('data:image/webp'), pngPrefix: png.slice(0, 22) }, null, 1);
})()`, sessionId));

console.log('\n=== 浏览器解码测试视频 ===');
console.log(await evalJs(`(async () => {
  const r = await fetch('${videoUrl}');
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.preload = 'metadata'; v.muted = true;
  const out = await new Promise((resolve) => {
    v.onloadeddata = () => resolve({ ok: true, duration: v.duration, w: v.videoWidth, h: v.videoHeight });
    v.onerror = () => resolve({ ok: false, error: v.error ? v.error.code + ':' + v.error.message : 'unknown' });
    setTimeout(() => resolve({ ok: false, error: 'timeout' }), 8000);
    v.src = url;
  });
  URL.revokeObjectURL(url);
  return JSON.stringify(out);
})()`, sessionId));

await send('Target.closeTarget', { targetId });
ws.close();
