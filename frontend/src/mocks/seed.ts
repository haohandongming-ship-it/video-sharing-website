/**
 * Mock 数据种子层 —— 后端未就绪时提供确定性、可复现的演示数据。
 *
 * 设计要点：
 * 1. 全部使用确定性伪随机（mulberry32），同一次构建/刷新得到一致结果，便于测试与截图；
 * 2. 时间基于「相对当前时间」生成，保证「3 分钟前 / 昨天」等相对时间展示真实；
 * 3. 封面/头像使用内联 SVG（data URL），不依赖外网图片，离线可用且零网络开销。
 */
import type {
  AdminOverview,
  AdminUserRow,
  AppNotification,
  AuditLogRow,
  Category,
  CommentItem,
  Conversation,
  DirectMessage,
  FeedPost,
  PlatformSettings,
  ReportTask,
  ReviewTask,
  Role,
  UserBrief,
  UserProfile,
  VideoDetail,
  VideoStatus,
  VideoSummary,
  VideoType,
} from '@/api/types';

/* ------------------------------------------------------------------ 随机数 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rng = mulberry32(20260913);
export function resetRandom(seed = 20260913): void {
  rng = mulberry32(seed);
}
export const rand = () => rng();
export const randInt = (min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;
export const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];
export const pickMany = <T>(list: readonly T[], count: number): T[] => {
  const pool = [...list];
  const out: T[] = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    out.push(...pool.splice(Math.floor(rng() * pool.length), 1));
  }
  return out;
};

/* ------------------------------------------------------------- 图像生成器 */

