// 单独检测「清晰度」菜单是否溢出（避免与上一个面板的关闭动画互相干扰）。
const base = process.argv[2] ?? 'http://localhost:5173';
const videoId = process.argv[3] ?? '5';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const { writeFileSync } = await import('node:fs');

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let nextId = 1; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); } });
const send = (method, params = {}, sid) => new Promise((r, j) => { const id = nextId++; pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify(sid ? { id, method, params, sessionId: sid } : { id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr, sid) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.value;

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: `${base}/video/${videoId}` }, sessionId);
await sleep(7000);

console.log('控制条按钮清单:', await evalJs(
  `JSON.stringify([...document.querySelectorAll('button[aria-label]')].map(b=>b.getAttribute('aria-label')))`, sessionId));

const TARGET = process.argv[4] ?? '播放速度';
const clicked = await evalJs(`(() => {
  const btn = document.querySelector('button[aria-label="${TARGET}"]');
  if (!btn) return 'not-found';
  btn.click();
  return 'clicked';
})()`, sessionId);
console.log(`${TARGET}按钮:`, clicked);
await sleep(1200);

console.log(`\n=== ${TARGET}菜单位置 ===`);
console.log(await evalJs(`(() => {
  const m = document.querySelector('[role="menu"]');
  if (!m) return JSON.stringify({ found: false, html: document.body.innerHTML.length });
  const r = m.getBoundingClientRect();
  return JSON.stringify({
    found: true, top: Math.round(r.top), bottom: Math.round(r.bottom),
    left: Math.round(r.left), right: Math.round(r.right),
    viewportH: window.innerHeight, viewportW: window.innerWidth,
    overflowBottom: Math.round(Math.max(0, r.bottom - window.innerHeight)),
    overflowTop: Math.round(Math.max(0, -r.top)),
    overflowRight: Math.round(Math.max(0, r.right - window.innerWidth)),
    items: [...m.querySelectorAll('[role="menuitem"]')].map(b => b.textContent.trim()),
  }, null, 1);
})()`, sessionId));

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('gui-test-screenshots/player-menu-open.png', Buffer.from(data, 'base64'));
console.log('\n截图: gui-test-screenshots/player-menu-open.png');

await send('Target.closeTarget', { targetId });
ws.close();
