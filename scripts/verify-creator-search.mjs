// 验证搜索页「创作者」标签：能搜到人（此前只会返回作品）。
//   node scripts/verify-creator-search.mjs [baseUrl] [关键词]
const base = process.argv[2] ?? 'http://localhost:5173';
const keyword = process.argv[3] ?? '新来';
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

const url = `${base}/search?q=${encodeURIComponent(keyword)}&type=user`;
await send('Page.navigate', { url }, sessionId);
await sleep(6500);

console.log('=== 创作者标签结果 ===');
console.log(await evalJs(`(() => {
  const text = document.body.innerText;
  const cards = [...document.querySelectorAll('ul li')].filter(li => /粉丝/.test(li.innerText) && /作品/.test(li.innerText));
  return JSON.stringify({
    路径: location.pathname + location.search,
    当前标签: [...document.querySelectorAll('button')].filter(b=>['视频','创作者','动态'].includes(b.textContent.trim())).map(b=>({label:b.textContent.trim(), active:b.getAttribute('aria-selected')==='true'||b.className.includes('bg-fg')})),
    结果数: cards.length,
    首个结果: cards[0] ? cards[0].innerText.replace(/\\s+/g,' ').slice(0,80) : null,
    仍是视频网格: /VideoCard|aspect-video/.test(document.body.innerHTML) ? '可能' : '否',
    片段: text.replace(/\\s+/g,' ').slice(0, 160),
  }, null, 1);
})()`, sessionId));
console.log('页面异常:', errors.length ? errors.slice(0,2).join(' | ') : '(无)');

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('gui-test-screenshots/creator-search.png', Buffer.from(data, 'base64'));
console.log('\n截图: gui-test-screenshots/creator-search.png');

// 对照：视频标签
await send('Page.navigate', { url: `${base}/search?q=${encodeURIComponent('旅游')}&type=video` }, sessionId);
await sleep(5000);
console.log('\n=== 视频标签（对照，应仍正常）===');
console.log(await evalJs(`(() => {
  const cards = [...document.querySelectorAll('a[href^="/video/"]')];
  return JSON.stringify({ 视频卡片数: cards.length, 片段: document.body.innerText.replace(/\\s+/g,' ').slice(0,100) }, null, 1);
})()`, sessionId));

await send('Target.closeTarget', { targetId });
ws.close();
