// 上传页选择文件后的状态诊断：可见文本、错误提示、所有 img 的 src、按钮禁用情况。
const base = process.argv[2] ?? 'http://localhost:5173';
const videoPath = process.argv[3];
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';

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

await send('Page.navigate', { url: `${base}/upload` }, sessionId);
await sleep(3500);

const { root } = await send('DOM.getDocument', {}, sessionId);
const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' }, sessionId);
await send('DOM.setFileInputFiles', { files: [videoPath], nodeId }, sessionId);
await sleep(9000);

console.log('=== 全部 img ===');
console.log(await evalJs(`JSON.stringify([...document.querySelectorAll('img')].map(i=>({
  src: (i.getAttribute('src')||'').slice(0,34), visible: i.offsetParent!==null, w: i.width, h: i.height
})),null,1)`, sessionId));

console.log('\n=== 是否出现校验错误文案 ===');
console.log(await evalJs(`(() => {
  const t = document.body.innerText;
  const m = t.match(/(仅支持|不符|上限|过大|校验|失败|错误)[^\\n]{0,60}/g);
  return m ? JSON.stringify(m.slice(0,5)) : '(无错误文案)';
})()`, sessionId));

console.log('\n=== 按钮禁用状态 ===');
console.log(await evalJs(`JSON.stringify([...document.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>({
  text: b.textContent.trim().slice(0,16), disabled: b.disabled
})),null,1)`, sessionId));

console.log('\n=== 页面当前步骤文本 ===');
console.log(await evalJs(`document.body.innerText.replace(/\\s+/g,' ').slice(0, 260)`, sessionId));

await send('Target.closeTarget', { targetId });
ws.close();
