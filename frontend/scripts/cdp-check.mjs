/**
 * 轻量 CDP 驱动（无第三方依赖，使用 Node 内置 WebSocket + fetch）
 *
 * 用途：在无头 Chrome 中真实渲染页面、收集控制台错误、执行点击与输入，
 * 用于本地验收「路由可访问 / 交互可用 / 无运行时报错」。
 *
 * 用法：node scripts/cdp-check.mjs [baseUrl]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
const CHROME = process.env.CHROME_BIN ?? 'google-chrome-stable';
const PORT = 9333;

const userDataDir = mkdtempSync(join(tmpdir(), 'cdp-profile-'));

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,1000',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

let chromeStderr = '';
chrome.stderr.on('data', (chunk) => {
  chromeStderr += String(chunk);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDevTools() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return await response.json();
    } catch {
      /* 尚未就绪 */
    }
    await sleep(250);
  }
  throw new Error(`DevTools 未就绪：\n${chromeStderr.slice(-2000)}`);
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id && this.pending.has(payload.id)) {
        const { resolve, reject } = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        if (payload.error) reject(new Error(JSON.stringify(payload.error)));
        else resolve(payload.result);
      } else if (payload.method) {
        this.events.push(payload);
      }
    });
  }

  send(method, params = {}) {
    const id = (this.id += 1);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时：${method}`));
        }
      }, 30_000);
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
    }
    return result.result?.value;
  }

  takeErrors() {
    const errors = [];
    for (const event of this.events) {
      if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
        errors.push(event.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      }
      if (event.method === 'Runtime.exceptionThrown') {
        errors.push(event.params.exceptionDetails.exception?.description ?? 'uncaught exception');
      }
    }
    this.events = [];
    return errors.filter((message) => !/favicon|Download the React DevTools/i.test(message));
  }
}

async function main() {
  await waitForDevTools();

  const target = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
  ).json();

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  const session = new Session(ws);
  await session.send('Runtime.enable');
  await session.send('Page.enable');
  await session.send('Network.enable');

  const visit = async (path, waitMs = 1800) => {
    await session.send('Page.navigate', { url: `${BASE}${path}` });
    await sleep(waitMs);
    const url = await session.evaluate('location.pathname + location.search');
    const text = await session.evaluate(
      "(() => { const r = document.getElementById('root'); return r ? r.innerText.replace(/\\s+/g,' ').slice(0, 220) : 'NO ROOT'; })()",
    );
    const overflow = await session.evaluate(
      "document.documentElement.scrollWidth > window.innerWidth + 2 ? document.documentElement.scrollWidth + '>' + window.innerWidth : ''",
    );
    return { text, url, overflow, errors: session.takeErrors() };
  };

  const click = async (selector) => {
    const ok = await session.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    })()`);
    await sleep(1200);
    return ok;
  };

  const clickByText = async (text, tag = 'button') => {
    const ok = await session.evaluate(`(() => {
      const nodes = [...document.querySelectorAll(${JSON.stringify(tag)})];
      const el = nodes.find((n) => (n.innerText || '').trim().includes(${JSON.stringify(text)}));
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    })()`);
    await sleep(1400);
    return ok;
  };

  const results = [];
  const report = (name, data) => {
    results.push({ name, ...data });
    const flag = data.errors.length > 0 || data.overflow ? 'FAIL' : 'PASS';
    console.log(
      `[${flag}] ${name}${data.overflow ? ` 横向溢出(${data.overflow})` : ''}${
        data.errors.length ? `\n     console: ${data.errors.slice(0, 3).join(' | ').slice(0, 400)}` : ''
      }\n     ${(data.text ?? '').slice(0, 150)}`,
    );
  };

  // 1) 游客态路由
  const guestRoutes = [
    ['/', '首页'],
    ['/ranking', '排行榜'],
    ['/feed', '动态流'],
    ['/feed/1', '动态详情'],
    ['/search?q=React', '搜索结果'],
    ['/user/3', '个人主页'],
    ['/video/1', '长视频播放页'],
    ['/shorts', '短视频沉浸页'],
    ['/login', '登录页'],
    ['/register', '注册页'],
  ];
  for (const [path, name] of guestRoutes) {
    report(`游客 ${name} ${path}`, await visit(path));
  }

  // 2) 受保护路由应重定向到登录
  const guarded = await visit('/settings');
  report('守卫：未登录访问 /settings 跳登录', {
    ...guarded,
    text: guarded.text.includes('登录') ? 'OK 重定向到登录页' : `异常：${guarded.text.slice(0, 60)}`,
  });

  // 3) 演示账号登录（创作者）
  await visit('/login', 1500);
  const clickedAuthor = await clickByText('创作者 · laowang', 'button');
  await sleep(2200);
  const afterLogin = await session.evaluate(
    "(() => { const r = document.getElementById('root'); return r ? r.innerText.replace(/\\s+/g,' ').slice(0, 160) : ''; })()",
  );
  report('登录：演示账号（创作者）快捷登录', {
    text: clickedAuthor ? afterLogin : `未找到演示账号按钮：${afterLogin.slice(0, 80)}`,
    overflow: '',
    errors: session.takeErrors(),
  });

  /** 页面是否被守卫重定向到登录页（按最终 URL 判定，最可靠） */
  const redirectedToLogin = (data) => data.url.startsWith('/login');
  /** 页面是否渲染出登录表单（DOM 层面二次确认） */
  const isLoginForm = (data) =>
    data.text.includes('演示账号快捷登录') || data.text.includes('手机号验证码');

  // 4) 登录后受保护路由（关键：验证刷新后会话仍可还原）
  const memberRoutes = [
    ['/settings', '设置'],
    ['/history', '观看历史'],
    ['/favorites', '我的收藏'],
    ['/messages', '消息中心'],
    ['/creator', '创作者中心'],
    ['/upload', '上传页'],
  ];
  for (const [path, name] of memberRoutes) {
    const data = await visit(path);
    const ok = !redirectedToLogin(data) && !isLoginForm(data);
    report(`登录后（刷新页面）${name} ${path}`, {
      ...data,
      text: ok ? `OK 停留于 ${data.url} · ${data.text.slice(0, 120)}` : `FAIL 被重定向到登录页（${data.url}）`,
    });
  }

  // 5) 上传页：选择文件控件与限制说明
  await visit('/upload', 1600);
  const uploadProbe = await session.evaluate(`(() => {
    const hasInput = Boolean(document.querySelector('input[type=file]'));
    const text = (document.getElementById('root')?.innerText ?? '').replace(/\\s+/g, ' ');
    return [hasInput ? 'file-input=yes' : 'file-input=no', /8GB|500MB|mp4/i.test(text) ? 'limits=shown' : 'limits=missing'].join(' ');
  })()`);
  report('上传页：控件与限制说明', { text: uploadProbe, overflow: '', errors: session.takeErrors() });

  // 6) 切换主题（暗色）：点击主题按钮 → 选择「暗色」
  await visit('/', 1800);
  const themeButtonClicked = await session.evaluate(`(() => {
    const btn = document.querySelector('header button[aria-label^="主题"]');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await sleep(700);
  const darkClicked = await clickByText('暗色', 'button');
  await sleep(900);
  const themeApplied = await session.evaluate(`(() => {
    const root = document.documentElement;
    const bg = getComputedStyle(document.body).backgroundColor;
    return (root.classList.contains('dark') ? 'dark' : 'light') + '|' + bg;
  })()`);
  report('主题切换：暗色模式生效', {
    text:
      themeButtonClicked && darkClicked
        ? `OK theme=${themeApplied}`
        : `未完成切换（按钮=${themeButtonClicked} 菜单项=${darkClicked}）theme=${themeApplied}`,
    overflow: '',
    errors: session.takeErrors(),
  });

  // 7) 管理员登录 → 管理后台
  await click('header button[aria-label="账号菜单"]');
  await sleep(700);
  await clickByText('退出登录', 'button');
  await sleep(900);
  await clickByText('退出', 'button');
  await sleep(1600);
  await visit('/login', 1500);
  await clickByText('管理员 · admin', 'button');
  await sleep(2200);
  const adminRoutes = [
    ['/admin/dashboard', '数据概览'],
    ['/admin/reviews', '内容审核'],
    ['/admin/reports', '举报处理'],
    ['/admin/users', '用户管理'],
    ['/admin/videos', '视频管理'],
    ['/admin/settings', '系统设置'],
    ['/admin/audit', '操作日志'],
  ];
  for (const [path, name] of adminRoutes) {
    const data = await visit(path, 2200);
    const ok = !redirectedToLogin(data) && data.url === path;
    report(`管理员${name} ${path}`, {
      ...data,
      text: ok ? `OK 停留于 ${data.url} · ${data.text.slice(0, 130)}` : `FAIL 期望 ${path}，实际 ${data.url}`,
    });
  }

  // 8) 审核动作：点击第一条「通过」并确认结果
  const reviewVisit = await visit('/admin/reviews', 2400);
  const beforeApprove = await session.evaluate(
    "document.querySelectorAll('button').length + '|' + (document.body.innerText.match(/待审核/g) || []).length",
  );
  const approved = await clickByText('通过', 'button');
  await sleep(2200);
  const afterApprove = await session.evaluate(`(() => {
    const text = document.body.innerText.replace(/\\s+/g, ' ');
    return /已通过审核|审核通过|处理完成/.test(text) ? 'OK 出现成功提示' : text.slice(0, 120);
  })()`);
  report('审核动作：点击「通过」', {
    text: approved
      ? `按钮数/待审标记=${beforeApprove} → ${afterApprove}`
      : `未找到通过按钮（页面=${reviewVisit.url}）`,
    overflow: '',
    errors: session.takeErrors(),
  });

  // 9) 短视频沉浸流：上滑切换下一条（指针拖拽 + 速度检测）
  const readShortsIndex = () =>
    session.evaluate(`(() => {
      const m = document.body.innerText.match(/(\\d+)\\s*\\/\\s*\\d+\\+?/);
      return m ? m[1] : '?';
    })()`);

  await visit('/shorts', 3000);
  const shortsBefore = await readShortsIndex();
  const swipeDispatched = await session.evaluate(`(() => {
    // 事件必须派发到实际承载手势的元素上（顶部/底部覆盖层与中央播放按钮均会遮挡）
    const x = Math.round(window.innerWidth / 2);
    const startY = Math.round(window.innerHeight * 0.72);
    const endY = Math.round(window.innerHeight * 0.24);
    const el = document.elementFromPoint(x, startY);
    if (!el) return 'no-target';
    const base = { bubbles: true, cancelable: true, clientX: x, pointerId: 7, pointerType: 'touch', isPrimary: true, buttons: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientY: startY }));
    el.dispatchEvent(new PointerEvent('pointermove', { ...base, clientY: startY - 40 }));
    el.dispatchEvent(new PointerEvent('pointermove', { ...base, clientY: endY }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...base, clientY: endY, buttons: 0 }));
    return el.className ? String(el.className).slice(0, 60) : el.tagName;
  })()`);
  await sleep(1600);
  const shortsAfter = await readShortsIndex();
  const shortsTitle = await session.evaluate(
    "(document.body.innerText.match(/@[^\\s]+/) || [''])[0] + ' | ' + document.body.innerText.replace(/\\s+/g,' ').slice(0, 80)",
  );
  report('短视频：上滑切换到下一条', {
    text: `序号 ${shortsBefore} → ${shortsAfter}（手势目标：${swipeDispatched}）· ${shortsTitle}`,
    overflow: '',
    errors: session.takeErrors(),
  });

  // 10) 排行榜：切换榜单类型与实时更新标识
  await visit('/ranking', 2600);
  const rankingTabs = await clickByText('趋势榜', 'button');
  await sleep(1400);
  const rankingText = await session.evaluate("document.body.innerText.replace(/\\s+/g,' ').slice(0, 200)");
  const trendTabActive = await session.evaluate(`(() => {
    const tab = [...document.querySelectorAll('[role=tab], button')].find((el) => (el.innerText || '').trim() === '趋势榜');
    return tab ? tab.getAttribute('aria-selected') ?? tab.className.includes('bg-fg') : false;
  })()`);
  report('排行榜：切换到趋势榜并显示实时状态', {
    text: `${rankingTabs ? '已点击' : '未找到 Tab'} · 选中=${trendTabActive} · ${rankingText}`,
    overflow: '',
    errors: session.takeErrors(),
  });

  const failed = results.filter((r) => r.errors.length > 0 || r.overflow);
  console.log(`\n===== 汇总：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length > 0) {
    console.log('失败项：');
    for (const item of failed) console.log(' -', item.name, item.errors.slice(0, 2).join(' | ').slice(0, 300));
  }

  ws.close();
  chrome.kill('SIGKILL');
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* Windows may release the profile asynchronously */ }
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error('驱动失败：', error);
  chrome.kill('SIGKILL');
  await sleep(500);
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best-effort temporary cleanup */ }
  process.exit(2);
});
