// 生成一张合法 PNG，用于端到端验证头像上传（真实浏览器 + 真实后端 + 真实对象存储）。
//   node scripts/make-test-png.mjs <输出路径> [尺寸]
//
// 第三个参数是 --random：用不可压缩的随机像素生成大图，用来验证 MB 级别的上传上限。
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';

const out = process.argv[2] ?? 'test-artifacts/avatar-test.png';
const size = Number(process.argv[3] ?? 48);
const useNoise = process.argv.includes('--random');

const raw = Buffer.alloc(size * (size * 3 + 1));
let p = 0;
for (let y = 0; y < size; y++) {
  raw[p++] = 0; // filter: none
  if (useNoise) {
    // 纯随机像素几乎不可压缩，压缩后体积接近原始大小，便于构造大文件
    randomBytes(size * 3).copy(raw, p);
    p += size * 3;
  } else {
    for (let x = 0; x < size; x++) {
      raw[p++] = Math.floor((x / size) * 255); // R 渐变
      raw[p++] = Math.floor((y / size) * 255); // G 渐变
      raw[p++] = 160;                          // B
    }
  }
}

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 2;  // color type: truecolor
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync(out, png);
console.log(`${out}  ${size}x${size}  ${png.length} 字节`);
