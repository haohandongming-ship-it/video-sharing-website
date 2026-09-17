// 验证短视频清晰度是否真正可切换（多码率 HLS）。
//   node scripts/verify-shorts-quality.mjs [baseUrl]
const base = process.argv[2] ?? 'http://localhost:5173';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const { writeFileSync } = await import('node:fs');

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let nextId = 1; const pending = new Map();
const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description?.split('\n')[0] ?? 'exception');
});
const send = (method, params = {}, sid) => new Promise((r, j) => { const id = nextId++; pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify(sid ? { id, method, params, sessionId: sid } : { id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr, sid) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.value;

// 记录所有 HLS 分片请求，确认播放器真的在拉多码率流
await send('Network.enable', {}, undefined).catch(() => {});
const requests = [];

const { targetId } = await send('Target.createTarget', { url: `${base}/shorts` });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Network.enable', {}, sessionId);
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Network.requestWillBeSent' && m.sessionId === sessionId) {
    const u = m.params?.request?.url ?? '';
    if (u.includes('/demo/hls/')) requests.push(u.split('/demo/hls/')[1]);
  }
});
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

for (let i = 0; i < 25; i++) {
  await sleep(1000);
  if (await evalJs(`!!document.querySelector('button[aria-label="播放速度"]')`, sessionId)) break;
}
await sleep(6000); // 等 hls.js 解析清单

console.log('=== 当前视频 ===');
console.log(await evalJs(`JSON.stringify({
  标题: document.body.innerText.split('\\n').find(l => l.includes('演示') || l.includes('旅游') || l.includes('修理')) ?? null,
})`, sessionId));

console.log('\n=== 清晰度菜单内容 ===');
await evalJs(`document.querySelector('button[aria-label="清晰度"]')?.click()`, sessionId);
await sleep(1200);
console.log(await evalJs(`(() => {
  const menu = document.querySelector('[role="menu"]');
  if (!menu) return JSON.stringify({ found: false });
  return JSON.stringify(
    [...menu.querySelectorAll('[role="menuitem"]')].map((b) => {
      const spans = b.querySelectorAll('span > span');
      return { 档位: spans[0]?.textContent?.trim(), 说明: spans[1]?.textContent?.trim(), 禁用: b.disabled };
    }), null, 1);
})()`, sessionId));
await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`, sessionId);
await sleep(700);

console.log('\n=== HLS 请求（证明在拉多码率流）===');
const unique = [...new Set(requests)];
console.log('  请求数:', requests.length, ' 去重后:', unique.length);
console.log('  样例:', unique.slice(0, 8).join(', '));
console.log('  含 master:', unique.some((u) => u === 'master.m3u8'));
console.log('  含变体清单:', unique.filter((u) => /^v\d+\.m3u8$/.test(u)).join(', ') || '(无)');

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('gui-test-screenshots/shorts-quality.png', Buffer.from(data, 'base64'));
console.log('\n截图: gui-test-screenshots/shorts-quality.png');
console.log('页面异常:', errors.length ? errors.slice(0, 3).join(' | ') : '(无)');

await send('Target.closeTarget', { targetId });
ws.close();
