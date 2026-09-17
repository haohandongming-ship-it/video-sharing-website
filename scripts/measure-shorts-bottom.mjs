// 测量短视频底部控制区是否溢出视口（输入框/发送按钮必须完整可见）。
//   node scripts/measure-shorts-bottom.mjs [baseUrl] [高度]
const base = process.argv[2] ?? 'http://localhost:5173';
const height = Number(process.argv[3] ?? 900);
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const { writeFileSync } = await import('node:fs');

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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height, deviceScaleFactor: 1, mobile: false }, sessionId);

for (let i = 0; i < 20; i++) {
  await sleep(1000);
  if (await evalJs(`!!document.querySelector('input[aria-label="弹幕内容"]')`, sessionId)) break;
}

console.log(`=== 视口高度 ${height} ===`);
console.log(await evalJs(`(() => {
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
  // 控制栏：倍速按钮所在的那一行（按钮组），取其父容器
  const speed = document.querySelector('button[aria-label="播放速度"]');
  const row = speed ? speed.parentElement : null;
  const controlBar = row ? row.parentElement : null;
  // 信息区：包含作者链接的浮层（排除控制栏内部）
  const info = [...document.querySelectorAll('div.absolute')]
    .filter(d => !d.contains(speed))
    .find(d => d.querySelector('a[href^="/user/"]'));
  const cb = rect(controlBar); const ib = rect(info);
  return JSON.stringify({
    视口高: window.innerHeight,
    控制栏: cb,
    信息区: ib,
    控制栏完整可见: cb ? cb.bottom <= window.innerHeight : null,
    信息区在控制栏上方: cb && ib ? ib.bottom <= cb.top + 1 : null,
    两者重叠: cb && ib ? ib.bottom > cb.top && ib.top < cb.bottom : null,
  }, null, 1);
})()`, sessionId));

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync(`gui-test-screenshots/shorts-bottom-${height}.png`, Buffer.from(data, 'base64'));
console.log(`截图: gui-test-screenshots/shorts-bottom-${height}.png`);

await send('Target.closeTarget', { targetId });
ws.close();
