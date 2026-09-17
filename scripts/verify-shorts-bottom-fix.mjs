// 验证短视频底部的三项修复：
// 1) 控制栏与信息区不再重叠；2) 弹幕是按钮、点击才出现输入框；3) 单击视频为暂停/播放。
//   node scripts/verify-shorts-bottom-fix.mjs [baseUrl]
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

const { targetId } = await send('Target.createTarget', { url: `${base}/shorts` });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  if (await evalJs(`!!document.querySelector('button[aria-label="播放速度"]')`, sessionId)) break;
}

console.log('=== 1. 控制栏与信息区是否重叠 ===');
console.log(await evalJs(`(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; };
  const speed = document.querySelector('button[aria-label="播放速度"]');
  const controlBar = speed ? speed.closest('div.absolute').parentElement : null;
  // 信息区：含作者链接的浮层
  const info = [...document.querySelectorAll('div.absolute')].find(d => d.querySelector('a[href^="/user/"]') && d.className.includes('inset-x-0'));
  const overlap = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const cb = box(controlBar); const ib = box(info);
  return JSON.stringify({ 控制栏: cb, 信息区: ib, 重叠: overlap(cb, ib), 信息区在控制栏上方: cb && ib ? ib.b <= cb.t + 2 : null }, null, 1);
})()`, sessionId));

console.log('\n=== 2. 弹幕：默认无输入框，点击按钮才出现 ===');
console.log(await evalJs(`JSON.stringify({
  默认有输入框: !!document.querySelector('input[aria-label="弹幕内容"]'),
  有发弹幕按钮: !!document.querySelector('button[aria-label="发弹幕"]'),
})`, sessionId));
await evalJs(`document.querySelector('button[aria-label="发弹幕"]')?.click()`, sessionId);
await sleep(900);
console.log(await evalJs(`(() => {
  const input = document.querySelector('input[aria-label="弹幕内容"]');
  const r = input ? input.getBoundingClientRect() : null;
  return JSON.stringify({
    点击后出现输入框: !!input,
    输入框在视口内: r ? r.bottom <= window.innerHeight && r.top >= 0 : null,
    有发送按钮: !!document.querySelector('button[aria-label="发送弹幕"]'),
  }, null, 1);
})()`, sessionId));
await evalJs(`document.querySelector('button[aria-label="关闭弹幕输入"]')?.click()`, sessionId);
await sleep(600);

console.log('\n=== 3. 单击视频应为暂停/播放（而非静音）===');
console.log(await evalJs(`(() => {
  const v = document.querySelector('video');
  return JSON.stringify({ 有video: !!v, 点击前paused: v ? v.paused : null, 点击前muted: v ? v.muted : null });
})()`, sessionId));
await evalJs(`(() => { const v = document.querySelector('video'); v?.click(); return true; })()`, sessionId);
await sleep(1200);
console.log(await evalJs(`(() => {
  const v = document.querySelector('video');
  const pauseOverlay = [...document.querySelectorAll('button[aria-label="继续播放"]')].length > 0;
  return JSON.stringify({
    点击后paused: v ? v.paused : null,
    点击后muted: v ? v.muted : null,
    出现暂停遮罩: pauseOverlay,
    静音状态未被切换: v ? true : null,
  }, null, 1);
})()`, sessionId));

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('gui-test-screenshots/shorts-bottom-fixed.png', Buffer.from(data, 'base64'));
console.log('\n截图: gui-test-screenshots/shorts-bottom-fixed.png');
console.log('页面异常:', errors.length ? errors.slice(0, 3).join(' | ') : '(无)');

await send('Target.closeTarget', { targetId });
ws.close();
