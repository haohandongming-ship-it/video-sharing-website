/**
 * 会话持久化专项诊断：登录 → 刷新 → 检查 mock 会话与前端会话标记
 * 用法：node scripts/cdp-session-debug.mjs [baseUrl]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
const PORT = 9334;
const userDataDir = mkdtempSync(join(tmpdir(), 'cdp-session-'));
const chrome = spawn(
  'google-chrome-stable',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break;
    } catch {
      /* wait */
    }
    await sleep(250);
  }
  const target = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
  ).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id && pending.has(payload.id)) {
      pending.get(payload.id)(payload.result);
      pending.delete(payload.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const current = (id += 1);
      pending.set(current, resolve);
      ws.send(JSON.stringify({ id: current, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) return `EXCEPTION: ${result.exceptionDetails.exception?.description}`;
    return result.result?.value;
  };
  const navigate = async (path, wait = 2500) => {
    await send('Page.navigate', { url: `${BASE}${path}` });
    await sleep(wait);
  };

  await send('Runtime.enable');
  await send('Page.enable');

  const snapshot = async (label) => {
    const state = await evaluate(`JSON.stringify({
      url: location.pathname + location.search,
      mockSession: sessionStorage.getItem('vs-mock-session'),
      authHint: localStorage.getItem('vs-auth-hint'),
      uiPref: localStorage.getItem('vs-ui-preference') ? 'present' : null,
    })`);
    console.log(`\n[${label}] ${state}`);
  };

  await navigate('/login');
  await snapshot('打开登录页');

  const clicked = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText||'').includes('创作者 · laowang'));
    if (!btn) return 'no-button';
    btn.click();
    return 'clicked';
  })()`);
  await sleep(2500);
  console.log(`点击演示账号：${clicked}`);
  await snapshot('登录后（未刷新）');

  await navigate('/settings');
  await snapshot('刷新到 /settings');

  const deep = await evaluate(`(async () => {
    const out = {};
    try {
      const res = await fetch('/api/v1/users/me', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      out.meStatus = res.status;
      out.meBody = (await res.text()).slice(0, 160);
    } catch (e) { out.meError = String(e); }
    try {
      const res = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      out.refreshStatus = res.status;
      out.refreshBody = (await res.text()).slice(0, 200);
    } catch (e) { out.refreshError = String(e); }
    return JSON.stringify(out);
  })()`);
  console.log(`\n[接口探测] ${deep}`);

  ws.close();
  chrome.kill('SIGKILL');
  rmSync(userDataDir, { recursive: true, force: true });
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  chrome.kill('SIGKILL');
  process.exit(1);
});
