// 验证点击清晰度档位后，HLS 是否真的切到对应码率（观察视频元素尺寸与分片请求变化）。
//   node scripts/verify-quality-switch.mjs [baseUrl]
const base = process.argv[2] ?? 'http://localhost:5173';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let nextId = 1; const pending = new Map();
let segmentLog = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
  if (m.method === 'Network.requestWillBeSent') {
    const u = m.params?.request?.url ?? '';
    const seg = u.match(/seg_(\d+)_\d+\.m4s/);
    if (seg) segmentLog.push(seg[1]);
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
await sleep(7000);

/** 读取当前解码分辨率：hls.js 会设置 video 的属性，用播放中的画面尺寸近似 */
const readState = `JSON.stringify({
  固有尺寸: (() => { const v = document.querySelector('video'); return v ? v.videoWidth + 'x' + v.videoHeight : null; })(),
  清晰度按钮文字: document.querySelector('button[aria-label="清晰度"]')?.innerText.trim(),
})`;

console.log('=== 切换前 ===');
console.log(' ', await evalJs(readState, sessionId));

// 逐档读取实际映射到的码率，再点最低档，确认真的降码率
await evalJs(`document.querySelector('button[aria-label="清晰度"]')?.click()`, sessionId);
await sleep(1000);
const mapping = await evalJs(`(() => {
  const menu = document.querySelector('[role="menu"]');
  if (!menu) return 'no-menu';
  return [...menu.querySelectorAll('[role="menuitem"]')].map(b => {
    const spans = b.querySelectorAll('span > span');
    return (spans[0]?.textContent?.trim() ?? '?') + ' → ' + (spans[1]?.textContent?.trim() ?? '');
  }).join(' | ');
})()`, sessionId);
console.log('\n档位映射:', mapping);

// 点最低档（流量优先），它应映射到最低码率
segmentLog = [];
const picked = await evalJs(`(() => {
  const menu = document.querySelector('[role="menu"]');
  const items = [...menu.querySelectorAll('[role="menuitem"]')];
  const item = items[items.length - 1];
  if (!item) return 'no-option';
  const label = item.innerText.trim();
  item.click();
  return 'clicked: ' + label;
})()`, sessionId);
console.log('\n点击最低档:', picked);
await sleep(9000);

console.log('\n=== 切换后 ===');
console.log(' ', await evalJs(readState, sessionId));
console.log('\n=== 切换后新请求的分片 ===');
const after = [...new Set(segmentLog)];
console.log('  分片档位:', after.join(', ') || '(无新分片)');
console.log('  360 = 360p / 540 = 540p / 720 = 720p 分片');

await send('Target.closeTarget', { targetId });
ws.close();
