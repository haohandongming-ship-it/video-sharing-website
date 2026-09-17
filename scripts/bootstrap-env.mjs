// 本地开发环境变量初始化：生成根目录 .env（含 Docker 生产依赖所需的全部密钥）。
// 已存在的 .env 不会被覆盖；重复执行只会补齐缺失的密钥行。
//   node scripts/bootstrap-env.mjs
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const examplePath = join(root, '.env.example');

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'der' },
});

// 32 随机字节，AES-256-GCM 数据加密密钥
const dataKey = randomBytes(32).toString('base64');
// HMAC-SHA256 上传签名密钥
const signingSecret = randomBytes(48).toString('base64url');

const generated = {
  JWT_PRIVATE_KEY_BASE64: privateKey.toString('base64'),
  JWT_PUBLIC_KEY_BASE64: publicKey.toString('base64'),
  DATA_ENCRYPTION_KEY_BASE64: dataKey,
  STORAGE_SIGNING_SECRET: signingSecret,
};

const assign = (text, key, value) => {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, line);
  return `${text.replace(/\s*$/, '')}\n${line}\n`;
};

if (!existsSync(examplePath)) {
  console.error('缺少 .env.example，无法初始化');
  process.exit(1);
}

let text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : readFileSync(examplePath, 'utf8');
const before = text;
for (const [key, value] of Object.entries(generated)) {
  // 仅补齐空值或占位值；已有真实值保持不变（优先使用本地已有配置）
  const current = text.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
  const isPlaceholder = current === '' || /^replace-with/.test(current) || /^<.*>$/.test(current);
  if (isPlaceholder) text = assign(text, key, value);
}

writeFileSync(envPath, text, 'utf8');
console.log(`已写入 ${envPath}${text === before ? '（无变化）' : ''}`);
for (const key of Object.keys(generated)) {
  const value = text.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1] ?? '';
  console.log(`${key}: ${value ? `已配置（${value.length} 字符）` : '缺失'}`);
}
