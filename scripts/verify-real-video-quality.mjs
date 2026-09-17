// 在短视频页用键盘切到「旅游」这条真实上传视频，验证它加载的是转码分片并记录分辨率。
//   node scripts/verify-real-video-quality.mjs [baseUrl]
const base = process.argv[2] ?? 'http://localhost:5173';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const { writeFileSync } = await import('node:fs');

const version = await (await fetch(`${cdpHttp}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let nextId = 1; const pending = new Map();
let media = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve: r, reject: j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
  if (m.method === 'Network.requestWillBeSent') {
    const u = m.params?.request?.url ?? '';
    if (u.includes('/hls/')) media.push(u.replace(base, ''));
  }
});
const send = (method, params = {}, sid) => new Promise((r, j) => { const id = nextId++; pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify(sid ? { id, method, params, sessionId: sid } : { id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr, sid) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.value;

const { targetId } = await send('Target.createTarget', { url: `${base}/shorts` });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Network.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
for (let i = 0; i < 25; i++) {
  await sleep(1000);
  if (await evalJs(`!!document.querySelector('button[aria-label="播放速度"]')`, sessionId)) break;
}
await sleep(6000);

const title = `(document.body.innerText.match(/清晰度演示|实例5|旅游|修理系统/) ?? ['?'])[0]`;
const res = `(() => { const v = document.querySelector('video'); return v ? v.videoWidth + 'x' + v.videoHeight : null; })()`;

// 用键盘下翻到「旅游」：空格的 keydown 由页面 onKeyDown 处理
for (let step = 0; step < 4; step++) {
  const now = await evalJs(title, sessionId);
  console.log(`第 ${step} 条: ${now}  分辨率=${await evalJs(res, sessionId)}`);
  if (now === '旅游') break;
  await evalJs(`(() => {
    const el = document.querySelector('div.relative.h-full.w-full') || document.body;
    for (const type of ['keydown']) {
      el.dispatchEvent(new KeyboardEvent(type, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true }));
    }
    return true;
  })()`, sessionId);
  await sleep(4000);
}

console.log('\n=== 当前视频 ===');
console.log(' ', await evalJs(`JSON.stringify({ 标题: ${title}, 分辨率: ${res}, 清晰度: document.querySelector('button[aria-label="清晰度"]')?.innerText.trim() })`, sessionId));

console.log('\n=== 该视频加载的 HLS 资源 ===');
const unique = [...new Set(media)];
const real = unique.filter((u) => /\/videos\/\d+\/hls\//.test(u));
console.log('  全部 hls 请求:', unique.length, ' 其中转码流派:', real.length);
real.slice(0, 8).forEach((u) => console.log('   ', u));

if (real.length > 0) {
  const vid = real[0].match(/\/videos\/(\d+)\/hls/)[1];
  console.log(`\n=== 切档验证（video ${vid}）===`);
  await evalJs(`document.querySelector('button[aria-label="清晰度"]')?.click()`, sessionId);
  await sleep(1000);
  console.log('  菜单:', await evalJs(`(() => {
    const m = document.querySelector('[role="menu"]');
    if (!m) return '未出现';
    return [...m.querySelectorAll('[role="menuitem"]')].map(b => {
      const s = b.querySelectorAll('span > span');
      return (s[0]?.textContent?.trim() ?? '?') + '|' + (s[1]?.textContent?.trim() ?? '') + '|禁用=' + b.disabled;
    }).join('  ');
  })()`, sessionId));
  media = [];
  await evalJs(`(() => {
    const m = document.querySelector('[role="menu"]');
    const it = [...m.querySelectorAll('[role="menuitem"]')].find(b => b.innerText.includes('480P'));
    if (it) it.click();
    return true;
  })()`, sessionId);
  await sleep(9000);
  const after = [...new Set(media)];
  console.log('  切到 480P 后请求:', after.slice(0, 6).join(', ') || '(无)');
  console.log('  分辨率:', await evalJs(res, sessionId));
}

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('gui-test-screenshots/real-video-quality.png', Buffer.from(data, 'base64'));
console.log('\n截图: gui-test-screenshots/real-video-quality.png');

await send('Target.closeTarget', { targetId });
ws.close();
