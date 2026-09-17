// 验证播放器「清晰度」菜单呈现四档梯度（自动/1080P/720P/480P）及说明文字，
// 并确认选择后写入 playerStore.quality。
const base = process.argv[2] ?? 'http://localhost:5173';
const videoId = process.argv[3] ?? '1';
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

await evalJs(`document.querySelector('button[aria-label="清晰度"]')?.click()`, sessionId);
await sleep(1000);

console.log('=== 清晰度菜单内容 ===');
console.log(await evalJs(`(() => {
  const m = document.querySelector('[role="menu"]');
  if (!m) return JSON.stringify({ found: false });
  const r = m.getBoundingClientRect();
  return JSON.stringify({
    条目: [...m.querySelectorAll('[role="menuitem"]')].map(b => ({
      标题: b.querySelector('span > span')?.textContent?.trim(),
      说明: b.querySelectorAll('span > span')[1]?.textContent?.trim() ?? null,
      选中: b.getAttribute('aria-checked'),
    })),
    溢出下方: Math.round(Math.max(0, r.bottom - window.innerHeight)),
    完整在视口内: r.top >= 0 && r.bottom <= window.innerHeight,
  }, null, 1);
})()`, sessionId));

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('gui-test-screenshots/quality-tiers-menu.png', Buffer.from(data, 'base64'));
console.log('\n截图: gui-test-screenshots/quality-tiers-menu.png');

// 选择 720P，确认写入偏好
await evalJs(`(() => {
  const items = [...document.querySelectorAll('[role="menuitem"]')];
  const target = items.find(b => b.textContent.includes('720P'));
  target?.click();
  return !!target;
})()`, sessionId);
await sleep(1200);
console.log('\n选择 720P 后的偏好:', await evalJs(
  `localStorage.getItem('vs-player-preference')`, sessionId));

await send('Target.closeTarget', { targetId });
ws.close();
