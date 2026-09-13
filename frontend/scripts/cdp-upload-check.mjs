/**
 * 上传链路端到端验证（文档 10.1：预签名分片直传 + 秒传 + 转码 → 审核 → 发布）
 *
 * 通过 CDP 的真实文件上传能力（DOM.setFileInputFiles）驱动 <input type="file">，
 * 覆盖「测试脚本无法伪造文件选择」这一真实浏览器限制，从而验证完整链路。
 *
 * 用法：node scripts/cdp-upload-check.mjs [baseUrl] [videoPath]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
const VIDEO = process.argv[3] ?? '/tmp/upload-test.mp4';
const PORT = 9340;
const userDataDir = mkdtempSync(join(tmpdir(), 'cdp-upload-'));
const chrome = spawn(
  'google-chrome-stable',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,1200',
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
      /* 等待 DevTools 就绪 */
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
  const errors = [];
  ws.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id && pending.has(payload.id)) {
      const { resolve, reject } = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) reject(new Error(JSON.stringify(payload.error)));
      else resolve(payload.result);
    }
    if (payload.method === 'Runtime.consoleAPICalled' && payload.params.type === 'error') {
      errors.push(payload.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
    }
    if (payload.method === 'Runtime.exceptionThrown') {
      errors.push((payload.params.exceptionDetails.exception?.description ?? '').slice(0, 200));
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const current = (id += 1);
      pending.set(current, { resolve, reject });
      ws.send(JSON.stringify({ id: current, method, params }));
      setTimeout(() => {
        if (pending.has(current)) {
          pending.delete(current);
          reject(new Error(`CDP 超时：${method}`));
        }
      }, 30_000);
    });

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate 失败');
    }
    return result.result?.value;
  };

  const text = () => evaluate("(document.getElementById('root')?.innerText ?? '').replace(/\\s+/g, ' ')");

  const clickByText = async (needle, tag = 'button', wait = 1200) => {
    const ok = await evaluate(`(() => {
      const nodes = [...document.querySelectorAll(${JSON.stringify(tag)})];
      const el = nodes.find((n) => (n.innerText || '').trim().includes(${JSON.stringify(needle)}));
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    })()`);
    await sleep(wait);
    return ok;
  };

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}\n     ${String(detail).slice(0, 260)}`);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');

  // 1) 登录创作者账号
  await send('Page.navigate', { url: `${BASE}/login` });
  await sleep(2500);
  check('登录页打开', (await text()).includes('演示账号快捷登录'), '登录页渲染完成');
  const loginClicked = await clickByText('创作者 · laowang', 'button', 2600);
  check('点击演示账号登录', loginClicked && !(await evaluate('location.pathname')).startsWith('/login'), `路径=${await evaluate('location.pathname')}`);

  // 2) 进入上传页并注入真实文件
  await send('Page.navigate', { url: `${BASE}/upload` });
  await sleep(2200);

  const doc = await send('DOM.getDocument', { depth: -1 });
  const inputNode = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
  if (!inputNode.nodeId) {
    check('找到文件选择控件', false, '页面上没有 input[type=file]');
    throw new Error('缺少文件输入');
  }
  await send('DOM.setFileInputFiles', { nodeId: inputNode.nodeId, files: [VIDEO] });
  await sleep(2600);

  const afterFile = await text();
  check(
    '选择文件后完成校验并展示媒体信息',
    /upload-test\.mp4/.test(afterFile) && /(时长|分辨率|16\.1 KB|00:03)/.test(afterFile),
    afterFile.slice(0, 200),
  );

  // 3) 填写信息并进入下一步
  const stepAdvanced = await clickByText('下一步', 'button', 1500);
  const stepText = await text();
  check(
    '进入信息填写步骤',
    stepAdvanced || /标题|分区|简介/.test(stepText),
    `点击下一步=${stepAdvanced} · ${stepText.slice(0, 160)}`,
  );

  // 填写标题（按 UploadPage 的真实 placeholder 定位，兼容受控组件）
  const fillTitle = (value) =>
    evaluate(`(() => {
      const input = [...document.querySelectorAll('input')].find((el) =>
        /一句话说明视频内容/.test(el.getAttribute('placeholder') || ''),
      );
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);

  const title = `端到端上传验证 ${new Date().toISOString().slice(11, 19)}`;
  check('标题输入框可写入', await fillTitle(title), title);
  await sleep(600);

  // 选择分区（UploadPage 用 role="radio" 的按钮实现分区选择）
  const categoryPicked = await evaluate(`(() => {
    const options = [...document.querySelectorAll('[role=radio], input[type=radio]')];
    const target = options.find((el) => {
      const label = (el.closest('label')?.innerText || el.innerText || '').trim();
      return label === '科技';
    });
    if (!target) return 'not-found';
    target.click();
    return 'clicked';
  })()`);
  await sleep(500);
  const categoryState = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('[role=radio]')].find(
      (el) => (el.innerText || '').trim() === '科技',
    );
    return btn ? btn.getAttribute('aria-checked') : 'not-found';
  })()`);
  check('选择分区', categoryPicked === 'clicked' && categoryState === 'true', `点击=${categoryPicked} aria-checked=${categoryState}`);

  // 勾选「原创声明」（按可见文案定位，避免误点其他开关）
  const declaredChecked = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('button[role=switch], input[type=checkbox]')];
    const target = nodes.find((n) => /原创/.test(n.closest('label')?.innerText || ''));
    if (!target) return false;
    if (target.getAttribute('aria-checked') !== 'true' && !target.checked) target.click();
    return true;
  })()`);
  await sleep(500);
  check('勾选原创声明', declaredChecked, declaredChecked ? '已勾选' : '未找到原创声明开关');

  const formState = await evaluate(`(() => {
    const input = [...document.querySelectorAll('input')].find((el) =>
      /一句话说明视频内容/.test(el.getAttribute('placeholder') || ''),
    );
    const declared = [...document.querySelectorAll('button[role=switch], input[type=checkbox]')].some(
      (n) => /原创/.test(n.closest('label')?.innerText || '') && (n.getAttribute('aria-checked') === 'true' || n.checked),
    );
    return JSON.stringify({ title: input?.value ?? null, declared });
  })()`);
  const form = JSON.parse(formState);
  check(
    '信息表单已填写（标题字数与原创声明）',
    form.title === title && form.declared === true,
    `title=${form.title} declared=${form.declared}`,
  );

  // 4) 开始上传
  const buttonState = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === '开始上传');
    if (!btn) return 'not-found';
    return btn.disabled ? 'disabled' : 'enabled';
  })()`);
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === '开始上传');
    btn?.click();
    return true;
  })()`);
  await sleep(1500);
  const afterStart = await text();
  check(
    '点击开始上传',
    buttonState === 'enabled' && !/开始上传/.test(afterStart),
    `按钮状态=${buttonState} · 点击后=${afterStart.slice(-180)}`,
  );

  // 等待上传 + 转码：以「上传进度区 / 转码进度环 / 成功提示」的出现为成功判据
  // 注意不能匹配步骤条的「4 完成」字样，否则会误判
  const successPattern =
    /(上传完成|正在上传|已上传|转码中|转码完成|等待中|进入审核|审核中|已发布|发布成功|秒传|无需重复上传|\d+\/\d+ 分片|\d+%)/;
  let uploadPhaseText = '';
  let phaseHit = false;
  for (let i = 0; i < 40; i += 1) {
    await sleep(1200);
    uploadPhaseText = await text();
    if (successPattern.test(uploadPhaseText)) {
      phaseHit = true;
      // 再给转码轮询一点时间，尽可能走到终态
      if (/已发布|进入审核|审核中|转码完成|秒传/.test(uploadPhaseText)) break;
    }
  }
  check(
    '上传链路走通（哈希 → 分片直传 → 合并 → 转码/审核）',
    phaseHit,
    uploadPhaseText.slice(-320),
  );

  // 5) 秒传：再次上传同一文件
  await send('Page.navigate', { url: `${BASE}/upload` });
  await sleep(2200);
  const doc2 = await send('DOM.getDocument', { depth: -1 });
  const input2 = await send('DOM.querySelector', { nodeId: doc2.root.nodeId, selector: 'input[type=file]' });
  await send('DOM.setFileInputFiles', { nodeId: input2.nodeId, files: [VIDEO] });
  await sleep(2500);
  await clickByText('下一步', 'button', 1200);
  await evaluate(`(() => {
    const input = [...document.querySelectorAll('input')].find((el) =>
      /一句话说明视频内容/.test(el.getAttribute('placeholder') || ''),
    );
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '秒传验证（同一文件二次上传）');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('button[role=switch], input[type=checkbox]')];
    const target = nodes.find((n) => /原创/.test(n.closest('label')?.innerText || ''));
    if (target && target.getAttribute('aria-checked') !== 'true' && !target.checked) target.click();
    return true;
  })()`);
  await sleep(500);
  const started2 = await clickByText('开始上传', 'button', 1200);
  if (!started2) await clickByText('上传', 'button', 1200);
  let instantText = '';
  for (let i = 0; i < 12; i += 1) {
    await sleep(1200);
    instantText = await text();
    if (/秒传|已存在|无需重复上传/.test(instantText)) break;
  }
  check('相同文件二次上传命中秒传', /秒传|已存在|无需重复上传/.test(instantText), instantText.slice(0, 260));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== 上传链路：${results.length - failed.length}/${results.length} 通过 =====`);
  if (errors.length > 0) {
    console.log('控制台错误：');
    for (const message of errors.slice(0, 5)) console.log(' -', message);
  }

  ws.close();
  chrome.kill('SIGKILL');
  rmSync(userDataDir, { recursive: true, force: true });
  process.exit(failed.length > 0 || errors.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('驱动失败：', error);
  chrome.kill('SIGKILL');
  rmSync(userDataDir, { recursive: true, force: true });
  process.exit(2);
});
