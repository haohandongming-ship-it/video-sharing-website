// 验证「纯附件消息」：只选图片、不输入任何正文，发送按钮应可用且能发送成功。
//   node scripts/verify-attachment-only.mjs [baseUrl] [图片路径]
const base = process.argv[2] ?? 'http://localhost:5173';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const { writeFileSync } = await import('node:fs');
const { resolve } = await import('node:path');
const imagePath = resolve(process.argv[3] ?? 'test-artifacts/avatar-test.png');

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
  const ins = [...document.querySelectorAll('input')];
  setV(ins.find(i => i.type==='text'||i.type==='tel'), 'admin');
  setV(ins.find(i => i.type==='password'), '123456');
  [...document.querySelectorAll('button')].find(b => b.type==='submit' && /登录/.test(b.textContent))?.click();
})()`, sessionId);
await sleep(4500);

await send('Page.navigate', { url: `${base}/messages?tab=message` }, sessionId);
await sleep(6000);

/** 读取发送按钮状态（输入区里的「发送」） */
const SEND_STATE = `(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '发送');
  const ta = document.querySelector('textarea');
  return JSON.stringify({ 发送按钮存在: !!btn, 禁用: btn ? btn.disabled : null, 正文长度: ta ? ta.value.length : null });
})()`;

console.log('=== 初始（无正文、无附件）===');
console.log(await evalJs(SEND_STATE, sessionId));

// 只选图片，不输入任何文字
const { root } = await send('DOM.getDocument', {}, sessionId);
const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[aria-label="选择图片文件"]' }, sessionId);
await send('DOM.setFileInputFiles', { files: [imagePath], nodeId }, sessionId);
console.log('\n已选择图片（未输入任何正文）:', imagePath);
await sleep(6000);

console.log('\n=== 选择附件后（正文仍为空）===');
console.log(await evalJs(SEND_STATE, sessionId));

// 点击发送
const clicked = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '发送');
  if (!btn) return 'no-button';
  if (btn.disabled) return 'still-disabled';
  btn.click();
  return 'clicked';
})()`, sessionId);
console.log('\n点击发送:', clicked);
await sleep(4000);

console.log('\n=== 发送后 ===');
console.log(await evalJs(`(() => {
  const text = document.body.innerText;
  const imgs = [...document.querySelectorAll('img')].map(i => i.getAttribute('src') || '');
  return JSON.stringify({
    仍有待发送附件提示: /附件已就绪/.test(text),
    出现发送失败: /发送失败|消息不能为空/.test(text),
    输入框已清空: (document.querySelector('textarea')?.value ?? 'x') === '',
    附件图片数量: imgs.filter(s => s.includes('/media/message/')).length,
  }, null, 1);
})()`, sessionId));

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('gui-test-screenshots/attachment-only.png', Buffer.from(data, 'base64'));
console.log('\n截图: gui-test-screenshots/attachment-only.png');

await send('Target.closeTarget', { targetId });
ws.close();
