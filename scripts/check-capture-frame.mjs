// 直接调用上传模块的 captureFrame，验证「浏览器抓帧」是否真能产出封面 data URL。
const base = process.argv[2] ?? 'http://localhost:5173';
const videoUrl = process.argv[3] ?? 'http://localhost:5173/upload-valid.mp4';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let nextId = 1; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); } });
const send = (method, params = {}, sid) => new Promise((r, j) => { const id = nextId++; pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify(sid ? { id, method, params, sessionId: sid } : { id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr, sid, wait = true) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: wait }, sid);
  if (r.exceptionDetails) return 'EXCEPTION: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

const { targetId } = await send('Target.createTarget', { url: `${base}/upload` });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await sleep(4000);

console.log('=== 直接调用 captureFrame ===');
console.log(await evalJs(`(async () => {
  try {
    const mod = await import('/src/features/upload/uploadEngine.ts');
    const r = await fetch('${videoUrl}');
    const blob = await r.blob();
    const file = new File([blob], 'probe.mp4', { type: 'video/mp4' });
    const started = Date.now();
    const cover = await mod.captureFrame(file, 1);
    return JSON.stringify({
      elapsedMs: Date.now() - started,
      gotCover: !!cover,
      prefix: cover ? cover.slice(0, 30) : null,
      length: cover ? cover.length : 0,
    }, null, 1);
  } catch (e) { return 'ERROR: ' + (e && e.message ? e.message : String(e)); }
})()`, sessionId));

await send('Target.closeTarget', { targetId });
ws.close();
