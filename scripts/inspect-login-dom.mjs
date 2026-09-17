// 诊断登录页 DOM：打印登录方式切换控件、输入框与按钮的真实结构。
//   node scripts/inspect-login-dom.mjs [baseUrl]
const base = process.argv[2] ?? 'http://localhost:5173';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});
let nextId = 1;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve: r, reject: j } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((r, j) => { const id = nextId++; pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expression, sessionId) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)).result.value;

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Page.navigate', { url: `${base}/login` }, sessionId);
await sleep(3000);

console.log('=== 路径 ===', await evalJs('location.pathname', sessionId));
console.log('\n=== 所有 input ===');
console.log(await evalJs(`JSON.stringify([...document.querySelectorAll('input')].map((i, idx) => ({
  idx, type: i.type, name: i.name, placeholder: i.placeholder,
  ariaLabel: i.getAttribute('aria-label'), visible: i.offsetParent !== null,
})), null, 1)`, sessionId));

console.log('\n=== 所有 button ===');
console.log(await evalJs(`JSON.stringify([...document.querySelectorAll('button')].map((b, idx) => ({
  idx, text: b.textContent.trim().slice(0, 24), type: b.type, visible: b.offsetParent !== null, disabled: b.disabled,
})), null, 1)`, sessionId));

console.log('\n=== 含「账号密码」的元素 ===');
console.log(await evalJs(`JSON.stringify([...document.querySelectorAll('*')]
  .filter(el => el.children.length === 0 && el.textContent.trim() === '账号密码')
  .map(el => ({ tag: el.tagName, cls: el.className.toString().slice(0, 60), visible: el.offsetParent !== null })), null, 1)`, sessionId));

await send('Target.closeTarget', { targetId });
ws.close();
