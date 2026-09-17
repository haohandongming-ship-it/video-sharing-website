// 验证短视频底部的三个功能是否都能正常点击（不被上层元素遮挡）。
// 用 elementFromPoint 命中测试，比看截图可靠。
//   node scripts/verify-shorts-hit-test.mjs [baseUrl]
const base = process.argv[2] ?? 'http://localhost:5173';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const { writeFileSync } = await import('node:fs');

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

const { targetId } = await send('Target.createTarget', { url: `${base}/shorts` });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  if (await evalJs(`!!document.querySelector('button[aria-label="播放速度"]')`, sessionId)) break;
}

/** 对某个元素做命中测试：中心点最上层的是不是它自己（或其后代） */
const HIT = (openExpr, targetSelector, label) => `(async () => {
  ${openExpr}
  await new Promise(r => setTimeout(r, 900));
  const target = document.querySelector(${JSON.stringify(targetSelector)});
  if (!target) return JSON.stringify({ 项目: ${JSON.stringify(label)}, 结果: '未找到元素' });
  const r = target.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + Math.min(20, r.height / 2);
  const top = document.elementFromPoint(cx, cy);
  const reachable = top && (target === top || target.contains(top) || top.contains(target));
  return JSON.stringify({
    项目: ${JSON.stringify(label)},
    位置: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    完整在视口内: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
    可点击: !!reachable,
    上层元素: reachable ? null : (top ? top.className.toString().slice(0, 60) : 'null'),
  }, null, 1);
})()`;

console.log(await evalJs(HIT(`document.querySelector('button[aria-label="清晰度"]')?.click()`, '[role="menu"]', '清晰度菜单'), sessionId));
await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`, sessionId);
await sleep(700);

console.log(await evalJs(HIT(`document.querySelector('button[aria-label="播放速度"]')?.click()`, '[role="menu"]', '倍速菜单'), sessionId));
await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`, sessionId);
await sleep(700);

console.log(await evalJs(HIT(`document.querySelector('button[aria-label="发弹幕"]')?.click()`, 'input[aria-label="弹幕内容"]', '弹幕输入框'), sessionId));
// 顺便验证输入框真的能输入
const typed = await evalJs(`(() => {
  const input = document.querySelector('input[aria-label="弹幕内容"]');
  if (!input) return 'no-input';
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '测试输入');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input.value;
})()`, sessionId);
console.log('  输入框可写入:', typed);
await evalJs(`document.querySelector('button[aria-label="关闭弹幕输入"]')?.click()`, sessionId);
await sleep(600);

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('gui-test-screenshots/shorts-hit-test.png', Buffer.from(data, 'base64'));
console.log('\n截图: gui-test-screenshots/shorts-hit-test.png');

await send('Target.closeTarget', { targetId });
ws.close();
