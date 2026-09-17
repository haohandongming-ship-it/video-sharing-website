// 端到端验证头像上传：真实浏览器登录 → 设置页 → 选择文件 → 校验请求、响应与最终渲染。
//   node scripts/verify-avatar-upload.mjs <png路径> [baseUrl]
import { resolve } from 'node:path';

const pngPath = resolve(process.argv[2] ?? 'test-artifacts/avatar-test.png');
const base = process.argv[3] ?? 'http://localhost:5173';
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
  new Promise((r, j) => {
    const id = nextId++;
    pending.set(id, { resolve: r, reject: j });
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expression, sessionId) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)).result.value;

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Network.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride',
  { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

// 收集 PUT /users/me 的网络结果
const putResults = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Network.responseReceived' && m.params.response.url.includes('/api/v1/users/me')) {
    putResults.push({ status: m.params.response.status, method: m.params.type });
  }
});

// ---- 1. 登录 ----
await send('Page.navigate', { url: `${base}/login` }, sessionId);
await sleep(2500);

// 「账号密码」是一个真实 button，必须精确匹配到 button 本体，不能取到外层容器
const switchOk = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')]
    .find(b => b.textContent.trim() === '账号密码' && b.offsetParent !== null);
  if (!btn) return 'no-switch-button';
  btn.click();
  return 'switched';
})()`, sessionId);
console.log('切换登录方式:', switchOk);
await sleep(1200);

const loginJs = `(() => {
  const setValue = (el, v) => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const inputs = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null);
  const a = inputs.find(i => i.type === 'text' || i.type === 'tel');
  const p = inputs.find(i => i.type === 'password');
  if (!a || !p) return 'missing-inputs:' + inputs.map(i => i.type).join(',');
  setValue(a, 'admin'); setValue(p, '123456');
  // 提交按钮：优先 type=submit，其次文字含「登录」但不含「验证码」
  const btn = [...document.querySelectorAll('button')]
    .filter(b => b.offsetParent !== null && !b.disabled)
    .find(b => b.type === 'submit' && /登录/.test(b.textContent))
    || [...document.querySelectorAll('button')]
      .filter(b => b.offsetParent !== null && !b.disabled)
      .find(b => /登录/.test(b.textContent) && !/验证码|微信|QQ/.test(b.textContent));
  if (!btn) return 'no-submit:' + [...document.querySelectorAll('button')].map(b => b.textContent.trim()).join('|');
  btn.click();
  return 'submitted:' + btn.textContent.trim();
})()`;
console.log('提交:', await evalJs(loginJs, sessionId));
await sleep(4000);
console.log('登录后路径:', await evalJs('location.pathname', sessionId));

// ---- 2. 打开设置页并找到文件 input ----
await send('Page.navigate', { url: `${base}/settings` }, sessionId);
await sleep(3000);
const inputInfo = await evalJs(`(() => {
  const inputs = [...document.querySelectorAll('input[type=file]')];
  return JSON.stringify({ path: location.pathname, count: inputs.length, labels: inputs.map(i => i.getAttribute('aria-label')) });
})()`, sessionId);
console.log('设置页 file input:', inputInfo);

const { root } = await send('DOM.getDocument', {}, sessionId);
const { nodeId } = await send('DOM.querySelector',
  { nodeId: root.nodeId, selector: 'input[type=file]' }, sessionId);
if (!nodeId) { console.log('!! 没找到 file input'); ws.close(); process.exit(1); }

// 记录改前的头像
const before = await evalJs(`(() => {
  const img = document.querySelector('img[alt], img');
  return img ? img.getAttribute('src')?.slice(0, 30) : null;
})()`, sessionId);
console.log('改前首个 img src:', before);

// ---- 3. 塞入文件，触发真实的 change 事件 ----
await send('DOM.setFileInputFiles', { files: [pngPath], nodeId }, sessionId);
await sleep(6000);

// ---- 4. 校验结果 ----
const after = await evalJs(`(() => {
  const imgs = [...document.querySelectorAll('img')];
  // 头像现在由对象存储提供（MinIO URL）或本地模式的 /api/v1/media/，不再内联 base64
  const stored = imgs.find(i => {
    const src = i.getAttribute('src') || '';
    return /^https?:\\/\\/[^/]+\\/.*media\\/avatar\\//.test(src) || src.startsWith('/api/v1/media/');
  });
  return JSON.stringify({
    path: location.pathname,
    storedAvatarFound: !!stored,
    avatarSrc: stored ? stored.getAttribute('src') : null,
    avatarNaturalWidth: stored ? stored.naturalWidth : null,
    bodyHasError: /头像更新失败|服务暂时不可用/.test(document.body.innerText),
    bodyText: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 100),
  });
})()`, sessionId);
console.log('上传后:', after);
console.log('users/me 响应:', JSON.stringify(putResults));

await send('Page.captureScreenshot', { format: 'png' }, sessionId).then(({ data }) => {
  import('node:fs').then(({ writeFileSync }) => {
    writeFileSync('gui-test-screenshots/avatar-after-upload.png', Buffer.from(data, 'base64'));
    console.log('截图: gui-test-screenshots/avatar-after-upload.png');
  });
});
await sleep(1000);
await send('Target.closeTarget', { targetId });
ws.close();
