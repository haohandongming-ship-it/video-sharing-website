import type { Quality, ReportReason, VideoType } from '@/api/types';

export const APP_NAME = '光影';
export const APP_SLOGAN = '看见每一种表达';

/**
 * 搜索历史在 localStorage 中的键（`lib/storage` 会自动加上 `vs-` 前缀）。
 *
 * <p>搜索历史按**设备**存储、不带账号维度，属于个人痕迹，因此登出时必须清理
 * （见 `app/sessionCleanup.ts`）。抽成常量是为了让写入方与清理方共用同一来源。</p>
 */
export const SEARCH_HISTORY_KEY = 'search-history';

/** 上传限制（文档 10.1） */
export const UPLOAD_LIMITS = {
  partSize: 8 * 1024 * 1024,
  maxConcurrency: 3,
  long: { maxSize: 8 * 1024 * 1024 * 1024, maxDuration: 4 * 3600, label: '长视频' },
  short: { maxSize: 500 * 1024 * 1024, maxDuration: 3 * 60, label: '短视频' },
} as const;

export const ALLOWED_EXTENSIONS = ['mp4', 'mov', 'webm', 'm4v'] as const;
export const ALLOWED_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
] as const;

export const VIDEO_MAX_TITLE = 200;
export const COMMENT_MAX_LENGTH = 1000;
export const COMMENT_PAGE_SIZE = 20;
export const REPLY_PREVIEW_COUNT = 3;

export const QUALITY_LABELS: Record<Quality, string> = {
  source: '原始文件',
  '360p': '流畅 360P',
  '480p': '清晰 480P',
  '720p': '高清 720P',
  '1080p': '超清 1080P',
};

export const QUALITY_ORDER: Quality[] = ['1080p', '720p', '480p', '360p'];

/**
 * 长视频清晰度梯度（播放器菜单与设置页「默认清晰度」共用同一份定义）。
 * `null` 表示自动：交给 hls.js 的 ABR 按带宽切换。
 */
export const QUALITY_TIERS: { value: Quality | null; label: string; description: string }[] = [
  { value: null, label: '自动', description: '按网络状况自动切换清晰度' },
  { value: '1080p', label: '1080P', description: '画质优先，流量消耗较高' },
  { value: '720p', label: '720P', description: '画质与流量平衡' },
  { value: '480p', label: '480P', description: '流量优先，网络较差时更流畅' },
];

export const RATE_OPTIONS = [2, 1.5, 1.25, 1, 0.75, 0.5] as const;

/** 播放计数规则（文档 11.3）：观看 ≥3s 且 24h 内去重 */
export const VIEW_COUNT_MIN_SECONDS = 3;
export const VIEW_COUNT_MIN_SECONDS_SHORT = 1;
/** 记忆播放进度上报节流（文档 5.6） */
export const PROGRESS_REPORT_INTERVAL = 15_000;

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'PORN', label: '色情低俗' },
  { value: 'VIOLENCE', label: '暴力血腥' },
  { value: 'ILLEGAL', label: '违法违规' },
  { value: 'INFRINGEMENT', label: '侵权盗版' },
  { value: 'SPAM', label: '垃圾广告' },
  { value: 'ABUSE', label: '人身攻击' },
  { value: 'OTHER', label: '其他' },
];

export const VIDEO_STATUS_LABELS: Record<string, string> = {
  PROCESSING: '转码中',
  REVIEWING: '审核中',
  PUBLISHED: '已发布',
  REJECTED: '未通过',
  DELETED: '已删除',
};

export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  LIKE: '赞了你的视频',
  COMMENT: '评论了你的视频',
  REPLY: '回复了你',
  FOLLOW: '关注了你',
  FAVORITE: '收藏了你的视频',
  SYSTEM: '系统通知',
  REVIEW: '审核结果',
  SUBSCRIPTION: '订阅更新',
};

export const CATEGORY_FALLBACK = [
  { id: 1, name: '动画', slug: 'anime', sortOrder: 1 },
  { id: 2, name: '番剧', slug: 'bangumi', sortOrder: 2 },
  { id: 3, name: '科技', slug: 'tech', sortOrder: 3 },
  { id: 4, name: '游戏', slug: 'game', sortOrder: 4 },
  { id: 5, name: '音乐', slug: 'music', sortOrder: 5 },
  { id: 6, name: '舞蹈', slug: 'dance', sortOrder: 6 },
  { id: 7, name: '生活', slug: 'life', sortOrder: 7 },
  { id: 8, name: '知识', slug: 'knowledge', sortOrder: 8 },
  { id: 9, name: '影视', slug: 'movie', sortOrder: 9 },
  { id: 10, name: '美食', slug: 'food', sortOrder: 10 },
  { id: 11, name: '体育', slug: 'sports', sortOrder: 11 },
  { id: 12, name: '汽车', slug: 'car', sortOrder: 12 },
];

export const RANKING_TABS = [
  { key: 'hot', label: '热门榜', desc: '每 10 分钟更新' },
  { key: 'trend', label: '趋势榜', desc: '每 5 分钟更新' },
  { key: 'category', label: '分类榜', desc: '每 30 分钟更新' },
  { key: 'newcomer', label: '新人榜', desc: '每小时更新' },
] as const;

export const RANKING_PERIODS = [
  { key: 'daily', label: '日榜' },
  { key: 'weekly', label: '周榜' },
  { key: 'monthly', label: '月榜' },
  { key: 'all', label: '总榜' },
] as const;

export const COMMENT_SORTS = [
  { key: 'hot', label: '最热' },
  { key: 'new', label: '最新' },
] as const;

export const VIDEO_TYPE_LABELS: Record<VideoType, string> = {
  LONG: '长视频',
  SHORT: '短视频',
};

export const KEYBOARD_SHORTCUTS = [
  { keys: '空格 / K', action: '播放 / 暂停' },
  { keys: '← / →', action: '快退 / 快进 5 秒' },
  { keys: '↑ / ↓', action: '音量 +5% / -5%' },
  { keys: 'F', action: '全屏切换' },
  { keys: 'M', action: '静音切换' },
  { keys: 'C', action: '开启 / 关闭字幕' },
  { keys: '0-9', action: '跳转到 0% - 90%' },
  { keys: 'D', action: '开启 / 关闭弹幕' },
] as const;
