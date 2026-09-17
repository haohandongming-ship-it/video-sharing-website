// 检查短视频页底部控件是否互相重叠（弹幕输入框 / 发送按钮 vs 右侧互动栏的举报按钮）。
//   node scripts/check-shorts-overlap.mjs [baseUrl]
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
const evalJs = async (expr, sid) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.value;

const { targetId } = await send('Target.createTarget', { url: `${base}/shorts` });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  if (await evalJs(`!!document.querySelector('input[aria-label="弹幕内容"]')`, sessionId)) break;
}

console.log(await evalJs(`(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; };
  const input = document.querySelector('input[aria-label="弹幕内容"]');
  const sendBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '发送');
  const report = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '举报');
  const overlap = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const i = input ? box(input) : null;
  const s = sendBtn ? box(sendBtn) : null;
  const rp = report ? box(report) : null;
  return JSON.stringify({
    弹幕输入框: i,
    发送按钮: s,
    举报按钮: rp,
    发送与举报重叠: overlap(s, rp),
    输入框与举报重叠: overlap(i, rp),
  }, null, 1);
})()`, sessionId));

await send('Target.closeTarget', { targetId });
ws.close();
