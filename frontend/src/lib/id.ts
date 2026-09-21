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

/** 乐观更新临时 id 的自增序号，用于区分同一毫秒内的多次提交。 */
let temporaryIdSequence = 0;

/**
 * 生成乐观更新用的临时**数字** id（负数，与真实的数据库 id 区分）。
 *
 * <p>此前各调用点直接写 `-Date.now()`：同一毫秒内连续两次提交会得到相同的 id，
 * 既会让 React 列表 key 冲突，也会让后续「按 id 定位并替换」的逻辑把两条记录搞混。</p>
 *
 * <p>用「毫秒时间戳 × 1000 + 自增序号」保证单调唯一。上界约 1.8e15，仍在
 * {@code Number.MAX_SAFE_INTEGER}（约 9.0e15）之内，不会丢失精度。</p>
 */
export function temporaryNumericId(): number {
  temporaryIdSequence = (temporaryIdSequence + 1) % 1000;
  return -(Date.now() * 1000 + temporaryIdSequence);
}
