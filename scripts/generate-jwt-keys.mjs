// 生成 JWT RS256 密钥对（PKCS#8 私钥 / X.509 公钥，DER 的 Base64），
// 输出可直接写入 .env 或 shell 环境变量：
//   node scripts/generate-jwt-keys.mjs
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'der' },
});

const encode = (der) => der.toString('base64');

console.log('JWT_PRIVATE_KEY_BASE64=' + encode(privateKey));
console.log('JWT_PUBLIC_KEY_BASE64=' + encode(publicKey));
console.error('\n# 使用方式：');
console.error('#   PowerShell:  node scripts/generate-jwt-keys.mjs 逐行粘贴到环境变量，或');
console.error('#   bash:        export $(node scripts/generate-jwt-keys.mjs | grep JWT_)');
console.error('# 密钥仅在本地开发使用，请勿提交到版本库。');
