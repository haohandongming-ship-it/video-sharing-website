// 用 CDP 对运行中的前端页面截图（不引入任何新依赖，Node 18+ 自带 WebSocket）。
//
// 用法：
//   node scripts/capture-screenshots.mjs <输出目录> [baseUrl]
//
// 需要先用调试端口启动浏览器，例如：
//   msedge.exe --headless=new --disable-gpu --remote-debugging-port=9222 --user-data-dir=<临时目录> about:blank
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'gui-test-screenshots/live';
const base = process.argv[3] ?? 'http://localhost:5173';
const cdpHttp = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';

const pages = [
  { name: '01-home', url: '/', wait: 3500 },
  { name: '02-login', url: '/login', wait: 2000 },
  { name: '03-ranking', url: '/ranking', wait: 3000 },
  { name: '04-feed', url: '/feed', wait: 3000 },
  { name: '05-video-1', url: '/video/1', wait: 3500 },
  { name: '06-search', url: '/search?keyword=架构', wait: 3000 },
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
const sessions = new Map();

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  } else if (msg.method === 'Session.detached') {
    sessions.delete(msg.sessionId);
  }
});

const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
for (const page of pages) {
  let sessionId;
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
    sessions.set(sessionId, targetId);

    await send('Page.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

    await send('Page.navigate', { url: base + page.url }, sessionId);
    await sleep(page.wait);

    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
    const file = join(outDir, `${page.name}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    results.push(`OK   ${page.name.padEnd(12)} ${page.url}`);

    await send('Target.closeTarget', { targetId });
  } catch (err) {
    results.push(`FAIL ${page.name.padEnd(12)} ${page.url} -> ${err.message}`);
  }
}

ws.close();
console.log(results.join('\n'));
console.log(`\n输出目录: ${outDir}`);
