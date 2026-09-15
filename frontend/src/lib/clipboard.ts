/**
 * 复制文本到剪贴板。
 *
 * `navigator.clipboard` 只在安全上下文（https / localhost / 127.0.0.1）可用，局域网设备用
 * `http://<内网IP>:5173` 打开时它是 `undefined`。这里统一降级为「临时 textarea + execCommand」，
 * 并返回是否成功，调用方据此决定提示文案（而不是抛异常或弹出「已复制」的假提示）。
 */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;

  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      /* 权限被拒或无焦点：继续走降级路径 */
    }
  }

  if (typeof document === 'undefined') return false;

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const copied = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}
