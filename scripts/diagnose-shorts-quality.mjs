// 诊断短视频首页当前视频的清晰度档位状态（levels 是否为空、当前 src 是什么）。
//   node scripts/diagnose-shorts-quality.mjs [baseUrl]
const base = process.argv[2] ?? 'http://localhost:5173';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const { writeFileSync } = await import('node:fs');

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let nextId = 1; const pending = new Map();
const hlsReq = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
  if (m.method === 'Network.requestWillBeSent') {
    const u = m.params?.request?.url ?? '';
    if (u.includes('/demo/hls/') || u.includes('/source')) hlsReq.push(u.replace(base, ''));
  }
});
const send = (method, params = {}, sid) => new Promise((r, j) => { const id = nextId++; pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify(sid ? { id, method, params, sessionId: sid } : { id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr, sid) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.value;

const { targetId } = await send('Target.createTarget', { url: `${base}/shorts` });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Network.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

for (let i = 0; i < 25; i++) {
  await sleep(1000);
  if (await evalJs(`!!document.querySelector('button[aria-label="播放速度"]')`, sessionId)) break;
}
await sleep(8000);

console.log('=== 播放器与档位状态 ===');
console.log(await evalJs(`(() => {
  const v = document.querySelector('video');
  return JSON.stringify({
    当前视频URL: v ? v.currentSrc?.slice(0, 120) : null,
    分辨率: v ? v.videoWidth + 'x' + v.videoHeight : null,
    清晰度按钮文字: document.querySelector('button[aria-label="清晰度"]')?.innerText.trim(),
  }, null, 1);
})()`, sessionId));

console.log('\n=== 打开清晰度菜单 ===');
await evalJs(`document.querySelector('button[aria-label="清晰度"]')?.click()`, sessionId);
await sleep(1200);
console.log(await evalJs(`(() => {
  const menu = document.querySelector('[role="menu"]');
  if (!menu) return JSON.stringify({ 菜单: '未出现' });
  return JSON.stringify(
    [...menu.querySelectorAll('[role="menuitem"]')].map((b) => {
      const spans = b.querySelectorAll('span > span');
      return (spans[0]?.textContent?.trim() ?? '?') + ' | ' + (spans[1]?.textContent?.trim() ?? '') + ' | 禁用=' + b.disabled;
    }), null, 1);
})()`, sessionId));

console.log('\n=== 媒体请求 ===');
console.log('  ' + ([...new Set(hlsReq)].join('\n  ') || '(无)'));

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('gui-test-screenshots/diagnose-shorts-quality.png', Buffer.from(data, 'base64'));
console.log('\n截图: gui-test-screenshots/diagnose-shorts-quality.png');

await send('Target.closeTarget', { targetId });
ws.close();
