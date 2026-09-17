// 几何对照：测量菜单与触发按钮的相对位置，证明菜单在按钮「上方」且不越视口。
const base = process.argv[2] ?? 'http://localhost:5173';
const videoId = process.argv[3] ?? '5';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';

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

for (const label of ['播放速度', '清晰度']) {
  await evalJs(`document.body.click()`, sessionId);
  await sleep(400);
  await evalJs(`document.querySelector('button[aria-label="${label}"]')?.click()`, sessionId);
  await sleep(900);
  console.log(`\n=== ${label} ===`);
  console.log(await evalJs(`(() => {
    const btn = document.querySelector('button[aria-label="${label}"]');
    const menu = document.querySelector('[role="menu"]');
    if (!btn || !menu) return JSON.stringify({ ok: false });
    const b = btn.getBoundingClientRect(), m = menu.getBoundingClientRect();
    return JSON.stringify({
      按钮: { top: Math.round(b.top), bottom: Math.round(b.bottom) },
      菜单: { top: Math.round(m.top), bottom: Math.round(m.bottom) },
      菜单在按钮上方: m.bottom <= b.top + 1,
      与按钮间距: Math.round(b.top - m.bottom),
      菜单完整在视口内: m.top >= 0 && m.bottom <= window.innerHeight,
      下方溢出像素: Math.round(Math.max(0, m.bottom - window.innerHeight)),
      选项数: menu.querySelectorAll('[role="menuitem"]').length,
    }, null, 1);
  })()`, sessionId));
}

await send('Target.closeTarget', { targetId });
ws.close();
