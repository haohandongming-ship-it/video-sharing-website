// 验证个人主页「发私信」：按钮存在 → 打开会话 → 跳到私信页对应会话 → 发送的内容出现在私信里。
//   node scripts/verify-direct-message.mjs [baseUrl]
const base = process.argv[2] ?? 'http://localhost:5173';
const peerId = process.argv[3] ?? '3';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const { writeFileSync } = await import('node:fs');
const CONTENT = `私信入口验证 ${Date.now() % 100000}`;

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

// 打开他人主页
await send('Page.navigate', { url: `${base}/user/${peerId}` }, sessionId);
for (let i = 0; i < 15; i++) {
  await sleep(1000);
  if (await evalJs(`!!document.querySelector('button') && document.body.innerText.includes('加入')`, sessionId)) break;
}
console.log('\n=== 个人主页操作区按钮 ===');
console.log(await evalJs(`(() => {
  const names = [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean);
  const msg = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '发私信');
  const follow = [...document.querySelectorAll('button')].find(b => /已关注|关注/.test(b.textContent.trim()));
  const mr = msg ? msg.getBoundingClientRect() : null;
  const fr = follow ? follow.getBoundingClientRect() : null;
  return JSON.stringify({
    有发私信按钮: !!msg,
    有已关注按钮: !!follow,
    位于已关注之后: mr && fr ? mr.left >= fr.right - 1 : null,
    按钮列表: names.slice(0, 8),
  }, null, 1);
})()`, sessionId));

// 点击发私信
const clicked = await evalJs(`(() => {
  const msg = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '发私信');
  if (!msg) return 'not-found';
  msg.click();
  return 'clicked';
})()`, sessionId);
console.log('\n点击发私信:', clicked);

// 等待跳到私信页
let landed = '';
for (let i = 0; i < 15; i++) {
  await sleep(1000);
  landed = await evalJs(`location.pathname + location.search`, sessionId);
  if (landed.startsWith('/messages')) break;
}
console.log('跳转结果:', landed);

console.log('\n=== 私信页状态 ===');
console.log(await evalJs(`(() => {
  const text = document.body.innerText;
  return JSON.stringify({
    路径: location.pathname + location.search,
    会话数与对端: (text.match(/@[\\w\\u4e00-\\u9fa5]+/g) || []).slice(0, 3),
    有输入框: !!document.querySelector('textarea'),
    片段: text.replace(/\\s+/g,' ').slice(0, 140),
  }, null, 1);
})()`, sessionId));

// 发送一条私信
const filled = await evalJs(`(() => {
  const ta = document.querySelector('textarea');
  if (!ta) return 'no-textarea';
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(CONTENT)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'filled';
})()`, sessionId);
console.log('\n填入私信:', filled);
await sleep(600);
const sent = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /发送/.test(b.textContent));
  if (!btn) return 'no-send-button';
  if (btn.disabled) return 'send-disabled';
  btn.click();
  return 'sent';
})()`, sessionId);
console.log('发送:', sent);
await sleep(3500);

console.log('\n=== 发送后 ===');
console.log(await evalJs(`(() => {
  const text = document.body.innerText;
  return JSON.stringify({
    消息出现在会话中: text.includes(${JSON.stringify(CONTENT)}),
    片段: text.replace(/\\s+/g,' ').slice(0, 200),
  }, null, 1);
})()`, sessionId));

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('gui-test-screenshots/direct-message.png', Buffer.from(data, 'base64'));
console.log('\n截图: gui-test-screenshots/direct-message.png');

await send('Target.closeTarget', { targetId });
ws.close();
