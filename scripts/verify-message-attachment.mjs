// 验证私信附件：UI 提供真实的文件选择（而非 prompt），选文件后上传成功，
// 发送消息后图片附件出现在会话里。
//   node scripts/verify-message-attachment.mjs [baseUrl]
const base = process.argv[2] ?? 'http://localhost:5173';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const { writeFileSync } = await import('node:fs');
const { resolve } = await import('node:path');
const imagePath = resolve(process.argv[3] ?? 'test-artifacts/avatar-test.png');
const CONTENT = `图片附件验证 ${Date.now() % 100000}`;

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let nextId = 1; const pending = new Map();
let promptCalled = false;
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
  if (m.method === 'Page.javascriptDialogOpening') promptCalled = true;
});
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
  const ins = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null || i.type !== 'file');
  setV(ins.find(i => i.type==='text'||i.type==='tel'), 'admin');
  setV(ins.find(i => i.type==='password'), '123456');
  [...document.querySelectorAll('button')].find(b => b.type==='submit' && /登录/.test(b.textContent))?.click();
})()`, sessionId);
await sleep(4500);

// 打开私信
await send('Page.navigate', { url: `${base}/messages?tab=message` }, sessionId);
await sleep(6000);

console.log('=== 附件入口是否为真实文件选择 ===');
console.log(await evalJs(`(() => {
  const inputs = [...document.querySelectorAll('input[type=file]')];
  return JSON.stringify({
    文件输入数量: inputs.length,
    图片输入: !!inputs.find(i => (i.getAttribute('aria-label')||'') === '选择图片文件'),
    视频输入: !!inputs.find(i => (i.getAttribute('aria-label')||'') === '选择视频文件'),
    提示文案: [...document.querySelectorAll('span')].map(s=>s.textContent.trim()).find(t=>/支持图片/.test(t)) ?? null,
  }, null, 1);
})()`, sessionId));

// 通过 DOM.setFileInputFiles 选择本地图片（等同用户点按钮选文件）
const { root } = await send('DOM.getDocument', {}, sessionId);
const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[aria-label="选择图片文件"]' }, sessionId);
if (!nodeId) { console.log('!! 未找到图片文件输入'); await send('Target.closeTarget', { targetId }); ws.close(); process.exit(1); }
await send('DOM.setFileInputFiles', { files: [imagePath], nodeId }, sessionId);
console.log('\n已选择本地图片:', imagePath);
await sleep(6000);

console.log('\n=== 上传后状态（不应弹出 prompt）===');
console.log(await evalJs(`(() => {
  const text = document.body.innerText;
  return JSON.stringify({
    出现附件已就绪提示: /附件已就绪/.test(text),
    出现上传失败: /附件上传失败/.test(text),
    提示片段: (text.match(/附件[^\\n]{0,30}/g) || []).slice(0, 3),
  }, null, 1);
})()`, sessionId));
console.log('是否弹出过浏览器 prompt:', promptCalled);

// 填写正文并发送
await evalJs(`(() => {
  const ta = document.querySelector('textarea');
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(CONTENT)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
})()`, sessionId);
await sleep(600);
const sent = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /发送/.test(b.textContent));
  if (!btn) return 'no-button';
  if (btn.disabled) return 'disabled';
  btn.click();
  return 'sent';
})()`, sessionId);
console.log('\n发送:', sent);
await sleep(4000);

console.log('\n=== 发送后：附件是否出现在会话里 ===');
console.log(await evalJs(`(() => {
  const text = document.body.innerText;
  const imgs = [...document.querySelectorAll('img')].map(i => i.getAttribute('src') || '');
  const mediaAtt = imgs.find(s => s.includes('/media/message/'));
  return JSON.stringify({
    正文出现: text.includes(${JSON.stringify(CONTENT)}),
    附件图片已渲染: !!mediaAtt,
    附件地址: mediaAtt ?? null,
  }, null, 1);
})()`, sessionId));

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('gui-test-screenshots/message-attachment.png', Buffer.from(data, 'base64'));
console.log('\n截图: gui-test-screenshots/message-attachment.png');

await send('Target.closeTarget', { targetId });
ws.close();
