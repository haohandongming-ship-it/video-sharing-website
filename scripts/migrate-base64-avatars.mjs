// 把历史上以 base64 Data URL 存在 users.avatar_url 里的头像，迁移到对象存储并改存 URL。
//
// 用法（仓库根目录）：
//   node scripts/migrate-base64-avatars.mjs
//
// 依赖：docker compose 起着 mysql 容器（读 .env 的连接与密码），后端与前端 dev server 在运行。
// 迁移走公开的上传接口，因此会正常经过大小与图片格式校验，不会绕过业务规则。
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const BASE = process.env.APP_BASE ?? 'http://localhost:5173';
const CONTAINER = process.env.MYSQL_CONTAINER ?? 'video-sharing-platform-mysql-1';

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const idx = line.indexOf('=');
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    }),
);

function query(sql) {
  const out = execFileSync('docker', [
    'exec', '-e', `MYSQL_PWD=${env.MYSQL_PASSWORD}`, CONTAINER,
    'mysql', `-u${env.MYSQL_USER}`, '-D', env.MYSQL_DATABASE, '-N', '-B', '-e', sql,
  ], { encoding: 'utf8' });
  return out.split(/\r?\n/).filter((line) => line.trim() !== '');
}

const rows = query("SELECT id, avatar_url FROM users WHERE avatar_url LIKE 'data:image/%';");
if (rows.length === 0) {
  console.log('没有需要迁移的 base64 头像。');
  process.exit(0);
}
console.log(`发现 ${rows.length} 条待迁移头像。`);

// 用 admin 身份调用上传接口（上传接口按登录用户写入，因此逐条迁移时用各自的账号更严谨；
// 这里历史数据只有演示账号，直接用 admin 只对其自身生效——下面按记录所属用户分别处理）。
const login = async (account) => {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ account, password: '123456' }),
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(`登录失败 ${account}: ${json.message}`);
  return json.data.accessToken;
};

const tempDir = mkdtempSync(join(tmpdir(), 'avatar-migrate-'));
let migrated = 0;

for (const row of rows) {
  // 行格式：id<TAB>data:image/...
  const tab = row.indexOf('\t');
  const id = row.slice(0, tab);
  const dataUrl = row.slice(tab + 1);

  const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) {
    console.log(`跳过用户 ${id}：无法解析 Data URL`);
    continue;
  }
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const bytes = Buffer.from(match[2], 'base64');
  const file = join(tempDir, `avatar-${id}.${ext}`);
  writeFileSync(file, bytes);

  const username = query(`SELECT username FROM users WHERE id=${Number(id)};`)[0];
  console.log(`迁移用户 ${id}（${username}）：${bytes.length} 字节 .${ext}`);

  const token = await login(username);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: `image/${match[1]}` }), `avatar.${ext}`);
  const res = await fetch(`${BASE}/api/v1/users/me/avatar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'X-Requested-With': 'XMLHttpRequest' },
    body: form,
  });
  const json = await res.json();
  if (json.code !== 0) {
    console.log(`  失败：${json.message}`);
    continue;
  }
  console.log(`  已迁移 → ${json.data.avatar}`);
  migrated++;
}

console.log(`\n完成：成功迁移 ${migrated}/${rows.length} 条。`);
const remaining = query("SELECT COUNT(*) FROM users WHERE avatar_url LIKE 'data:%';")[0];
console.log(`剩余 base64 头像记录：${remaining}`);
