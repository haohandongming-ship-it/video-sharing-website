// 验证消息中心「互动通知」各类型的计数在初始渲染时就正确，无需点击。
//   node scripts/verify-notification-counts.mjs [baseUrl] [account]
const base = process.argv[2] ?? 'http://localhost:5173';
const account = process.argv[3] ?? 'laowang';
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

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

// 登录
await send('Page.navigate', { url: `${base}/login` }, sessionId);
await sleep(2500);
await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '账号密码' && b.offsetParent)?.click()`, sessionId);
await sleep(1200);
await evalJs(`(() => {
  const setV = (el, v) => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true})); };
  const ins = [...document.querySelectorAll('input')].filter(i => i.offsetParent);
  setV(ins.find(i => i.type==='text'||i.type==='tel'), ${JSON.stringify(account)});
  setV(ins.find(i => i.type==='password'), '123456');
  [...document.querySelectorAll('button')].find(b => b.type==='submit' && /登录/.test(b.textContent))?.click();
})()`, sessionId);
await sleep(4500);
console.log('登录用户:', account, '路径:', await evalJs('location.pathname', sessionId));

// 打开消息中心的「互动通知」标签（不点击任何类型）
await send('Page.navigate', { url: `${base}/messages?tab=notification` }, sessionId);
await sleep(6000);

/** 读取桌面端类型侧栏里每一项的名称与数字 */
const READ = `(() => {
  const nav = document.querySelector('nav[aria-label="通知类型"]');
  if (!nav) return JSON.stringify({ found: false });
  const rows = [...nav.querySelectorAll('li')].map(li => {
    const btn = li.querySelector('button');
    const spans = [...btn.querySelectorAll('span')];
    const label = spans[0]?.textContent?.trim() ?? '';
    const count = spans[spans.length - 1]?.textContent?.trim() ?? '';
    return { label, count, active: btn.getAttribute('aria-current') === 'true' };
  });
  return JSON.stringify({ found: true, rows }, null, 1);
})()`;

console.log('\n=== 初始渲染（未点击任何类型）===');
console.log(await evalJs(READ, sessionId));

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('gui-test-screenshots/notification-counts.png', Buffer.from(data, 'base64'));
console.log('\n截图: gui-test-screenshots/notification-counts.png');

await send('Target.closeTarget', { targetId });
ws.close();