const COVER_PALETTES: [string, string][] = [
  ['#1f2937', '#4b5563'],
  ['#7f1d1d', '#dc2626'],
  ['#0c4a6e', '#0ea5e9'],
  ['#14532d', '#22c55e'],
  ['#78350f', '#f59e0b'],
  ['#3b0764', '#a855f7'],
  ['#831843', '#ec4899'],
  ['#0f172a', '#334155'],
  ['#134e4a', '#14b8a6'],
  ['#422006', '#eab308'],
];

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** 渐变封面 + 几何噪点，避免纯色块的廉价感 */
export function coverUrl(seed: number, label: string, ratio: '16:9' | '9:16' = '16:9'): string {
  const r = mulberry32(seed * 7919 + 13);
  const [from, to] = COVER_PALETTES[Math.floor(r() * COVER_PALETTES.length)];
  const w = ratio === '16:9' ? 640 : 405;
  const h = ratio === '16:9' ? 360 : 720;
  const circles = Array.from({ length: 5 }, (_, i) => {
    const cx = Math.round(r() * w);
    const cy = Math.round(r() * h);
    const rad = Math.round((0.12 + r() * 0.3) * Math.min(w, h));
    const op = (0.05 + r() * 0.12).toFixed(3);
    return `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="#fff" opacity="${op}"${i % 2 ? '' : ` stroke="#fff" stroke-opacity="0.06"`} />`;
  }).join('');
  const text = label.slice(0, 14).replace(/[<>&]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>${circles}
<g opacity="0.9" font-family="PingFang SC, Noto Sans SC, sans-serif" font-size="${ratio === '16:9' ? 30 : 26}" font-weight="600" fill="#fff">
<text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="middle">${text}</text></g>
</svg>`;
  return svgToDataUrl(svg);
}

/** 头像：首字母 + 品牌色系，确定性配色 */
export function avatarUrl(seed: number, name: string): string {
  const r = mulberry32(seed * 104729 + 7);
  const hue = Math.floor(r() * 360);
  const initial = name.slice(0, 1).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
<defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="hsl(${hue} 62% 48%)"/><stop offset="100%" stop-color="hsl(${(hue + 38) % 360} 58% 36%)"/>
</linearGradient></defs>
<rect width="128" height="128" fill="url(#a)"/>
<text x="64" y="70" text-anchor="middle" dominant-baseline="middle" font-family="PingFang SC, sans-serif" font-size="56" font-weight="600" fill="#fff">${initial}</text>
</svg>`;
  return svgToDataUrl(svg);
}

/* ------------------------------------------------------------------ 时间 */

const NOW = Date.now();
export const now = () => Date.now();
export const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
export const hoursAgo = (h: number) => minutesAgo(h * 60);
export const daysAgo = (d: number) => hoursAgo(d * 24);

/* ------------------------------------------------------------------ 分类 */

export const CATEGORIES: Category[] = [
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

/* ------------------------------------------------------------------ 用户 */

interface SeedUser {
  id: number;
  username: string;
  nickname: string;
  bio: string;
  role: Role;
  certified: boolean;
  permissions: UserProfile['permissions'];
}

const BASE_PERMISSIONS: UserProfile['permissions'] = [
  'video:upload',
  'video:manage_own',
  'creator:dashboard',
  'video:download',
];

const SEED_USERS: SeedUser[] = [
  {
    id: 1,
    username: 'admin',
    nickname: '平台管理员',
    bio: '光影平台官方账号，负责社区秩序与规则解释。',
    role: 'ADMIN',
    certified: true,
    permissions: [
      ...BASE_PERMISSIONS,
      'moderation:review',
      'moderation:report',
      'admin:user_manage',
      'admin:role_assign',
      'admin:system_config',
      'admin:analytics',
    ],
  },
  {
    id: 2,
    username: 'moderator',
    nickname: '审核员小柯',
    bio: '内容安全与社区规范。举报处理请走站内通道。',
    role: 'MODERATOR',
    certified: true,
    permissions: [...BASE_PERMISSIONS, 'moderation:review', 'moderation:report'],
  },
  {
    id: 3,
    username: 'laowang',
    nickname: '架构师老王',
    bio: '十年后端，聊架构也聊踩坑。更新频率：每周两更。',
    role: 'USER',
    certified: true,
    permissions: BASE_PERMISSIONS,
  },
  {
    id: 4,
    username: 'chuli',
    nickname: '厨房里的小李',
    bio: '家常菜 / 一人食 / 深夜食堂。做饭是件很治愈的事。',
    role: 'USER',
    certified: true,
    permissions: BASE_PERMISSIONS,
  },
  {
    id: 5,
    username: 'kaihei',
    nickname: '开黑不求人',
    bio: '主机游戏 & 独立游戏，偶尔直播。',
    role: 'USER',
    certified: false,
    permissions: ['video:upload', 'video:manage_own'],
  },
  {
    id: 6,
    username: 'yinyue',
    nickname: '深夜唱片机',
    bio: '每天一首冷门好歌，歌单在收藏夹。',
    role: 'USER',
    certified: true,
    permissions: BASE_PERMISSIONS,
  },
  {
    id: 7,
    username: 'bike',
    nickname: '骑行看世界',
    bio: '用两轮丈量城市，4K 第一视角。',
    role: 'USER',
    certified: false,
    permissions: ['video:upload', 'video:manage_own'],
  },
  {
    id: 8,
    username: 'shuma',
    nickname: '数码评测局',
    bio: '只说真话的数码体验，数据说话。',
    role: 'USER',
    certified: true,
    permissions: BASE_PERMISSIONS,
  },
  {
    id: 9,
    username: 'xuexi',
    nickname: '一小时学会',
    bio: '把复杂的东西讲简单。',
    role: 'USER',
    certified: true,
    permissions: BASE_PERMISSIONS,
  },
  {
    id: 10,
    username: 'donghua',
    nickname: '动画研究所',
    bio: '分镜、作画、演出，逐帧拆解。',
    role: 'USER',
    certified: false,
    permissions: ['video:upload', 'video:manage_own'],
  },
  {
    id: 11,
    username: 'newbie',
    nickname: '刚注册的小白',
    bio: '第一次来，请多指教。',
    role: 'USER',
    certified: false,
    permissions: ['video:upload'],
  },
  {
    id: 12,
    username: 'cheyou',
    nickname: '老车主阿强',
    bio: '十年修车工，帮你避坑。',
    role: 'USER',
    certified: true,
    permissions: BASE_PERMISSIONS,
  },
];

const userBriefCache = new Map<number, UserBrief>();

export function briefOf(id: number): UserBrief {
  const cached = userBriefCache.get(id);
  if (cached) return cached;
  const s = SEED_USERS.find((u) => u.id === id) ?? SEED_USERS[2];
  const brief: UserBrief = {
    id: s.id,
    username: s.username,
    nickname: s.nickname,
    avatar: avatarUrl(s.id, s.nickname),
    bio: s.bio,
    certified: s.certified,
    followerCount: 12_000 + s.id * 8_137,
  };
  userBriefCache.set(id, brief);
  return brief;
}

/** 演示账号：密码统一 123456，验证码统一 123456 */
export const DEMO_ACCOUNTS: { account: string; password: string; userId: number; label: string }[] = [
  { account: 'admin', password: '123456', userId: 1, label: '管理员' },
  { account: 'moderator', password: '123456', userId: 2, label: '审核员' },
  { account: 'laowang', password: '123456', userId: 3, label: '创作者' },
  { account: 'newbie', password: '123456', userId: 11, label: '新用户（先审后发）' },
];

export function profileOf(id: number, viewerId: number | null = null): UserProfile {
  const s = SEED_USERS.find((u) => u.id === id) ?? SEED_USERS[2];
  return {
    ...briefOf(s.id),
    role: s.role,
    status: 'ACTIVE',
    permissions: s.permissions,
    followingCount: 40 + s.id * 3,
    videoCount: 12 + s.id * 2,
    totalViews: 250_000 + s.id * 91_337,
    totalLikes: 8_000 + s.id * 3_211,
    createdAt: daysAgo(200 + s.id * 11),
    followed: viewerId !== null && viewerId !== s.id && (s.id + viewerId) % 3 !== 0,
    mutual: viewerId !== null && (s.id + viewerId) % 5 === 0,
    subscribed: viewerId !== null && (s.id + viewerId) % 4 === 0,
    email: `${s.username}@example.com`,
    phone: `138${String(10_000_000 + s.id * 1_234).slice(0, 8)}`,
    realNameStatus: s.certified ? 'CERTIFIED' : 'NONE',
  };
}

export const ALL_BRIEFS: UserBrief[] = SEED_USERS.map((u) => briefOf(u.id));

/* ------------------------------------------------------------------ 视频 */

const LONG_TITLES = [
  '从零构建视频分享平台 · 架构篇：为什么我们放弃了单体直传',
  '四小时搞懂 MySQL 索引：从 B+ 树到执行计划',
  '我用一周时间把家里的旧电脑改造成了 NAS',
  '深度拆解：一个高并发点赞系统是怎么设计的',
  'React 19 新特性实战，编译器到底省了多少代码',
  '重装系统后我必装的 12 个软件（2026 版）',
  '从 0 到 1 搭建可观测性体系：日志、指标、链路追踪',
  '为什么你的接口这么慢？一次真实的性能排查复盘',
  'Redis 持久化到底怎么选：RDB、AOF 还是混合',
  '手把手教你读论文：Transformer 到底在算什么',
  '一台相机拍出电影感：光线、构图与调色的关系',
  '骑行 120 公里穿越海岸线，全程第一视角',
  '家常红烧肉的七个关键步骤，肥而不腻',
  '三十分钟做出好吃的咖喱，比外卖快',
  '显卡到底怎么选？2026 年装机避坑指南',
  '修车十年，这些保养项目其实完全没必要做',
  '独立游戏推荐：这五款被严重低估了',
  '黑神话之后，国产单机还剩下什么',
  '冷门爵士歌单：适合深夜写代码的十首',
  '一集看懂动画分镜：从脚本到成片',
  '当一个程序员决定去学跳舞',
  '手机摄影进阶：如何用好那颗被忽略的长焦',
  '我用三个月减了 15 公斤，没有节食',
  '看完这期，你也能读懂财报',
  '租房改造：2000 块让出租屋焕然一新',
  '全网最细：HLS 与 DASH 到底有什么区别',
  '程序员的一天：远程办公第三年',
  '聊聊裁员：技术人该如何建立自己的护城河',
];

const SHORT_TITLES = [
  '三秒教会你这个转场',
  '这个镜头我拍了 47 遍',
  '当你把音量开到最大',
  '猫：这个家没我得散',
  '打工人下班后的第一口',
  '这可能是今天最治愈的 15 秒',
  '摄影师不会告诉你的小技巧',
  '一分钟看完一部电影',
  '代码写不出来的时候我在干什么',
  '凌晨四点的城市，长这样',
  '我妈说这个菜她能吃三碗饭',
  '这就是专业和业余的差距',
  '这个操作太解压了',
  '原来可以这么简单',
  '第一次见这种打法',
  '听完这段我起鸡皮疙瘩了',
  '这个配色绝了，建议收藏',
  '谁能拒绝一只会击掌的狗',
  '把所有滤镜删掉之后',
  '这就是我坚持了十年的原因',
  '花小钱办大事的快乐',
  '你绝对没注意到的细节',
  '这几秒值一个赞',
  '看完立刻想去试试',
];

const TAG_POOL = [
  '架构',
  'Spring Boot',
  'React',
  'TypeScript',
  'MySQL',
  'Redis',
  '性能优化',
  '职业成长',
  '装机',
  '美食',
  '家常菜',
  '骑行',
  '摄影',
  '调色',
  '游戏',
  '独立游戏',
  '动画',
  '分镜',
  '爵士',
  '歌单',
  '健身',
  '理财',
  '租房',
  '远程办公',
  '短视频',
  '教程',
];

export interface MockVideoRecord {
  detail: VideoDetail;
  /** 转码任务进度（PROCESSING 状态使用） */
  transcode: { progress: number; quality: string; status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' };
  /** 上传者所在信任分档位：新用户强制先审后发 */
  authorIsNew: boolean;
}

function buildVideo(id: number, type: VideoType, index: number): MockVideoRecord {
  const r = mulberry32(id * 2654435761);
  const authorSeed = SEED_USERS[2 + Math.floor(r() * (SEED_USERS.length - 2))];
  const title = type === 'LONG' ? LONG_TITLES[index % LONG_TITLES.length] : SHORT_TITLES[index % SHORT_TITLES.length];
  const category = CATEGORIES[Math.floor(r() * CATEGORIES.length)];
  const duration = type === 'LONG' ? randInt(240, 5400) : randInt(8, 178);
  const views = Math.floor((type === 'LONG' ? 3_000 : 20_000) * (0.4 + r() * 12));
  const status: VideoStatus = id % 37 === 0 ? 'PROCESSING' : id % 53 === 0 ? 'REVIEWING' : 'PUBLISHED';
  const qualities: VideoDetail['qualities'] =
    duration > 3600 ? ['360p', '480p', '720p', '1080p'] : duration > 600 ? ['360p', '480p', '720p'] : ['360p', '480p'];
  const publishedAt = type === 'LONG' ? daysAgo(Math.floor(r() * 120)) : hoursAgo(Math.floor(r() * 240));

  const detail: VideoDetail = {
    id,
    videoType: type,
    title,
    coverUrl: coverUrl(id, category.name + '区', type === 'LONG' ? '16:9' : '9:16'),
    duration,
    category,
    author: briefOf(authorSeed.id),
    stats: {
      views,
      likes: Math.floor(views * (0.03 + r() * 0.09)),
      dislikes: Math.floor(views * 0.002 * r()),
      comments: Math.floor(views * (0.002 + r() * 0.006)),
      favorites: Math.floor(views * (0.008 + r() * 0.03)),
      shares: Math.floor(views * 0.004 * r()),
      coins: Math.floor(views * 0.006 * r()),
    },
    publishedAt,
    status,
    visibility: 'PUBLIC',
    description:
      type === 'LONG'
        ? `本期内容围绕「${title.split('：')[0]}」展开。\n\n00:00 开场与本期结论\n02:10 背景与问题定义\n08:45 方案对比\n21:30 落地细节与踩坑\n38:00 总结与下期预告\n\n如果这期对你有帮助，欢迎点赞收藏，你的支持是我更新的最大动力。`
        : `#${category.name} #日常记录\n随手拍的片段，喜欢的话点个赞。`,
    tags: pickMany(TAG_POOL, randInt(3, 6)),
    qualities,
    hlsUrl: '/demo/hls/master.m3u8',
    downloadEnabled: type === 'LONG' && r() > 0.45,
    createdAt: publishedAt,
    updatedAt: publishedAt,
    liked: false,
    disliked: false,
    favorited: false,
    subscribed: false,
    recommendReason: r() > 0.6 ? `你最近常看「${category.name}」相关内容` : null,
  };

  return {
    detail,
    transcode: {
      progress: status === 'PROCESSING' ? randInt(5, 92) : 100,
      quality: qualities[qualities.length - 1],
      status: status === 'PROCESSING' ? 'RUNNING' : 'SUCCESS',
    },
    authorIsNew: authorSeed.id === 11,
  };
}

export const VIDEO_STORE: MockVideoRecord[] = [
  // 保留一小组稳定数据，覆盖首页、短视频、审核和播放流程即可。
  ...Array.from({ length: 24 }, (_, i) => buildVideo(10_001 + i, 'LONG', i)),
  ...Array.from({ length: 12 }, (_, i) => buildVideo(20_001 + i, 'SHORT', i)),
];

export function findVideo(id: number): MockVideoRecord | undefined {
  return VIDEO_STORE.find((v) => v.detail.id === id);
}

/** 将上传任务登记到内存视频库，使审核通过后首页查询可以立即看到新内容。 */
export function registerUploadedVideo(task: MockUploadTask, authorId: number): MockVideoRecord {
  const existing = findVideo(task.videoId);
  if (existing) return existing;
  const category = CATEGORIES.find((item) => item.id === task.categoryId) ?? CATEGORIES[0];
  const publishedAt = new Date().toISOString();
  const duration = Math.max(1, task.duration ?? 0);
  const qualities: VideoDetail['qualities'] = duration > 1800 ? ['360p', '480p', '720p'] : ['360p', '480p'];
  const detail: VideoDetail = {
    id: task.videoId,
    videoType: task.videoType,
    title: task.title,
    coverUrl: coverUrl(task.videoId, category.name, task.videoType === 'SHORT' ? '9:16' : '16:9'),
    duration,
    category,
    author: briefOf(authorId),
    stats: { views: 0, likes: 0, dislikes: 0, comments: 0, favorites: 0, shares: 0, coins: 0 },
    publishedAt,
    status: 'REVIEWING',
    visibility: task.visibility ?? 'PUBLIC',
    description: task.description ?? '',
    tags: [],
    qualities,
    hlsUrl: `/api/v1/videos/${task.videoId}/source`,
    downloadEnabled: false,
    createdAt: publishedAt,
    updatedAt: publishedAt,
    liked: false,
    disliked: false,
    favorited: false,
    subscribed: false,
    recommendReason: null,
  };
  const record: MockVideoRecord = { detail, transcode: { progress: 100, quality: qualities.at(-1) ?? '480p', status: 'SUCCESS' }, authorIsNew: authorId === 11 };
  VIDEO_STORE.unshift(record);
  return record;
}

export function toSummary(detail: VideoDetail): VideoSummary {
  const {
    description: _d,
    tags: _t,
    qualities: _q,
    hlsUrl: _h,
    downloadEnabled: _de,
    createdAt: _c,
    updatedAt: _u,
    liked: _l,
    disliked: _di,
    favorited: _f,
    subscribed: _s,
    reviewNote: _r,
    recommendReason: _rr,
    ...summary
  } = detail;
  return summary;
}

/* --------------------------------------------------------------- 互动状态 */

/** 当前会话的互动状态（登录后生效） */
export const engagement = {
  liked: new Set<number>(),
  disliked: new Set<number>(),
  favorited: new Set<number>(),
  subscribed: new Set<number>(),
  followed: new Set<number>(),
  /** 我的收藏夹 */
  favoriteFolders: [
    { id: 1, name: '默认收藏夹', count: 42, isDefault: true },
    { id: 2, name: '稍后观看', count: 17, isDefault: false },
  ],
  /** 观看历史：videoId → 进度秒 */
  history: new Map<number, number>(),
  playlists: [
    { id: 1, name: '架构系列', count: 12, cover: coverUrl(9001, '架构系列') },
    { id: 2, name: '睡前歌单', count: 30, cover: coverUrl(9002, '睡前歌单') },
  ],
};

/* ------------------------------------------------------------------ 评论 */

const COMMENT_TEMPLATES = [
  '讲得太清楚了，比我看文档快十倍。',
  '这个点我之前一直没搞明白，感谢！',
  '已三连，坐等下一期。',
  '第 8 分钟那段我反复看了三遍。',
  '作为同行，这个方案确实优雅。',
  '有个疑问：如果并发再高一个量级，这里还成立吗？',
  '收藏了，明天上班就试试。',
  '背景音乐叫什么名字呀？',
  '终于有人把这件事讲明白了。',
  '这个结论我不太同意，稍后整理一下理由发出来。',
  '别的不说，剪辑是真的用心。',
  '看完立刻分享给了同事。',
  '每次更新都第一时间来看。',
  '这期信息密度好高，需要记笔记。',
  '看到一半忍不住来评论。',
  '希望出一期进阶版。',
  '已经按这个方法跑通了，回来还愿。',
  'up 主的声音好治愈。',
  '这段动画做得真好看。',
  '冷静、客观、有数据，难得。',
];

const REPLY_TEMPLATES = [
  '同问，蹲一个解答。',
  '我猜是因为缓存命中率的问题。',
  '楼上说得对，补充一点：还要考虑网络抖动。',
  '感谢支持！下期会讲到这块。',
  '这个场景下确实要考虑降级。',
  '已经记下了，之后单独出一期。',
];

export interface MockComment extends CommentItem {
  replies: CommentItem[];
}

function buildComments(videoId: number, count: number): MockComment[] {
  const r = mulberry32(videoId * 40503);
  return Array.from({ length: count }, (_, i) => {
    const id = videoId * 1000 + i;
    const user = briefOf(SEED_USERS[Math.floor(r() * SEED_USERS.length)].id);
    const replyCount = r() > 0.55 ? Math.floor(r() * 12) : 0;
    const previewCount = Math.min(3, replyCount);
    return {
      id,
      videoId,
      parentId: null,
      rootId: null,
      content: COMMENT_TEMPLATES[Math.floor(r() * COMMENT_TEMPLATES.length)],
      user,
      likeCount: Math.floor(r() * 2400),
      replyCount,
      liked: false,
      status: 'VISIBLE' as const,
      createdAt: hoursAgo(i * 7 + Math.floor(r() * 6)),
      isVideoAuthor: r() > 0.9,
      replies: Array.from({ length: previewCount }, (_, j) => ({
        id: id * 10 + j,
        videoId,
        parentId: id,
        rootId: id,
        content: REPLY_TEMPLATES[Math.floor(r() * REPLY_TEMPLATES.length)],
        user: briefOf(SEED_USERS[Math.floor(r() * SEED_USERS.length)].id),
        likeCount: Math.floor(r() * 180),
        replyCount: 0,
        liked: false,
        status: 'VISIBLE' as const,
        createdAt: hoursAgo(i * 7 + Math.floor(r() * 3)),
        isVideoAuthor: r() > 0.7,
      })),
    } satisfies MockComment;
  });
}

const commentStore = new Map<number, MockComment[]>();
export function commentsOf(videoId: number): MockComment[] {
  let list = commentStore.get(videoId);
  if (!list) {
    list = buildComments(videoId, randInt(3, 10));
    commentStore.set(videoId, list);
  }
  return list;
}

/* ------------------------------------------------------------------ 动态 */

const FEED_TEMPLATES = [
  '刚把新的推荐链路跑通，日志一眼能看懂的感觉真好。',
  '今天降温了，路上的人明显少了。',
  '拍了三年的素材终于剪完了，长舒一口气。',
  '求推荐一本讲分布式事务的书，看得有点晕。',
  '楼下那家面包店关门了，有点可惜。',
  '第一次尝试自己配肥料，希望绿萝能活。',
  '把键盘换成了静音的，室友终于不骂我了。',
  '周末去了趟海边，风大到站不稳。',
  '写代码最快乐的时刻：删掉了三百行。',
  '凌晨的便利店，关东煮和加班的人是绝配。',
  '重新开始跑步，第一天三公里。',
  '给猫买了个新窝，它睡在纸箱里。',
  '面馆老板记住了我的口味，有点感动。',
  '看完了一部老电影，后劲很大。',
  '整理了一下硬盘，翻出好多旧照片。',
];

export const FEED_POSTS: FeedPost[] = Array.from({ length: 12 }, (_, i) => {
  const id = 30_001 + i;
  const r = mulberry32(id * 22695477);
  const user = briefOf(SEED_USERS[Math.floor(r() * SEED_USERS.length)].id);
  const mediaCount = r() > 0.55 ? 1 + Math.floor(r() * 9) : 0;
  const isVideo = r() > 0.82;
  const content = FEED_TEMPLATES[i % FEED_TEMPLATES.length];
  return {
    id,
    type: 'ORIGINAL' as const,
    content,
    user,
    media: Array.from({ length: mediaCount }, (_, j) => ({
      id: id * 100 + j,
      mediaType: (isVideo && j === 0 ? 'VIDEO' : 'IMAGE') as 'VIDEO' | 'IMAGE',
      url: isVideo && j === 0 ? '/demo/hls/master.m3u8' : coverUrl(id * 10 + j, '图片', '16:9'),
      thumbUrl: coverUrl(id * 10 + j, '图片', '16:9'),
      width: 1200,
      height: 800,
      duration: isVideo && j === 0 ? 156 : undefined,
      videoId: isVideo && j === 0 ? 10_011 : undefined,
      sortOrder: j,
    })),
    topic: r() > 0.6 ? { id: 1 + Math.floor(r() * 6), name: pick(['今日份快乐', '程序员日常', '城市观察', '美食记录', '随手拍', '读书笔记']) } : null,
    mentions: r() > 0.85 ? [briefOf(SEED_USERS[Math.floor(r() * SEED_USERS.length)].id)] : [],
    repostOf: null,
    stats: {
      likes: Math.floor(r() * 3200),
      comments: Math.floor(r() * 480),
      reposts: Math.floor(r() * 160),
    },
    liked: false,
    createdAt: minutesAgo(i * 47 + Math.floor(r() * 40)),
    isOwner: user.id === 3,
  } satisfies FeedPost;
});

export function feedCommentsOf(feedId: number): CommentItem[] {
  const r = mulberry32(feedId * 7919);
  return Array.from({ length: randInt(2, 6) }, (_, i) => ({
    id: feedId * 100 + i,
    videoId: feedId,
    parentId: null,
    rootId: null,
    content: COMMENT_TEMPLATES[Math.floor(r() * COMMENT_TEMPLATES.length)],
    user: briefOf(SEED_USERS[Math.floor(r() * SEED_USERS.length)].id),
    likeCount: Math.floor(r() * 300),
    replyCount: 0,
    liked: false,
    status: 'VISIBLE' as const,
    createdAt: minutesAgo(i * 31 + 4),
  }));
}

/* ---------------------------------------------------------------- 通知 */

const NOTIFICATION_SEEDS: { type: AppNotification['type']; title: string; content: string }[] = [
  { type: 'LIKE', title: '收到新的点赞', content: '赞了你的视频《从零构建视频分享平台 · 架构篇》' },
  { type: 'COMMENT', title: '收到新的评论', content: '评论了你的视频：讲得太清楚了，比我看文档快十倍。' },
  { type: 'REPLY', title: '收到新的回复', content: '回复了你的评论：我猜是因为缓存命中率的问题。' },
  { type: 'FOLLOW', title: '新的关注者', content: '关注了你' },
  { type: 'FAVORITE', title: '视频被收藏', content: '收藏了你的视频《四小时搞懂 MySQL 索引》' },
  { type: 'REVIEW', title: '审核结果通知', content: '你的视频已通过审核并发布。' },
  { type: 'SYSTEM', title: '系统通知', content: '平台将于本周日凌晨 2:00-4:00 进行例行维护。' },
  { type: 'SUBSCRIPTION', title: '订阅更新', content: '你订阅的分区「科技」有 3 条新内容。' },
];

export const NOTIFICATIONS: AppNotification[] = Array.from({ length: 10 }, (_, i) => {
  const seed = NOTIFICATION_SEEDS[i % NOTIFICATION_SEEDS.length];
  const actor = seed.type === 'SYSTEM' || seed.type === 'SUBSCRIPTION' ? null : briefOf(SEED_USERS[3 + (i % 8)].id);
  return {
    id: 40_001 + i,
    type: seed.type,
    title: seed.title,
    content: seed.content,
    actor,
    targetType: seed.type === 'FOLLOW' ? 'USER' : 'VIDEO',
    targetId: seed.type === 'FOLLOW' ? (actor?.id ?? null) : 10_001 + (i % 20),
    isRead: i > 7,
    createdAt: minutesAgo(i * 63 + 5),
  } satisfies AppNotification;
});

export const CONVERSATIONS: Conversation[] = Array.from({ length: 3 }, (_, i) => {
  const peer = briefOf(SEED_USERS[3 + i].id);
  return {
    id: 50_001 + i,
    peer,
    lastMessage: pick(['好的，明天见', '文件我发你邮箱了', '这个方案我同意', '稍后回复你', '收到！', '感谢～']),
    lastMessageAt: minutesAgo(i * 37 + 3),
    unreadCount: i < 3 ? 1 + i : 0,
  } satisfies Conversation;
});

const dmStore = new Map<number, DirectMessage[]>();
export function messagesOf(conversationId: number): DirectMessage[] {
  let list = dmStore.get(conversationId);
  if (!list) {
    const conv = CONVERSATIONS.find((c) => c.id === conversationId);
    list = Array.from({ length: 6 }, (_, i) => ({
      id: conversationId * 100 + i,
      conversationId,
      senderId: i % 2 === 0 ? (conv?.peer.id ?? 3) : 3,
      content: pick([
        '你好，看了你的视频收获很大。',
        '谢谢支持！有问题随时问。',
        '想请教一下分片上传的重试策略。',
        '我们用的是指数退避 + 幂等键，服务端按 uploadId + partNumber 去重。',
        '明白了，感谢！',
      ]),
      attachment: null,
      createdAt: minutesAgo((10 - i) * 23),
      mine: i % 2 !== 0,
    }));
    dmStore.set(conversationId, list);
  }
  return list;
}

/* -------------------------------------------------------------- 管理后台 */

export const REVIEW_TASKS: ReviewTask[] = Array.from({ length: 8 }, (_, i) => {
  const r = mulberry32(6001 + i * 131);
  const video = VIDEO_STORE[(i * 3) % VIDEO_STORE.length].detail;
  return {
    id: 60_001 + i,
    video: toSummary(video),
    machineResult: (['PASS', 'SUSPECT', 'BLOCK'] as const)[Math.floor(r() * 3)],
    machineLabels: pickMany(['涉政', '低俗', '暴恐', '广告', '水印', '侵权', '正常'], randInt(1, 3)),
    riskLevel: (['LOW', 'MEDIUM', 'HIGH'] as const)[Math.floor(r() * 3)],
    reportCount: Math.floor(r() * 6),
    submittedAt: minutesAgo(i * 29 + 6),
    status: i > 5 ? pick(['APPROVED', 'REJECTED'] as const) : 'PENDING',
    reviewerId: i > 5 ? 2 : null,
    reviewNote: i > 5 ? '人工复核通过' : null,
  } satisfies ReviewTask;
});

export const REPORT_TASKS: ReportTask[] = Array.from({ length: 8 }, (_, i) => {
  const r = mulberry32(7001 + i * 977);
  const video = VIDEO_STORE[(i * 5) % VIDEO_STORE.length].detail;
  const targetType = pick(['VIDEO', 'COMMENT', 'FEED', 'USER'] as const);
  return {
    id: 70_001 + i,
    targetType,
    targetId: targetType === 'VIDEO' ? video.id : 1000 + i,
    targetTitle: targetType === 'VIDEO' ? video.title : `用户留言 #${1000 + i}`,
    targetSnapshot: '……这条内容中包含被举报的片段，点击可在新标签页打开原内容……',
    reason: pick(['PORN', 'VIOLENCE', 'ILLEGAL', 'INFRINGEMENT', 'SPAM', 'ABUSE', 'OTHER'] as const),
    description: pick([
      '视频第 3 分钟出现不当内容',
      '评论区有人身攻击',
      '疑似搬运他人作品',
      '大量刷屏广告链接',
      '标题与内容严重不符',
    ]),
    evidenceUrls: [],
    reporter: briefOf(SEED_USERS[3 + Math.floor(r() * 8)].id),
    status: i > 6 ? pick(['PROCESSING', 'RESOLVED', 'REJECTED'] as const) : 'PENDING',
    priority: Math.ceil(r() * 5),
    handlerId: i > 6 ? 2 : null,
    handledAt: i > 6 ? minutesAgo(i * 11) : null,
    createdAt: minutesAgo(i * 71 + 12),
  } satisfies ReportTask;
});

export const ADMIN_USERS: AdminUserRow[] = [
  ...SEED_USERS.map((u, i) => ({
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    avatar: avatarUrl(u.id, u.nickname),
    email: `${u.username}@example.com`,
    phone: `138${String(10_000_000 + u.id * 1234).slice(0, 8)}`,
    role: u.role,
    status: 'ACTIVE' as const,
    certified: u.certified,
    videoCount: 4 + i * 7,
    createdAt: daysAgo(30 + i * 9),
    lastLoginAt: hoursAgo(i * 3 + 1),
  })),
];

export const AUDIT_LOGS: AuditLogRow[] = Array.from({ length: 12 }, (_, i) => {
  const r = mulberry32(8001 + i * 373);
  const action = pick([
    'APPROVE_VIDEO',
    'REJECT_VIDEO',
    'BAN_USER',
    'UNBAN_USER',
    'ASSIGN_ROLE',
    'RESOLVE_REPORT',
    'UPDATE_SETTINGS',
    'DELETE_COMMENT',
  ]);
  return {
    id: 80_001 + i,
    operator: briefOf(SEED_USERS[Math.floor(r() * 2)].id),
    action,
    targetType: pick(['VIDEO', 'USER', 'REPORT', 'SETTING']),
    targetId: 10_000 + Math.floor(r() * 900),
    detail: { note: '操作已记录，可追溯', ip: `10.0.${Math.floor(r() * 255)}.${Math.floor(r() * 255)}` },
    createdAt: minutesAgo(i * 53 + 9),
  } satisfies AuditLogRow;
});

export function adminOverview(): AdminOverview {
  const trend = Array.from({ length: 14 }, (_, i) => {
    const r = mulberry32(9001 + i * 61);
    return {
      date: new Date(NOW - (13 - i) * 86_400_000).toISOString().slice(0, 10),
      uploads: 620 + Math.floor(r() * 900),
      views: 180_000 + Math.floor(r() * 320_000),
      newUsers: 240 + Math.floor(r() * 560),
    };
  });
  return {
    users: { total: 128_430, todayNew: 1_284, activeToday: 42_190, banned: 318 },
    videos: { total: 86_920, todayNew: 1_046, processing: 74, reviewing: 213 },
    interaction: { commentsToday: 38_412, likesToday: 512_884, reportsPending: 18 },
    transcode: { queued: 42, running: 11, failedToday: 6, avgSeconds: 187 },
    trend,
    categoryDistribution: CATEGORIES.map((c, i) => ({
      name: c.name,
      value: 4000 + ((i * 1487) % 9000),
    })),
  };
}

export const PLATFORM_SETTINGS: PlatformSettings = {
  review: { newUserForceReview: true, newUserWindowHours: 72, highTrustSampleRate: 0.05, autoReportThreshold: 5 },
  upload: {
    longMaxSizeGB: 8,
    shortMaxSizeMB: 500,
    longMaxDurationHours: 4,
    shortMaxDurationSeconds: 180,
    allowedExtensions: ['mp4', 'mov', 'webm', 'm4v'],
  },
  recommend: { personalizationEnabled: true, hotFallback: true },
  minor: { teenagerModeEnabled: false, dailyLimitMinutes: 40, nightBlockStart: '22:00', nightBlockEnd: '06:00' },
};

/* ---------------------------------------------------------- 当前会话状态 */

/**
 * Mock 会话存储
 *
 * 真实后端的登录态由 httpOnly Cookie 承载，刷新页面后前端可用 /auth/refresh 静默换新。
 * Mock 层没有 Cookie，因此把演示会话写入 sessionStorage（按标签页隔离、关闭即失效），
 * 从而在页面刷新/直接访问受保护路由时仍能还原登录态 —— 与真实行为保持一致。
 * 注意：这里存的是 Mock 演示标识，绝不涉及真实凭证；真实 Access Token 仍只存内存。
 */
const SESSION_KEY = 'vs-mock-session';

function readStoredSession(): { userId: number; accessToken: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { userId?: number; accessToken?: string };
    if (typeof parsed.userId !== 'number') return null;
    return { userId: parsed.userId, accessToken: parsed.accessToken ?? `mock.${parsed.userId}` };
  } catch {
    return null;
  }
}

function writeStoredSession(value: { userId: number; accessToken: string } | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) window.sessionStorage.removeItem(SESSION_KEY);
    else window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
  } catch {
    /* 隐私模式下静默降级为仅内存会话 */
  }
}

