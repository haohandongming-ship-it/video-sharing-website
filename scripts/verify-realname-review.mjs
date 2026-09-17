// 以审核员登录，验证「实名审核」导航入口与页面渲染。
//   node scripts/verify-realname-review.mjs [baseUrl]
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

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

// 以审核员登录
await send('Page.navigate', { url: `${base}/login` }, sessionId);
await sleep(2500);
await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '账号密码' && b.offsetParent)?.click()`, sessionId);
await sleep(1200);
await evalJs(`(() => {
  const setV = (el, v) => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true})); };
  const ins = [...document.querySelectorAll('input')];
  setV(ins.find(i => i.type==='text'||i.type==='tel'), 'moderator');
  setV(ins.find(i => i.type==='password'), '123456');
  [...document.querySelectorAll('button')].find(b => b.type==='submit' && /登录/.test(b.textContent))?.click();
})()`, sessionId);
await sleep(4500);
console.log('登录用户: moderator，路径:', await evalJs('location.pathname', sessionId));

// 打开后台，检查导航入口
await send('Page.navigate', { url: `${base}/admin/dashboard` }, sessionId);
await sleep(4000);
console.log('\n=== 后台导航是否出现「实名审核」 ===');
console.log(await evalJs(`(() => {
  const links = [...document.querySelectorAll('a')].map(a => ({ text: a.textContent.trim(), href: a.getAttribute('href') }));
  const entry = links.find(l => l.text.includes('实名审核'));
  return JSON.stringify({ 有入口: !!entry, 指向: entry?.href ?? null, 全部入口: links.filter(l=>l.href&&l.href.includes('/admin')).map(l=>l.text) }, null, 1);
})()`, sessionId));

// 直接打开实名审核页
await send('Page.navigate', { url: `${base}/admin/real-names` }, sessionId);
await sleep(5000);
console.log('\n=== 实名审核页 ===');
console.log(await evalJs(`(() => {
  const text = document.body.innerText;
  return JSON.stringify({
    路径: location.pathname,
    标题存在: /实名认证审核/.test(text),
    出现申请人: /新来的创作者1/.test(text),
    出现真实姓名: /张伟/.test(text),
    出现掩码证件号: /110101\\*+1234/.test(text),
    有通过按钮: [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='通过'),
    有驳回按钮: [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='驳回'),
    片段: text.replace(/\\s+/g,' ').slice(0, 200),
  }, null, 1);
})()`, sessionId));
console.log('页面异常:', errors.length ? errors.slice(0,2).join(' | ') : '(无)');

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('gui-test-screenshots/realname-review.png', Buffer.from(data, 'base64'));
console.log('\n截图: gui-test-screenshots/realname-review.png');

await send('Target.closeTarget', { targetId });
ws.close();
