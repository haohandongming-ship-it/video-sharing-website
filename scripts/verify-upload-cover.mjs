// 端到端验证「上传时截取的封面」：在真实浏览器里走完整上传流程，
// 确认封面帧被提交、落存储，并最终写进 videos.cover_url。
//   node scripts/verify-upload-cover.mjs <视频文件> [baseUrl]
import { resolve } from 'node:path';

const videoPath = resolve(process.argv[2] ?? 'test-artifacts/upload-probe.mp4');
const base = process.argv[3] ?? 'http://localhost:5173';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const TITLE = process.env.UPLOAD_TITLE ?? `封面端到端验证 ${Date.now() % 100000}`;

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let nextId = 1; const pending = new Map();
const initPayloads = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
  // 抓取 init 请求体，确认 coverDataUrl 真的发出去了
  if (m.method === 'Network.requestWillBeSent' && m.params.request.url.includes('/uploads/init')) {
    initPayloads.push(m.params.request.postData ?? '');
  }
});
const send = (method, params = {}, sid) => new Promise((r, j) => { const id = nextId++; pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify(sid ? { id, method, params, sessionId: sid } : { id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr, sid) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.value;

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Network.enable', {}, sessionId);

// ---- 登录 ----
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

// ---- 上传页：选文件 ----
await send('Page.navigate', { url: `${base}/upload` }, sessionId);
await sleep(3500);

const { root } = await send('DOM.getDocument', {}, sessionId);
const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' }, sessionId);
await send('DOM.setFileInputFiles', { files: [videoPath], nodeId }, sessionId);
console.log('已选择文件:', videoPath);
await sleep(6000);

console.log('选文件后页面状态:', await evalJs(`JSON.stringify({
  hasNext: !!document.querySelector('button:not([disabled])') && [...document.querySelectorAll('button')].some(b=>/下一步/.test(b.textContent) && !b.disabled),
  body: document.body.innerText.replace(/\\s+/g,' ').slice(0, 120),
})`, sessionId));

// ---- 进入下一步 ----
await evalJs(`[...document.querySelectorAll('button')].find(b => /下一步/.test(b.textContent) && !b.disabled)?.click()`, sessionId);
await sleep(2500);

// ---- 填写标题 + 选分区 ----
const filled = await evalJs(`(() => {
  const setV = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const title = [...document.querySelectorAll('input,textarea')].find(el => /一句话说明视频内容/.test(el.placeholder || ''));
  if (title) setV(title, ${JSON.stringify(TITLE)});
  // 分区：点第一个可选中的 radio 的标签
  const radios = [...document.querySelectorAll('input[type=radio]')].filter(r => !r.disabled);
  if (radios[0]) { radios[0].click(); radios[0].dispatchEvent(new Event('change', { bubbles: true })); }
  return JSON.stringify({ titleFound: !!title, radioCount: radios.length });
})()`, sessionId);
console.log('填写表单:', filled);
await sleep(1500);

// 封面候选帧是否已生成
console.log('封面候选帧:', await evalJs(`(() => {
  const img = [...document.querySelectorAll('img')].find(i => (i.getAttribute('src')||'').startsWith('data:image/'));
  return img ? '已生成（' + img.getAttribute('src').length + ' 字符）' : '未生成';
})()`, sessionId));

// ---- 开始上传 ----
const clicked = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '开始上传' && !b.disabled);
  if (btn) { btn.click(); return 'clicked'; }
  const all = [...document.querySelectorAll('button')].map(b => b.textContent.trim() + (b.disabled ? '(禁用)' : '')).filter(Boolean);
  return 'not-found:' + all.join('|');
})()`, sessionId);
console.log('开始上传:', clicked);
await sleep(12000);

console.log('\n=== init 请求里是否带 coverDataUrl ===');
for (const p of initPayloads) {
  const hasCover = /coverDataUrl/.test(p);
  const m = /"coverDataUrl":"(data:image\/[a-z]+);base64,([A-Za-z0-9+/=]{0,16})/.exec(p);
  console.log(`  coverDataUrl 存在=${hasCover}  前缀=${m ? m[1] + '...' + m[2].slice(0, 8) : 'n/a'}`);
}

await sleep(8000);
console.log('\n=== 上传结束后页面状态 ===');
console.log(await evalJs(`document.body.innerText.replace(/\\s+/g,' ').slice(0, 200)`, sessionId));

await send('Target.closeTarget', { targetId });
ws.close();
console.log(`\n本次提交的标题: ${TITLE}`);
