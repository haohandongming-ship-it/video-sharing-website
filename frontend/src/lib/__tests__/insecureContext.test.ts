import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createSha256, sha256Hex } from '@/lib/sha256';
import { randomId } from '@/lib/id';
import { copyText } from '@/lib/clipboard';
import { computeSha256 } from '@/features/upload/uploadEngine';

const encode = (text: string) => new TextEncoder().encode(text);

describe('纯 JS SHA-256（非安全上下文下替代 crypto.subtle）', () => {
  it('匹配 FIPS 180-4 标准向量', () => {
    expect(sha256Hex(encode(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    // 需要跨多个 64 字节块，覆盖分块与补位边界
    const million = new Uint8Array(1_000_000).fill(0x61);
    expect(sha256Hex(million)).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('流式分片结果与一次性计算一致（含 55/56/64 字节等边界）', () => {
    for (const size of [0, 1, 55, 56, 57, 63, 64, 65, 127, 128, 1000, 4096]) {
      const bytes = new Uint8Array(size);
      for (let index = 0; index < size; index += 1) bytes[index] = (index * 31 + 7) & 0xff;

      const oneShot = createSha256();
      oneShot.update(bytes);

      const streamed = createSha256();
      let offset = 0;
      while (offset < size) {
        const step = Math.min((offset % 7) + 1, size - offset);
        streamed.update(bytes.subarray(offset, offset + step));
        offset += step;
      }

      const expected = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
      expect(oneShot.hex()).toBe(expected);
      expect(streamed.hex()).toBe(expected);
      // 同一实例重复取摘要必须稳定
      expect(streamed.hex()).toBe(expected);
    }
  });

  it('与 Node crypto 在随机数据上等价', () => {
    for (let round = 0; round < 6; round += 1) {
      const size = Math.floor(Math.random() * 300_000);
      const bytes = new Uint8Array(size);
      for (let index = 0; index < size; index += 1) bytes[index] = Math.floor(Math.random() * 256);
      expect(sha256Hex(bytes)).toBe(createHash('sha256').update(Buffer.from(bytes)).digest('hex'));
    }
  });
});

describe('上传哈希在非安全上下文可用（局域网 http 场景）', () => {
  it('crypto.subtle 不存在时仍能算出正确 SHA-256（局域网设备上传的根因回归）', async () => {
    const bytes = new Uint8Array(300_000);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 17 + 3) & 0xff;
    const expected = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
    const file = new File([bytes], 'clip.mp4', { type: 'video/mp4' });

    const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');
    try {
      // 模拟 http://<内网IP>:5173：非安全上下文没有 crypto.subtle
      Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: undefined });
      const ratios: number[] = [];
      await expect(computeSha256(file, (ratio) => ratios.push(ratio))).resolves.toBe(expected);
      expect(ratios.at(-1)).toBe(1);
    } finally {
      if (original) Object.defineProperty(globalThis.crypto, 'subtle', original);
    }

    // 有 crypto.subtle 时结果必须一致，避免两条路径产生不同哈希导致秒传/校验失败
    await expect(computeSha256(file)).resolves.toBe(expected);
  });
});

describe('幂等键生成（非安全上下文下替代 crypto.randomUUID）', () => {  it('优先使用 randomUUID，缺失时退回 getRandomValues 且仍是合法 v4', () => {
    const first = randomId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const original = { randomUUID: crypto.randomUUID, getRandomValues: crypto.getRandomValues };
    try {
      // 模拟局域网 http：没有 randomUUID，只有 getRandomValues
      Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
      const fallback = randomId();
      expect(fallback).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(new Set([fallback, randomId(), randomId()]).size).toBe(3);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: original.randomUUID });
      Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: original.getRandomValues });
    }
  });
});

describe('剪贴板降级（非安全上下文下替代 navigator.clipboard）', () => {
  it('clipboard 可用时走原生实现', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      await expect(copyText('hello')).resolves.toBe(true);
      expect(writeText).toHaveBeenCalledWith('hello');
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    }
  });

  it('clipboard 不存在时退回 execCommand，并如实返回结果', async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const originalExec = (document as Document & { execCommand?: unknown }).execCommand;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    try {
      // jsdom 未实现 execCommand：此时应返回 false 而不是抛异常
      Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined });
      await expect(copyText('fallback')).resolves.toBe(false);

      const exec = vi.fn().mockReturnValue(true);
      Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
      await expect(copyText('fallback')).resolves.toBe(true);
      expect(exec).toHaveBeenCalledWith('copy');
      // 临时 textarea 必须被清理
      expect(document.querySelectorAll('textarea')).toHaveLength(0);
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      Object.defineProperty(document, 'execCommand', { configurable: true, value: originalExec });
    }
  });
});
