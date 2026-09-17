// 验证播放器控制条上的下拉菜单不溢出视口。
// 打开视频页 → 逐个点击「播放速度」「清晰度」→ 测量菜单与视口的相对位置。
//   node scripts/verify-player-menu.mjs [baseUrl] [videoId]
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
await sleep(6000);

// 让控制条常驻显示（鼠标移到播放器上）
await evalJs(`(() => {
  const v = document.querySelector('video');
  if (v) v.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  const wrap = v ? v.closest('div') : null;
  if (wrap) wrap.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  return true;
})()`, sessionId);
await sleep(800);

const measure = (label) => `(() => {
  const menus = [...document.querySelectorAll('[role="menu"]')];
  const m = menus[menus.length - 1];
  if (!m) return JSON.stringify({ found: false });
  const r = m.getBoundingClientRect();
  return JSON.stringify({
    found: true,
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    left: Math.round(r.left), right: Math.round(r.right),
    height: Math.round(r.height),
    viewportH: window.innerHeight, viewportW: window.innerWidth,
    overflowBottom: Math.round(Math.max(0, r.bottom - window.innerHeight)),
    overflowTop: Math.round(Math.max(0, -r.top)),
    overflowRight: Math.round(Math.max(0, r.right - window.innerWidth)),
    items: [...m.querySelectorAll('[role="menuitem"]')].map(b => b.textContent.trim()).slice(0, 6),
  }, null, 1);
})()`;

for (const [label, ariaLabel] of [['播放速度', '播放速度'], ['清晰度', '清晰度']]) {
  // 关闭已打开的面板
  await evalJs(`document.body.click()`, sessionId);
  await sleep(500);
  const opened = await evalJs(`(() => {
    const btn = document.querySelector('button[aria-label="${ariaLabel}"]');
    if (!btn) return 'not-found';
    btn.click();
    return 'clicked';
  })()`, sessionId);
  await sleep(900);
  console.log(`\n=== ${label}（${opened}）===`);
  console.log(await evalJs(measure(label), sessionId));
}

await send('Target.closeTarget', { targetId });
ws.close();
