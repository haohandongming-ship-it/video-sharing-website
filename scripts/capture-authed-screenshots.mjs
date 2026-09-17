// 通过 CDP 在真实浏览器里完成登录，然后截取登录后的页面。
// 用于验证「前端页面 + 真实后端」的完整链路，而不是只看登录前的外观。
//
// 用法（需先以 --remote-debugging-port=9222 启动浏览器）：
//   node scripts/capture-authed-screenshots.mjs <输出目录> [baseUrl]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'gui-test-screenshots/live-auth';
const base = process.argv[3] ?? 'http://localhost:5173';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const ACCOUNT = process.env.DEMO_ACCOUNT ?? 'admin';
const PASSWORD = process.env.DEMO_PASSWORD ?? '123456';

const shots = [
  { name: '11-after-login-home', url: '/', wait: 3500 },
  { name: '12-creator', url: '/creator', wait: 3500 },
  { name: '13-admin-dashboard', url: '/admin/dashboard', wait: 4000 },
  { name: '14-admin-reviews', url: '/admin/reviews', wait: 3500 },
  { name: '15-messages', url: '/messages', wait: 3000 },
  { name: '16-upload', url: '/upload', wait: 3000 },
  { name: '17-settings', url: '/settings', wait: 3000 },
  { name: '18-video-detail', url: '/video/1', wait: 4000 },
];

mkdirSync(outDir, { recursive: true });

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let nextId = 1;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride',
  { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

// ---- 1. 登录 ----
await send('Page.navigate', { url: `${base}/login` }, sessionId);
await sleep(2500);

const fillAndSubmit = `(() => {
  const setValue = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // 登录页默认是「手机号验证码」，先切到「账号密码」
  const modeSwitch = [...document.querySelectorAll('button,[role="tab"],li,div,span')]
    .filter(el => el.textContent.trim() === '账号密码' && el.offsetParent !== null)
    .pop();
  if (modeSwitch) modeSwitch.click();

  const inputs = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null);
  const account = inputs.find(i => i.type === 'text' || i.type === 'tel');
  const pwd = inputs.find(i => i.type === 'password');
  if (!account || !pwd) return 'missing-inputs:' + inputs.map(i => i.type).join(',');

  setValue(account, ${JSON.stringify(ACCOUNT)});
  setValue(pwd, ${JSON.stringify(PASSWORD)});

  const submit = [...document.querySelectorAll('button[type="submit"], button')]
    .filter(b => b.offsetParent !== null && !b.disabled)
    .find(b => /登录/.test(b.textContent));
  if (!submit) return 'no-submit:' + [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean).join('|');

  submit.click();
  return 'submitted:' + submit.textContent.trim();
})()`;

// 切换登录方式需要一帧，切换后再填表提交
await send('Runtime.evaluate', { expression: fillAndSubmit, returnByValue: true }, sessionId);
await sleep(600);
const submitResult = await send('Runtime.evaluate', { expression: fillAndSubmit, returnByValue: true }, sessionId);
console.log('登录提交:', submitResult.result.value);
await sleep(4500);

const state = await send('Runtime.evaluate', {
  expression: `JSON.stringify({ path: location.pathname, body: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 160) })`,
  returnByValue: true,
}, sessionId);
console.log('登录后:', state.result.value);

// ---- 2. 截图 ----
const results = [];
for (const shot of shots) {
  try {
    await send('Page.navigate', { url: base + shot.url }, sessionId);
    await sleep(shot.wait);
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(outDir, `${shot.name}.png`), Buffer.from(data, 'base64'));
    results.push(`OK   ${shot.name.padEnd(22)} ${shot.url}`);
  } catch (err) {
    results.push(`FAIL ${shot.name.padEnd(22)} ${shot.url} -> ${err.message}`);
  }
}
await send('Target.closeTarget', { targetId });
ws.close();
console.log(results.join('\n'));
console.log(`\n输出目录: ${outDir}`);
