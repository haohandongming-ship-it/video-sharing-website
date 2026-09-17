// 检查播放器菜单的实际可见性（计算样式），并在全屏场景下复测溢出——
// 用户描述的正是「播放长视频时」菜单超出屏幕，全屏是最严苛的场景。
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

async function inspect(label) {
  const opened = await evalJs(`(() => {
    const b = document.querySelector('button[aria-label="播放速度"]');
    if (!b) return 'no-button';
    b.click();
    return 'ok';
  })()`, sessionId);
  await sleep(1000);
  const info = await evalJs(`(() => {
    const m = document.querySelector('[role="menu"]');
    if (!m) return JSON.stringify({ found: false });
    const cs = getComputedStyle(m);
    const r = m.getBoundingClientRect();
    // 找出遮挡它的祖先/自身是否被裁剪
    let clippedBy = null;
    let el = m.parentElement;
    while (el) {
      const s = getComputedStyle(el);
      if (/(hidden|clip|auto|scroll)/.test(s.overflow + s.overflowY)) {
        const pr = el.getBoundingClientRect();
        if (r.bottom > pr.bottom + 1 || r.top < pr.top - 1) clippedBy = el.className.toString().slice(0, 60);
      }
      el = el.parentElement;
    }
    return JSON.stringify({
      found: true, open: '${opened}',
      opacity: cs.opacity, visibility: cs.visibility, display: cs.display, zIndex: cs.zIndex,
      transform: cs.transform,
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      viewportH: window.innerHeight,
      overflowBottom: Math.round(Math.max(0, r.bottom - window.innerHeight)),
      clippedBy,
      itemCount: m.querySelectorAll('[role="menuitem"]').length,
    }, null, 1);
  })()`, sessionId);
  console.log(`\n=== ${label} ===`);
  console.log(info);
  return JSON.parse(info);
}

await inspect('普通模式');

// 进入全屏：用户描述的「播放长视频超出屏幕」最可能发生在全屏
const fs = await evalJs(`(() => {
  const b = document.querySelector('button[aria-label="全屏"]');
  if (!b) return 'no-fullscreen-button';
  b.click();
  return 'clicked';
})()`, sessionId);
console.log('\n全屏按钮:', fs);
await sleep(2500);
console.log('全屏状态:', await evalJs(`JSON.stringify({ fullscreenElement: !!document.fullscreenElement, vh: window.innerHeight })`, sessionId));

await inspect('全屏模式');

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('gui-test-screenshots/player-fullscreen-menu.png', Buffer.from(data, 'base64'));
console.log('\n截图: gui-test-screenshots/player-fullscreen-menu.png');

await send('Target.closeTarget', { targetId });
ws.close();
