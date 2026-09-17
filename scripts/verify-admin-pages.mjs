// 以管理员身份登录后逐个打开管理后台页面，检查是否出现错误边界 / 控制台异常。
//   node scripts/verify-admin-pages.mjs [baseUrl]
const base = process.argv[2] ?? 'http://localhost:5173';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';

const PAGES = [
  ['/admin/dashboard', '仪表盘'],
  ['/admin/reviews', '审核队列'],
  ['/admin/reports', '举报处理'],
  ['/admin/videos', '视频管理'],
  ['/admin/users', '用户管理'],
  ['/admin/audit', '操作日志'],
  ['/admin/settings', '平台设置'],
];

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let nextId = 1; const pending = new Map();
let consoleErrors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails?.exception?.description?.split('\n')[0] ?? 'exception');
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push((m.params.args || []).map((a) => a.value ?? a.description).join(' ').split('\n')[0]);
  }
});
const send = (method, params = {}, sid) => new Promise((r, j) => { const id = nextId++; pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify(sid ? { id, method, params, sessionId: sid } : { id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr, sid) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.value;

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);

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
console.log('登录后路径:', await evalJs('location.pathname', sessionId));

let bad = 0;
for (const [path, label] of PAGES) {
  consoleErrors = [];
  await send('Page.navigate', { url: base + path }, sessionId);
  await sleep(4000);
  const state = await evalJs(`(() => {
    const t = document.body.innerText;
    return JSON.stringify({
      path: location.pathname,
      crashed: /页面出错了|Cannot read properties/.test(t),
      snippet: t.replace(/\\s+/g,' ').slice(0, 70),
    });
  })()`, sessionId);
  const s = JSON.parse(state);
  const ok = !s.crashed && s.path === path;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(8)} ${path.padEnd(20)} 崩溃=${s.crashed} 实际路径=${s.path}`);
  console.log(`      内容: ${s.snippet}`);
  if (consoleErrors.length) console.log(`      控制台: ${consoleErrors.slice(0, 2).join(' | ')}`);
}

console.log(`\n结果: ${PAGES.length - bad}/${PAGES.length} 正常`);
await send('Target.closeTarget', { targetId });
ws.close();
