/** ============================================================================
 * 领域类型定义 —— 严格对齐《视频分享网站 · 项目开发文档 v2.0》
 * 第 6.3 统一响应格式 / 第 7 章数据库设计 / 第 4 章页面设计
 * ========================================================================== */

/* ---------- 通用 ---------- */

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  timestamp?: number;
}

/** 分页响应（文档 6.3） */
export interface PageData<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** 游标分页（信息流/短视频流使用，便于无限滚动） */
export interface CursorData<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
}

export interface CursorQuery {
  cursor?: string | null;
  pageSize?: number;
}

/* ---------- 用户与权限 ---------- */

export type Role = 'USER' | 'MODERATOR' | 'ADMIN';
export type UserStatus = 'ACTIVE' | 'BANNED' | 'DEACTIVATED' | 'DELETED';
/** 权限点：管理员不与 USER 互斥，最终以权限点集合判定（文档 2.1） */
export type Permission =
  | 'video:upload'
  | 'video:download'
  | 'video:manage_own'
  | 'creator:dashboard'
  | 'moderation:review'
  | 'moderation:report'
  | 'admin:user_manage'
  | 'admin:role_assign'
  | 'admin:system_config'
  | 'admin:analytics';

export interface UserBrief {
  id: number;
  username: string;
  nickname: string;
  avatar: string | null;
  bio?: string | null;
  certified: boolean;
  followerCount?: number;
}

export interface UserProfile extends UserBrief {
  role: Role;
  status: UserStatus;
  permissions: Permission[];
  followingCount: number;
  videoCount: number;
  totalViews: number;
  totalLikes: number;
  createdAt: string;
  /** 当前登录用户是否已关注 */
  followed: boolean;
  /** 互关标识 */
  mutual: boolean;
  subscribed: boolean;
  email?: string;
  phone?: string;
  /** 实名认证状态（仅本人可见） */
  realNameStatus?: 'NONE' | 'PENDING' | 'CERTIFIED' | 'REJECTED';
}

export interface AuthSession {
  accessToken: string;
  /** Access Token 有效期（秒），前端据此提前静默刷新 */
  expiresIn: number;
  user: UserProfile;
}

export interface LoginByPasswordPayload {
  account: string;
  password: string;
  remember?: boolean;
}

export interface LoginBySmsPayload {
  phone: string;
  code: string;
}

export interface RegisterPayload {
  username: string;
  email: string;
  password: string;
  nickname: string;
  phone?: string;
  smsCode?: string;
  agreeTerms: boolean;
}

export interface FollowUser extends UserBrief {
  followed: boolean;
  mutual: boolean;
  followedAt: string;
}

/* ---------- 视频 ---------- */

export type VideoType = 'LONG' | 'SHORT';
export type VideoStatus = 'PROCESSING' | 'REVIEWING' | 'PUBLISHED' | 'REJECTED' | 'DELETED';
export type Visibility = 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
export type Quality = '360p' | '480p' | '720p' | '1080p' | 'source';

export interface Category {
  id: number;
  name: string;
  slug: string;
  sortOrder: number;
}

export interface VideoStats {
  views: number;
  likes: number;
  dislikes: number;
  comments: number;
  favorites: number;
  shares?: number;
  coins?: number;
}

export interface VideoSummary {
  id: number;
  videoType: VideoType;
  title: string;
  coverUrl: string;
  duration: number;
  category: Category | null;
  author: UserBrief;
  stats: VideoStats;
  publishedAt: string;
  status: VideoStatus;
  visibility: Visibility;
  /** 观看历史场景下的播放进度（秒） */
  progress?: number;
  /** 是否已看完 */
  finished?: boolean;
  /** 推荐理由（推荐流场景由服务端下发） */
  recommendReason?: string | null;
  /** 短视频流直接播放所需的签名地址（短视频流场景下发，长视频走 /play 接口） */
  hlsUrl?: string;
  /** 当前登录用户互动状态（列表接口按需下发，详情接口必定下发） */
  liked?: boolean;
  favorited?: boolean;
}

export interface VideoDetail extends VideoSummary {
  description: string;
  tags: string[];
  qualities: Quality[];
  /** 带签名的 master.m3u8 地址（文档 10.3） */
  hlsUrl: string;
  downloadEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  /** 当前登录用户互动状态 */
  liked: boolean;
  disliked: boolean;
  favorited: boolean;
  subscribed: boolean;
  /** 审核未通过时的原因（仅作者可见） */
  reviewNote?: string | null;
  /** 该视频在推荐流中的推荐理由 */
  recommendReason?: string | null;
}

