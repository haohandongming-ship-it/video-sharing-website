// 登录后检查设置页头像到底渲染成什么：DOM 里的 img、Avatar 组件的实际 src、以及 CSP 是否拦截 data: URL。
const base = process.argv[2] ?? 'http://localhost:5173';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const pngPath = process.argv[3] ?? 'test-artifacts/avatar-test.png';

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let nextId = 1; const pending = new Map();
const consoleMsgs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
  if (m.method === 'Log.entryAdded') consoleMsgs.push(m.params.entry.text);
  if (m.method === 'Runtime.consoleAPICalled') consoleMsgs.push((m.params.args || []).map(a => a.value ?? a.description).join(' '));
});
const send = (method, params = {}, sid) => new Promise((r, j) => { const id = nextId++; pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify(sid ? { id, method, params, sessionId: sid } : { id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr, sid) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.value;

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Log.enable', {}, sessionId);

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
await sleep(4000);
console.log('已登录，路径:', await evalJs('location.pathname', sessionId));

await send('Page.navigate', { url: `${base}/settings` }, sessionId);
await sleep(3500);

console.log('\n=== 页面上所有 img ===');
console.log(await evalJs(`JSON.stringify([...document.querySelectorAll('img')].map(i => ({
  srcPrefix: (i.getAttribute('src')||'').slice(0,40), complete: i.complete, naturalW: i.naturalWidth, w: i.width, h: i.height,
})), null, 1)`, sessionId));

console.log('\n=== 头像区域 HTML（含 aria-label 头像的容器）===');
console.log(await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '更换头像');
  const box = btn ? btn.closest('div')?.parentElement : null;
  return box ? box.innerHTML.slice(0, 700) : 'not-found';
})()`, sessionId));

console.log('\n=== 直接读 store 里的 avatar ===');
console.log(await evalJs(`(() => {
  const raw = window.localStorage.getItem('vs-auth-hint');
  return raw ? raw.slice(0, 200) : 'no-vs-auth-hint';
})()`, sessionId));

console.log('\n=== 控制台输出（含 CSP 拦截）===');
console.log(consoleMsgs.slice(0, 15).join('\n') || '(无)');

console.log('\n=== 页面 CSP meta / 响应头 ===');
console.log(await evalJs(`JSON.stringify([...document.querySelectorAll('meta[http-equiv]')].map(m => m.getAttribute('http-equiv') + '=' + m.getAttribute('content')))`, sessionId));

await send('Target.closeTarget', { targetId });
ws.close();
