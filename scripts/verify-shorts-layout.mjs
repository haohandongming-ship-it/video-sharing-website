// 验证短视频新版排版：底部控制栏（弹幕/倍速/清晰度/字幕）、弹幕层、右侧面板标签页。
//   node scripts/verify-shorts-layout.mjs [baseUrl]
const base = process.argv[2] ?? 'http://localhost:5173';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const { writeFileSync } = await import('node:fs');

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let nextId = 1; const pending = new Map();
const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description?.split('\n')[0] ?? 'exception');
});
const send = (method, params = {}, sid) => new Promise((r, j) => { const id = nextId++; pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify(sid ? { id, method, params, sessionId: sid } : { id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr, sid) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.value;

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

await send('Page.navigate', { url: `${base}/shorts` }, sessionId);
let ok = false;
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  if (await evalJs(`!!document.querySelector('video')`, sessionId)) { ok = true; break; }
}
console.log('短视频页就绪:', ok, '路径:', await evalJs('location.pathname', sessionId));

console.log('\n=== 底部控制栏 ===');
console.log(await evalJs(`(() => {
  const labels = [...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label'));
  const has = (t) => labels.some(l => l && l.includes(t));
  return JSON.stringify({
    弹幕开关: has('弹幕'),
    倍速: has('倍速'),
    清晰度: has('清晰度'),
    字幕或提示: has('字幕') || document.body.innerText.includes('无字幕'),
    弹幕输入框: !!document.querySelector('input[aria-label="弹幕内容"]'),
    发送按钮: [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='发送'),
  }, null, 1);
})()`, sessionId));

console.log('\n=== 弹幕渲染（已预置一条 1.2s 的彩色弹幕）===');
// 让视频播到 1.2s 之后，弹幕窗口才会命中
await evalJs(`(() => { const v = document.querySelector('video'); if (v) { v.muted = true; void v.play().catch(()=>{}); } return true; })()`, sessionId);
await sleep(4000);
console.log(await evalJs(`(() => {
  const layer = document.querySelector('[aria-hidden="true"].absolute.inset-0.z-10');
  const text = layer ? layer.innerText.trim() : '';
  return JSON.stringify({
    弹幕层存在: !!layer,
    层内文本: text || '(空)',
    命中测试弹幕: text.includes('这是一条测试弹幕'),
  }, null, 1);
})()`, sessionId));

console.log('\n=== 右侧面板 ===');
await evalJs(`[...document.querySelectorAll('button[aria-label]')].find(b=>b.getAttribute('aria-label')==='评论')?.click()`, sessionId);
await sleep(2500);
console.log(await evalJs(`(() => {
  const panel = document.querySelector('aside[aria-label="短视频信息"]');
  if (!panel) return JSON.stringify({ found: false });
  const tabs = [...panel.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(Boolean);
  const r = panel.getBoundingClientRect();
  return JSON.stringify({
    面板存在: true,
    左侧: Math.round(r.left), 宽度: Math.round(r.width),
    标签页: tabs.slice(0, 6),
    有评论输入框: !!panel.querySelector('textarea'),
    含AI抖音标签: tabs.some(t=>t.includes('AI')),
  }, null, 1);
})()`, sessionId));

// 逐个切换标签
for (const tab of ['详情', 'TA的作品', '相关推荐']) {
  await evalJs(`(() => {
    const panel = document.querySelector('aside[aria-label="短视频信息"]');
    const btn = [...panel.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(tab)});
    btn?.click();
    return !!btn;
  })()`, sessionId);
  await sleep(2500);
  const preview = await evalJs(`(() => {
    const panel = document.querySelector('aside[aria-label="短视频信息"]');
    return panel ? panel.innerText.replace(/\\s+/g,' ').slice(0, 110) : '';
  })()`, sessionId);
  console.log(`  [${tab}] ${preview}`);
}

console.log('\n页面异常:', errors.length ? errors.slice(0, 3).join(' | ') : '(无)');

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('gui-test-screenshots/shorts-layout.png', Buffer.from(data, 'base64'));
console.log('\n截图: gui-test-screenshots/shorts-layout.png');

await send('Target.closeTarget', { targetId });
ws.close();