export interface VideoQuery extends PageQuery {
  videoType?: VideoType;
  categoryId?: number;
  sort?: 'recommend' | 'latest' | 'hot' | 'views';
}

export interface SearchQuery extends PageQuery {
  q: string;
  type?: 'video' | 'user' | 'feed';
  categoryId?: number;
  duration?: 'short' | 'medium' | 'long';
  sort?: 'relevance' | 'latest' | 'views';
  dateRange?: 'day' | 'week' | 'month' | 'all';
}

export interface RankingItem {
  rank: number;
  video: VideoSummary;
  /** 热度分（文档 8.3 对数归一化公式结果） */
  score: number;
  /** 相比上一周期名次变化：正数上升 */
  delta: number;
  trend: 'up' | 'down' | 'same' | 'new';
}

export interface RankingQuery {
  type: 'hot' | 'trend' | 'category' | 'newcomer';
  period: 'daily' | 'weekly' | 'monthly' | 'all';
  categoryId?: number;
}

/* ---------- 互动 ---------- */

export interface CommentItem {
  id: number;
  videoId: number;
  parentId: number | null;
  rootId: number | null;
  content: string;
  user: UserBrief;
  likeCount: number;
  replyCount: number;
  liked: boolean;
  status: 'VISIBLE' | 'HIDDEN' | 'DELETED';
  createdAt: string;
  /** 楼中楼预览（默认前 3 条，文档 11.2） */
  replies?: CommentItem[];
  /** 作者是否为本视频作者 */
  isVideoAuthor?: boolean;
  /** 乐观更新占位 */
  pending?: boolean;
}

export interface CommentQuery extends PageQuery {
  sort?: 'hot' | 'new';
}

export interface ReportReasonPayload {
  targetType: 'VIDEO' | 'COMMENT' | 'FEED' | 'USER';
  targetId: number;
  reason: ReportReason;
  description?: string;
  evidenceUrls?: string[];
}

export type ReportReason =
  | 'PORN'
  | 'VIOLENCE'
  | 'ILLEGAL'
  | 'INFRINGEMENT'
  | 'SPAM'
  | 'ABUSE'
  | 'OTHER';

/* ---------- 动态（微博式） ---------- */

export type FeedType = 'ORIGINAL' | 'REPOST';
export type FeedMediaType = 'IMAGE' | 'VIDEO';

export interface FeedMedia {
  id: number;
  mediaType: FeedMediaType;
  url: string;
  thumbUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
  videoId?: number;
  sortOrder: number;
}

export interface FeedPost {
  id: number;
  type: FeedType;
  content: string;
  user: UserBrief;
  media: FeedMedia[];
  topic?: { id: number; name: string } | null;
  mentions?: UserBrief[];
  repostOf?: FeedPost | null;
  stats: { likes: number; comments: number; reposts: number };
  liked: boolean;
  createdAt: string;
  /** 是否本人发布（决定是否展示删除入口） */
  isOwner?: boolean;
}

export interface FeedPublishPayload {
  content: string;
  media?: { mediaType: FeedMediaType; url: string; thumbUrl?: string; videoId?: number }[];
  topicName?: string;
  repostOfId?: number;
}

/* ---------- 上传与转码 ---------- */

export interface UploadInitPayload {
  fileName: string;
  fileSize: number;
  sha256: string;
  videoType: VideoType;
  title: string;
  categoryId: number;
  description?: string;
  visibility?: Visibility;
  tags?: string[];
  /** 浏览器探测出的原始时长，转码完成后保留在视频记录中 */
  duration?: number;
}

export interface UploadInitResult {
  instant: boolean;
  fileId?: number;
  videoId?: number;
  uploadId?: string;
  partSize?: number;
  parts?: { partNumber: number; url: string }[];
  /** 断点续传：服务端已存在的分片（文档 3.2 断点续传） */
  uploadedParts?: number[];
}

export interface UploadCompletePayload {
  parts: { partNumber: number; etag: string }[];
}

export interface UploadCompleteResult {
  videoId: number;
  status: VideoStatus;
  message: string;
}

export type TranscodeStatus = 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED';

export interface TranscodeProgress {
  videoId: number;
  taskId: number;
  quality: Quality;
  status: TranscodeStatus;
  /** 0-100 */
  progress: number;
  errorMsg?: string | null;
  retryCount?: number;
}

export interface UploadDraft {
  title: string;
  description: string;
  categoryId: number | null;
  tags: string[];
  visibility: Visibility;
  videoType: VideoType;
  coverDataUrl?: string | null;
  downloadEnabled: boolean;
  originalDeclaration: boolean;
}

