// 验证动态页「推荐关注」面板对已关注用户的显示状态。
// 关键场景：重复进入动态页（组件重新挂载）后，已关注用户仍应显示为「已关注」。
//   node scripts/verify-suggested-follow.mjs [baseUrl]
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
  setV(ins.find(i => i.type==='text'||i.type==='tel'), 'admin');
  setV(ins.find(i => i.type==='password'), '123456');
  [...document.querySelectorAll('button')].find(b => b.type==='submit' && /登录/.test(b.textContent))?.click();
})()`, sessionId);
await sleep(4500);
console.log('登录后:', await evalJs('location.pathname', sessionId));

/** 读取「推荐关注」面板里每一行的昵称与按钮状态 */
const READ_PANEL = `(() => {
  const panel = document.querySelector('section[aria-label="推荐关注"]');
  if (!panel) return JSON.stringify({ found: false });
  const rows = [...panel.querySelectorAll('li')].map(li => {
    const name = li.querySelector('span')?.textContent?.trim() ?? '';
    const btn = li.querySelector('button');
    return { name, buttonText: btn ? btn.textContent.trim() : null, pressed: btn ? btn.getAttribute('aria-pressed') : null };
  });
  return JSON.stringify({ found: true, rows }, null, 1);
})()`;

// 第一次进入动态页
await send('Page.navigate', { url: `${base}/feed` }, sessionId);
await sleep(6000);
console.log('\n=== 第一次进入动态页 ===');
console.log(await evalJs(READ_PANEL, sessionId));

// 离开再回来（模拟用户「重新点击动态页面」）
await send('Page.navigate', { url: `${base}/` }, sessionId);
await sleep(2500);
await send('Page.navigate', { url: `${base}/feed` }, sessionId);
await sleep(6000);
console.log('\n=== 第二次进入动态页（关键：状态不应丢失）===');
console.log(await evalJs(READ_PANEL, sessionId));

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('gui-test-screenshots/feed-suggested-follow.png', Buffer.from(data, 'base64'));
console.log('\n截图: gui-test-screenshots/feed-suggested-follow.png');

await send('Target.closeTarget', { targetId });
ws.close();
