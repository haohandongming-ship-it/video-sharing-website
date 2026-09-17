// 复制一个 MP4，并在末尾追加一个合法的 `free` box，使其 SHA-256 与原文件不同。
// 这样既能绕开秒传（走完整分片上传路径），又不会破坏 MP4 结构（不是简单追加垃圾字节）。
//   node scripts/make-unique-mp4.mjs <源文件> <输出文件> [填充字节数]
import { readFileSync, writeFileSync } from 'node:fs';

const src = process.argv[2];
const dst = process.argv[3];
const pad = Number(process.argv[4] ?? 1024);

const buf = readFileSync(src);

// 校验顶层 box 结构，确保追加后仍可解析：逐个遍历 box 直到文件末尾
const boxes = [];
let pos = 0;
while (pos + 8 <= buf.length) {
  let size = buf.readUInt32BE(pos);
  const type = buf.toString('ascii', pos + 4, pos + 8);
  let header = 8;
  if (size === 1) {
    size = Number(buf.readBigUInt64BE(pos + 8));
    header = 16;
  }
  if (size < header || pos + size > buf.length) { boxes.push(`${type}(越界 ${size})`); break; }
  boxes.push(`${type}:${size}`);
  pos += size;
}
console.log(`顶层 box: ${boxes.join(' ')}`);
if (pos !== buf.length) console.log(`注意：解析到 ${pos}，文件长度 ${buf.length}，尾部有 ${buf.length - pos} 字节未覆盖`);

// 追加一个 free box：8 字节头 + 填充
const payload = Buffer.alloc(Math.max(0, pad - 8), 0);
const free = Buffer.alloc(8 + payload.length);
free.writeUInt32BE(free.length, 0);
free.write('free', 4, 'ascii');

const out = Buffer.concat([buf, free]);
writeFileSync(dst, out);
console.log(`已写出 ${dst}  ${buf.length} → ${out.length} 字节`);
