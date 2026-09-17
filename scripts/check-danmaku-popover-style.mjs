// 读取弹幕浮层的计算样式，确认对比度是否足够（不依赖截图观感）。
//   node scripts/check-danmaku-popover-style.mjs [baseUrl]
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
  if (await evalJs(`!!document.querySelector('button[aria-label="发弹幕"]')`, sessionId)) break;
}
await evalJs(`document.querySelector('button[aria-label="发弹幕"]')?.click()`, sessionId);
await sleep(1000);

console.log(await evalJs(`(() => {
  const input = document.querySelector('input[aria-label="弹幕内容"]');
  if (!input) return JSON.stringify({ found: false });
  const card = input.closest('div.absolute');
  const label = card.querySelector('span');
  const hint = [...card.querySelectorAll('button')].find(b => b.textContent.includes('弹幕显示'));
  const cs = (el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, color: s.color, border: s.borderColor, z: s.zIndex, opacity: s.opacity }; };
  const r = card.getBoundingClientRect();
  return JSON.stringify({
    卡片: cs(card),
    标题文字: label ? cs(label) : null,
    关闭提示文字: hint ? cs(hint) : null,
    位置: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    在视口内: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
    被上层元素覆盖: (() => {
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + 10);
      return el ? (card.contains(el) ? '否（浮层在最上）' : '是：' + el.className.toString().slice(0, 40)) : '未知';
    })(),
  }, null, 1);
})()`, sessionId));

await send('Target.closeTarget', { targetId });
ws.close();
