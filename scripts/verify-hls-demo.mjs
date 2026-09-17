// 验证演示 HLS 素材的真实属性：用页面里已有的 hls.js 加载它，
// 读取时长、分辨率、音轨与播放推进情况（比只看 HTTP 200 更有说服力）。
//   node scripts/verify-hls-demo.mjs [baseUrl]
const base = process.argv[2] ?? 'http://localhost:5173';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let nextId = 1; const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
});
const send = (method, params = {}, sid) => new Promise((r, j) => { const id = nextId++; pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify(sid ? { id, method, params, sessionId: sid } : { id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr, sid, awaitPromise = false) =>
  (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise }, sid)).result.value;

const { targetId } = await send('Target.createTarget', { url: `${base}/` });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await sleep(4000);

console.log('用 hls.js 加载 /api/v1/demo/hls/master.m3u8 … (后端随包输出的多码率演示流)');
const result = await evalJs(`(async () => {
  const Hls = (await import('/node_modules/hls.js/dist/hls.mjs')).default;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  document.body.appendChild(video);
  const hls = new Hls({ enableWorker: false });
  const levels = [];
  hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => { data.levels.forEach(l => levels.push(l.width + 'x' + l.height)); });
  const errors = [];
  hls.on(Hls.Events.ERROR, (_, data) => errors.push(data.type + ':' + (data.details || '')));
  hls.loadSource('/demo/hls/master.m3u8');
  hls.attachMedia(video);
  await new Promise(r => { hls.on(Hls.Events.MANIFEST_PARSED, r); setTimeout(r, 8000); });
  await new Promise(r => { video.onloadedmetadata = r; setTimeout(r, 8000); });
  let played = null;
  try {
    await video.play();
    await new Promise(r => setTimeout(r, 2500));
    played = { currentTime: video.currentTime, paused: video.paused };
  } catch (e) { played = { error: e.message }; }
  const audioTracks = video.audioTracks ? video.audioTracks.length : 'n/a';
  const out = {
    levels,
    duration: video.duration,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    audioTracks,
    readyState: video.readyState,
    error: video.error ? video.error.code : null,
    played,
    hlsErrors: errors.slice(0, 5),
  };
  hls.destroy();
  return JSON.stringify(out, null, 1);
})()`, sessionId, true);
console.log(result);

await send('Target.closeTarget', { targetId });
ws.close();
