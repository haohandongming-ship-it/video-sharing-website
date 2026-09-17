// 截取短视频底部区域（放大查看控制栏细节）。
//   node scripts/shot-shorts-bottom.mjs [baseUrl]
const base = process.argv[2] ?? 'http://localhost:5173';
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

const { targetId } = await send('Target.createTarget', { url: `${base}/shorts` });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false }, sessionId);
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  if (await evalJs(`!!document.querySelector('button[aria-label="播放速度"]')`, sessionId)) break;
}

// 底部区域：控制栏 + 信息卡
const { data } = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: 340, y: 690, width: 780, height: 210, scale: 2 },
}, sessionId);
writeFileSync('gui-test-screenshots/shorts-bottom-zoom.png', Buffer.from(data, 'base64'));
console.log('截图: gui-test-screenshots/shorts-bottom-zoom.png（底部区域 2 倍放大）');

// 打开弹幕输入再截一张
await evalJs(`document.querySelector('button[aria-label="发弹幕"]')?.click()`, sessionId);
await sleep(900);
const { data: data2 } = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: 340, y: 560, width: 780, height: 340, scale: 2 },
}, sessionId);
writeFileSync('gui-test-screenshots/shorts-danmaku-popover.png', Buffer.from(data2, 'base64'));
console.log('截图: gui-test-screenshots/shorts-danmaku-popover.png（弹幕输入浮层）');

await send('Target.closeTarget', { targetId });
ws.close();