const initialSession = readStoredSession();

export const session = {
  /** 当前登录用户 id；null 表示游客 */
  userId: initialSession?.userId ?? (null as number | null),
  accessToken: initialSession?.accessToken ?? (null as string | null),
  /** 获取当前登录用户（mock 层的便捷方法） */
  currentUser(): UserProfile | null {
    if (this.userId === null) return null;
    return profileOf(this.userId, this.userId);
  },
  login(userId: number): void {
    this.userId = userId;
    this.accessToken = `mock.${userId}.${Date.now().toString(36)}`;
    writeStoredSession({ userId, accessToken: this.accessToken });
  },
  logout(): void {
    this.userId = null;
    this.accessToken = null;
    writeStoredSession(null);
    // 互动状态属于上一个会话：不清空的话，换账号登录会看到别人的收藏与观看历史（BUG-05 同类）。
    engagement.liked.clear();
    engagement.disliked.clear();
    engagement.favorited.clear();
    engagement.subscribed.clear();
    engagement.followed.clear();
    engagement.history.clear();
  },
};

/* --------------------------------------------------------- 上传任务状态 */

export interface MockUploadTask {
  uploadId: string;
  videoId: number;
  title: string;
  fileName: string;
  fileSize: number;
  description?: string;
  categoryId?: number;
  duration?: number;
  visibility?: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
  videoType: VideoType;
  partSize: number;
  totalParts: number;
  uploadedParts: number[];
  createdAt: number;
  status: 'UPLOADING' | 'MERGING' | 'TRANSCODING' | 'REVIEWING' | 'PUBLISHED' | 'FAILED';
  transcodeProgress: number;
}

export const UPLOAD_TASKS = new Map<string, MockUploadTask>();
/** 已入库的 SHA-256 → 文件 id（秒传） */
export const FILE_HASHES = new Map<string, number>();

export { coverUrl as makeCover, avatarUrl as makeAvatar, toSummary as summaryOf };
