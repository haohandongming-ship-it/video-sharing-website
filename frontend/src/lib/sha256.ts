/**
 * 纯 JS 增量 SHA-256。
 *
 * 为什么不用 `crypto.subtle.digest`：
 * 1. `crypto.subtle` 只在**安全上下文**（https / localhost / 127.0.0.1）存在。局域网里其他设备
 *    用 `http://<内网IP>:5173` 打开时它是 `undefined`，上传在「算哈希」这一步就崩了。
 * 2. Web Crypto 没有增量 API，原实现要把整个文件拼进一块连续内存，几百 MB 的视频在手机上容易 OOM。
 *
 * 这里按 32 位字实现标准 SHA-256（FIPS 180-4），支持流式 `update`，任意大小文件只占一个分片的内存。
 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const BLOCK_SIZE = 64;

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export interface Sha256 {
  /** 追加一段字节（可多次调用，等价于一次性对拼接结果求哈希） */
  update(bytes: Uint8Array): void;
  /** 输出 32 字节摘要（可重复调用，结果一致） */
  digest(): Uint8Array;
  /** 输出 64 位小写十六进制摘要 */
  hex(): string;
}

export function createSha256(): Sha256 {
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const block = new Uint8Array(BLOCK_SIZE);
  const words = new Uint32Array(64);
  let buffered = 0;
  let totalBytes = 0;

  function compress(bytes: Uint8Array, offset: number): void {
    for (let index = 0; index < 16; index += 1) {
      const at = offset + index * 4;
      words[index] =
        ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const w15 = words[index - 15];
      const w2 = words[index - 2];
      const s0 = (rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)) >>> 0;
      const s1 = (rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)) >>> 0;
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let index = 0; index < 64; index += 1) {
      const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + s1 + ch + K[index] + words[index]) >>> 0;
      const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  function absorb(bytes: Uint8Array, countLength: boolean): void {
    if (countLength) totalBytes += bytes.length;
    let offset = 0;

    if (buffered > 0) {
      const needed = BLOCK_SIZE - buffered;
      if (bytes.length < needed) {
        block.set(bytes, buffered);
        buffered += bytes.length;
        return;
      }
      block.set(bytes.subarray(0, needed), buffered);
      compress(block, 0);
      buffered = 0;
      offset = needed;
    }

    while (offset + BLOCK_SIZE <= bytes.length) {
      compress(bytes, offset);
      offset += BLOCK_SIZE;
    }

    if (offset < bytes.length) {
      block.set(bytes.subarray(offset), 0);
      buffered = bytes.length - offset;
    }
  }

  return {
    update(bytes: Uint8Array): void {
      absorb(bytes, true);
    },
    digest(): Uint8Array {
      // 先快照：补位与压缩会推进内部状态，取完摘要必须还原，保证
      // ① 同一实例可重复取摘要且结果一致；② 取完摘要后仍可继续 update。
      const snapshot = {
        state: [h0, h1, h2, h3, h4, h5, h6, h7],
        buffered,
        totalBytes,
        block: block.slice(),
      };

      // 位长度必须在补位前取好（补位本身不参与计数）
      const bitLength = totalBytes * 8;
      const high = Math.floor(bitLength / 0x100000000);
      const low = bitLength >>> 0;

      const padding = new Uint8Array(buffered < 56 ? 56 - buffered : 120 - buffered);
      padding[0] = 0x80;
      absorb(padding, false);

      const tail = new Uint8Array(8);
      tail[0] = (high >>> 24) & 0xff;
      tail[1] = (high >>> 16) & 0xff;
      tail[2] = (high >>> 8) & 0xff;
      tail[3] = high & 0xff;
      tail[4] = (low >>> 24) & 0xff;
      tail[5] = (low >>> 16) & 0xff;
      tail[6] = (low >>> 8) & 0xff;
      tail[7] = low & 0xff;
      absorb(tail, false);

      const out = new Uint8Array(32);
      const finalState = [h0, h1, h2, h3, h4, h5, h6, h7];
      for (let index = 0; index < 8; index += 1) {
        out[index * 4] = (finalState[index] >>> 24) & 0xff;
        out[index * 4 + 1] = (finalState[index] >>> 16) & 0xff;
        out[index * 4 + 2] = (finalState[index] >>> 8) & 0xff;
        out[index * 4 + 3] = finalState[index] & 0xff;
      }

      [h0, h1, h2, h3, h4, h5, h6, h7] = snapshot.state;
      buffered = snapshot.buffered;
      totalBytes = snapshot.totalBytes;
      block.set(snapshot.block);

      return out;
    },
    hex(): string {
      return Array.from(this.digest())
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    },
  };
}

/** 一次性计算字节数组的 SHA-256 */
export function sha256Hex(bytes: Uint8Array): string {
  const hasher = createSha256();
  hasher.update(bytes);
  return hasher.hex();
}
