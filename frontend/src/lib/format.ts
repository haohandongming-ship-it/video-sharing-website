import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import relativeTime from 'dayjs/plugin/relativeTime';
import duration from 'dayjs/plugin/duration';

dayjs.locale('zh-cn');
dayjs.extend(relativeTime);
dayjs.extend(duration);

/** 1.2万 / 3.4亿：播放量、点赞数等计数展示 */
export function formatCount(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  if (n < 10000) return String(Math.trunc(n));
  if (n < 100000000) {
    const w = n / 10000;
    return `${w >= 100 ? Math.round(w) : w.toFixed(1).replace(/\.0$/, '')}万`;
  }
  const y = n / 100000000;
  return `${y.toFixed(1).replace(/\.0$/, '')}亿`;
}

/** 秒 → 03:21 / 1:02:03 */
export function formatDuration(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.floor(Number(seconds ?? 0)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (v: number) => String(v).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** 时间点 → 01:23（用于弹幕/时间轴） */
export function formatTimecode(seconds: number): string {
  return formatDuration(seconds);
}

export function formatDate(input: string | number | Date, template = 'YYYY-MM-DD'): string {
  return dayjs(input).format(template);
}

export function formatDateTime(input: string | number | Date): string {
  return dayjs(input).format('YYYY-MM-DD HH:mm');
}

/** 3分钟前 / 昨天 / 2026-09-10 */
export function formatRelative(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  const d = dayjs(input);
  if (!d.isValid()) return '';
  const diffSeconds = dayjs().diff(d, 'second');
  if (diffSeconds < 60) return '刚刚';
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}分钟前`;
  if (dayjs().isSame(d, 'day')) return `${Math.floor(diffSeconds / 3600)}小时前`;
  if (dayjs().subtract(1, 'day').isSame(d, 'day')) return `昨天 ${d.format('HH:mm')}`;
  if (dayjs().isSame(d, 'year')) return d.format('MM-DD');
  return d.format('YYYY-MM-DD');
}

export function formatFileSize(bytes: number | null | undefined): string {
  const n = Number(bytes ?? 0);
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** 秒 → 「1 小时 20 分」「2 分 30 秒」 */
export function formatDurationText(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

/** 手机号脱敏：138****1234（合规展示要求，见 13.2） */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}

export { dayjs };