/* ---------- 通知与私信 ---------- */

export type NotificationType =
  | 'LIKE'
  | 'COMMENT'
  | 'REPLY'
  | 'FOLLOW'
  | 'FAVORITE'
  | 'SYSTEM'
  | 'REVIEW'
  | 'SUBSCRIPTION';

export interface AppNotification {
  id: number;
  type: NotificationType;
  title: string;
  content: string;
  /** 触发者 */
  actor: UserBrief | null;
  /** 跳转目标 */
  targetType: 'VIDEO' | 'COMMENT' | 'FEED' | 'USER' | null;
  targetId: number | null;
  isRead: boolean;
  createdAt: string;
}

export interface Conversation {
  id: number;
  peer: UserBrief;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}

export interface DirectMessage {
  id: number;
  conversationId: number;
  senderId: number;
  content: string;
  /** 图片/视频分享 */
  attachment?: { type: 'IMAGE' | 'VIDEO'; url: string; videoId?: number } | null;
  createdAt: string;
  mine: boolean;
  pending?: boolean;
}

/* ---------- 管理后台 ---------- */

export interface AdminOverview {
  users: { total: number; todayNew: number; activeToday: number; banned: number };
  videos: { total: number; todayNew: number; processing: number; reviewing: number };
  interaction: { commentsToday: number; likesToday: number; reportsPending: number };
  transcode: { queued: number; running: number; failedToday: number; avgSeconds: number };
  /** 近 14 天趋势 */
  trend: { date: string; uploads: number; views: number; newUsers: number }[];
  categoryDistribution: { name: string; value: number }[];
}

export interface ReviewTask {
  id: number;
  video: VideoSummary;
  /** 机审结果 */
  machineResult: 'PASS' | 'SUSPECT' | 'BLOCK';
  machineLabels: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  reportCount: number;
  submittedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewerId?: number | null;
  reviewNote?: string | null;
}

export interface ReportTask {
  id: number;
  targetType: 'VIDEO' | 'COMMENT' | 'FEED' | 'USER';
  targetId: number;
  targetTitle: string;
  targetSnapshot: string;
  reason: ReportReason;
  description: string;
  evidenceUrls: string[];
  reporter: UserBrief;
  status: 'PENDING' | 'PROCESSING' | 'RESOLVED' | 'REJECTED';
  priority: number;
  handlerId?: number | null;
  handledAt?: string | null;
  createdAt: string;
}

export interface AdminUserRow {
  id: number;
  username: string;
  nickname: string;
  avatar: string | null;
  email: string;
  phone: string | null;
  role: Role;
  status: UserStatus;
  certified: boolean;
  videoCount: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AuditLogRow {
  id: number;
  operator: UserBrief;
  action: string;
  targetType: string;
  targetId: number;
  detail: Record<string, string | number | boolean>;
  createdAt: string;
}

export interface AdminQuery extends PageQuery {
  keyword?: string;
  status?: string;
  role?: string;
  categoryId?: number;
  riskLevel?: string;
  reason?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface PlatformSettings {
  /** 先审后发策略相关（文档 13.3 信任分） */
  review: {
    newUserForceReview: boolean;
    newUserWindowHours: number;
    highTrustSampleRate: number;
    autoReportThreshold: number;
  };
  upload: {
    longMaxSizeGB: number;
    shortMaxSizeMB: number;
    longMaxDurationHours: number;
    shortMaxDurationSeconds: number;
    allowedExtensions: string[];
  };
  recommend: {
    /** 算法备案要求：提供关闭个性化推荐开关（文档 9.2 / 14.4） */
    personalizationEnabled: boolean;
    hotFallback: boolean;
  };
  minor: {
    teenagerModeEnabled: boolean;
    dailyLimitMinutes: number;
    nightBlockStart: string;
    nightBlockEnd: string;
  };
}

/* ---------- 错误码（文档 6.3） ---------- */

export const ERROR_CODE_MESSAGES: Record<number, string> = {
  40001: '参数校验失败',
  40002: '请求过于频繁，请稍后再试',
  40101: '登录状态已过期，请重新登录',
  40102: '账号或密码错误',
  40103: '验证码错误或已失效',
  40301: '没有权限执行该操作',
  40401: '资源不存在或已被删除',
  42901: '操作过于频繁，请稍后再试',
  50001: '服务开小差了，请稍后重试',
};

export interface SseRankingPayload {
  type: 'hot' | 'trend';
  period: string;
  updatedAt: string;
  items: { rank: number; videoId: number; title: string; score: number; delta: number }[];
}
