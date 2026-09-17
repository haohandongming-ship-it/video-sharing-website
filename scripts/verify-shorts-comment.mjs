// 验证短视频评论区：点击评论图标后
// 1) 面板出现在视频右侧（大屏并排布局）
// 2) 存在可用输入框，能真正发布评论
//   node scripts/verify-shorts-comment.mjs [baseUrl]
const base = process.argv[2] ?? 'http://localhost:5173';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const { writeFileSync } = await import('node:fs');
const CONTENT = `短视频评论验证 ${Date.now() % 100000}`;

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let nextId = 1; const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
});
const send = (method, params = {}, sid) => new Promise((r, j) => { const id = nextId++; pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify(sid ? { id, method, params, sessionId: sid } : { id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr, sid) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.value;

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

// 登录（评论需要登录）
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

// 进入短视频页（首帧渲染需要时间，轮询等待视频出现，避免在空列表状态下误判）
await send('Page.navigate', { url: `${base}/shorts` }, sessionId);
let ready = false;
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  const state = await evalJs(`JSON.stringify({ path: location.pathname, hasVideo: !!document.querySelector('video') })`, sessionId);
  const s = JSON.parse(state);
  if (s.path === '/shorts' && s.hasVideo) { ready = true; break; }
}
console.log('短视频页:', await evalJs('location.pathname', sessionId), '就绪:', ready);
if (!ready) {
  console.log('短视频未就绪，中止');
  await send('Target.closeTarget', { targetId });
  ws.close();
  process.exit(1);
}

// 记录视频列与视口的位置，便于判断面板是否在视频右侧
console.log('\n=== 打开评论前的布局 ===');
console.log(await evalJs(`(() => {
  const v = document.querySelector('video');
  const r = v ? v.getBoundingClientRect() : null;
  return JSON.stringify({
    有视频: !!v,
    视频列: r ? { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) } : null,
    视口宽: window.innerWidth,
  }, null, 1);
})()`, sessionId));

// 点击评论按钮
const clicked = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '评论');
  if (!btn) return 'not-found';
  btn.click();
  return 'clicked';
})()`, sessionId);
console.log('\n评论按钮:', clicked);
await sleep(1800);

console.log('\n=== 评论面板位置与输入框 ===');
console.log(await evalJs(`(() => {
  const panel = document.querySelector('aside[aria-label="评论"]');
  if (!panel) return JSON.stringify({ found: false });
  const pr = panel.getBoundingClientRect();
  const v = document.querySelector('video');
  const vr = v ? v.getBoundingClientRect() : null;
  const textarea = document.querySelector('aside[aria-label="评论"] textarea');
  const submit = [...panel.querySelectorAll('button')].find(b => /发布|发送|评论/.test(b.textContent));
  return JSON.stringify({
    面板: { left: Math.round(pr.left), right: Math.round(pr.right), top: Math.round(pr.top), width: Math.round(pr.width) },
    视频列右边界: vr ? Math.round(vr.right) : null,
    面板在视频右侧: vr ? pr.left >= vr.right - 2 : null,
    有输入框: !!textarea,
    输入框占位: textarea ? textarea.placeholder : null,
    有发布按钮: !!submit,
    发布按钮文案: submit ? submit.textContent.trim() : null,
  }, null, 1);
})()`, sessionId));

// 发布一条评论
const posted = await evalJs(`(() => {
  const panel = document.querySelector('aside[aria-label="评论"]');
  const textarea = panel?.querySelector('textarea');
  if (!textarea) return 'no-textarea';
  const setV = (el, v) => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setV(textarea, ${JSON.stringify(CONTENT)});
  return 'filled';
})()`, sessionId);
console.log('\n填入内容:', posted);
await sleep(700);
const submitted = await evalJs(`(() => {
  const panel = document.querySelector('aside[aria-label="评论"]');
  const btn = [...panel.querySelectorAll('button')].find(b => /发布|发送/.test(b.textContent));
  if (!btn) return 'no-submit-button';
  if (btn.disabled) return 'submit-disabled';
  btn.click();
  return 'submitted:' + btn.textContent.trim();
})()`, sessionId);
console.log('提交:', submitted);
await sleep(3500);

console.log('\n=== 提交后 ===');
console.log(await evalJs(`(() => {
  const panel = document.querySelector('aside[aria-label="评论"]');
  const text = panel ? panel.innerText : '';
  return JSON.stringify({
    评论出现在列表: text.includes(${JSON.stringify(CONTENT)}),
    出现错误提示: /失败|错误|请先登录/.test(text),
    片段: text.replace(/\\s+/g, ' ').slice(0, 160),
  }, null, 1);
})()`, sessionId));

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('gui-test-screenshots/shorts-comment-right.png', Buffer.from(data, 'base64'));
console.log('\n截图: gui-test-screenshots/shorts-comment-right.png');

await send('Target.closeTarget', { targetId });
ws.close();
