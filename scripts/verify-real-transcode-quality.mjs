// 验证真实上传视频的清晰度切换：观察是否加载转码分片（/videos/<id>/hls/...）。
//   node scripts/verify-real-transcode-quality.mjs [baseUrl]
const base = process.argv[2] ?? 'http://localhost:5173';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const { writeFileSync } = await import('node:fs');

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let nextId = 1; const pending = new Map();
let media = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
  if (m.method === 'Network.requestWillBeSent') {
    const u = m.params?.request?.url ?? '';
    if (u.includes('/hls/')) media.push(u.replace(base, ''));
  }
});
const send = (method, params = {}, sid) => new Promise((r, j) => { const id = nextId++; pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify(sid ? { id, method, params, sessionId: sid } : { id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr, sid) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.value;

const { targetId } = await send('Target.createTarget', { url: `${base}/shorts?v=5` });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Network.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
for (let i = 0; i < 25; i++) {
  await sleep(1000);
  if (await evalJs(`!!document.querySelector('button[aria-label="播放速度"]')`, sessionId)) break;
}
// 等待深链真正切到目标视频（标题出现「旅游」），而不是读到队首的演示视频
let landed = false;
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  const title = await evalJs(`document.body.innerText.includes('旅游')`, sessionId);
  if (title) { landed = true; break; }
}
console.log('深链已定位到目标视频:', landed);
await sleep(6000);

const state = `JSON.stringify({
  标题: (document.body.innerText.match(/旅游|修理系统|实例5|清晰度演示/) ?? ['?'])[0],
  分辨率: (() => { const v = document.querySelector('video'); return v ? v.videoWidth + 'x' + v.videoHeight : null; })(),
  清晰度按钮: document.querySelector('button[aria-label="清晰度"]')?.innerText.trim(),
})`;
console.log('=== 进入时 ===');
console.log(' ', await evalJs(state, sessionId));

const realSegs = [...new Set(media.filter((u) => /\/videos\/5\/hls\//.test(u)))];
console.log('\n=== 该视频的转码请求 ===');
console.log('  数量:', realSegs.length);
realSegs.slice(0, 6).forEach((u) => console.log('   ', u));

console.log('\n=== 切换到 720P ===');
await evalJs(`document.querySelector('button[aria-label="清晰度"]')?.click()`, sessionId);
await sleep(1000);
console.log('  点击:', await evalJs(`(() => {
  const m = document.querySelector('[role="menu"]');
  const it = [...m.querySelectorAll('[role="menuitem"]')].find(b => b.innerText.includes('720P'));
  if (!it) return '未找到 720P';
  it.click(); return 'ok';
})()`, sessionId));
media = [];
await sleep(9000);
console.log(' ', await evalJs(state, sessionId));
const after = [...new Set(media.filter((u) => /\/videos\/5\/hls\/v720p\//.test(u)))];
console.log('  切换后加载 720p 分片数:', after.length);
after.slice(0, 4).forEach((u) => console.log('   ', u));

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('gui-test-screenshots/real-transcode-quality.png', Buffer.from(data, 'base64'));
console.log('\n截图: gui-test-screenshots/real-transcode-quality.png');

await send('Target.closeTarget', { targetId });
ws.close();
