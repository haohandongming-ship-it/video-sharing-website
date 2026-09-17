// 在真实浏览器里验证视频能否播放：检查 <video> 的 readyState / duration，
// 并尝试播放后确认 currentTime 真的在推进（而不是只加载了元数据）。
const base = process.argv[2] ?? 'http://localhost:5173';
const videoId = process.argv[3] ?? '1';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let nextId = 1; const pending = new Map();
const mediaErrors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
  if (m.method === 'Log.entryAdded' && /media|video|403|404/i.test(m.params.entry.text)) mediaErrors.push(m.params.entry.text);
});
const send = (method, params = {}, sid) => new Promise((r, j) => { const id = nextId++; pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify(sid ? { id, method, params, sessionId: sid } : { id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr, sid) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.value;

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Log.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

await send('Page.navigate', { url: `${base}/video/${videoId}` }, sessionId);
await sleep(6000);

console.log('=== <video> 初始状态 ===');
console.log(await evalJs(`(() => {
  const v = document.querySelector('video');
  if (!v) return 'no-video-element';
  return JSON.stringify({
    src: v.currentSrc || v.src, readyState: v.readyState, networkState: v.networkState,
    duration: v.duration, videoWidth: v.videoWidth, videoHeight: v.videoHeight,
    error: v.error ? { code: v.error.code, message: v.error.message } : null,
    paused: v.paused,
  }, null, 1);
})()`, sessionId));

console.log('\n=== 页面上是否还有「视频源不可用」提示 ===');
console.log(await evalJs(`/视频源不可用|格式不受支持/.test(document.body.innerText) ? '仍然显示错误提示' : '无错误提示'`, sessionId));

console.log('\n=== 尝试播放（静音以规避自动播放策略）===');
console.log(await evalJs(`(async () => {
  const v = document.querySelector('video');
  if (!v) return 'no-video-element';
  v.muted = true;
  try { await v.play(); } catch (e) { return 'play() 失败: ' + e.message; }
  await new Promise(r => setTimeout(r, 2500));
  return JSON.stringify({ currentTime: v.currentTime, paused: v.paused, readyState: v.readyState, ended: v.ended }, null, 1);
})()`, sessionId));

console.log('\n=== 期间的控制台/网络异常 ===');
console.log(mediaErrors.slice(0, 8).join('\n') || '(无)');

await send('Page.captureScreenshot', { format: 'png' }, sessionId).then(({ data }) => {
  import('node:fs').then(({ writeFileSync }) => {
    writeFileSync(`gui-test-screenshots/video-playback-${videoId}.png`, Buffer.from(data, 'base64'));
    console.log(`\n截图: gui-test-screenshots/video-playback-${videoId}.png`);
  });
});
await sleep(800);
await send('Target.closeTarget', { targetId });
ws.close();
