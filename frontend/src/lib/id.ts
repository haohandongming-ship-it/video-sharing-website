/**
 * 生成请求幂等键。
 *
 * `crypto.randomUUID()` 只在安全上下文（https / localhost / 127.0.0.1）可用；局域网里其他设备用
 * `http://<内网IP>:5173` 打开时它是 `undefined`，直接调用会让所有幂等写请求（上传 init/complete、
 * 发评论、举报……）在发请求前就抛异常。这里退回 `getRandomValues`（该 API 在非安全上下文同样可用）
 * 自行拼 RFC 4122 v4；两者都没有时才用 Math.random 兜底（幂等键不承担安全用途）。
 */
export function randomId(): string {
  const webCrypto = globalThis.crypto;

  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();

  if (typeof webCrypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    webCrypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  const fallback = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${fallback()}${fallback()}-${fallback()}-4${fallback().slice(1)}-a${fallback().slice(1)}-${fallback()}${fallback()}${fallback()}`;
}
