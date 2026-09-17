import type { FeedQuery } from '@/api/feeds';
import type { CommentQuery, RankingQuery, SearchQuery, VideoQuery } from '@/api/types';

/**
 * TanStack Query key 规范（文档 5.4）
 * 统一收口，避免各处拼写漂移导致缓存失效不生效。
 */
export const queryKeys = {
  categories: ['categories'] as const,

  videos: {
    all: ['videos'] as const,
    recommend: (query: VideoQuery = {}) => ['videos', 'recommend', query] as const,
    detail: (id: number) => ['videos', 'detail', id] as const,
    play: (id: number) => ['videos', 'play', id] as const,
    related: (id: number) => ['videos', 'related', id] as const,
    ranking: (query: RankingQuery) => ['videos', 'ranking', query] as const,
    search: (query: SearchQuery) => ['videos', 'search', query] as const,
    danmaku: (videoId: number) => ['videos', videoId, 'danmaku'] as const,
    subtitles: (videoId: number) => ['videos', videoId, 'subtitles'] as const,
    shorts: (cursor?: string | null) => ['videos', 'shorts', { cursor: cursor ?? null }] as const,
    history: (page: number) => ['videos', 'history', { page }] as const,
    favorites: (query: { page?: number; folderId?: number } = {}) => ['videos', 'favorites', query] as const,
    playlists: ['videos', 'playlists'] as const,
  },

  comments: {
    all: ['comments'] as const,
    list: (videoId: number, query: CommentQuery) => ['comments', videoId, query] as const,
    replies: (commentId: number, page: number) => ['comments', 'replies', commentId, { page }] as const,
  },

  feeds: {
    all: ['feed'] as const,
    list: (query: FeedQuery) => ['feed', query.type ?? 'recommend', { cursor: query.cursor ?? null, topicId: query.topicId }] as const,
    detail: (id: number) => ['feed', 'detail', id] as const,
    comments: (id: number, page: number) => ['feed', 'comments', id, { page }] as const,
  },

  user: {
    all: ['user'] as const,
    profile: (id: number) => ['user', id, 'profile'] as const,
    videos: (id: number, page = 1) => ['user', id, 'videos', { page }] as const,
    feeds: (id: number, page = 1) => ['user', id, 'feeds', { page }] as const,
    favorites: (id: number, page = 1) => ['user', id, 'favorites', { page }] as const,
    followers: (id: number, page = 1) => ['user', id, 'followers', { page }] as const,
    following: (id: number, page = 1) => ['user', id, 'following', { page }] as const,
    suggested: ['user', 'suggested'] as const,
    search: (query: { q: string; page?: number }) => ['user', 'search', query] as const,
  },

  creator: {
    dashboard: (days: number) => ['creator', 'dashboard', { days }] as const,
    videos: (query: { page?: number; status?: string }) => ['creator', 'videos', query] as const,
  },

  notifications: {
    list: (query: { page?: number; type?: string }) => ['notifications', 'list', query] as const,
    unread: ['notifications', 'unread'] as const,
  },

  messages: {
    conversations: ['messages', 'conversations'] as const,
    thread: (conversationId: number) => ['messages', 'thread', conversationId] as const,
  },

  admin: {
    overview: ['admin', 'overview'] as const,
    reviews: (query: Record<string, unknown>) => ['admin', 'reviews', query] as const,
    reports: (query: Record<string, unknown>) => ['admin', 'reports', query] as const,
    realNames: (query: Record<string, unknown>) => ['admin', 'real-names', query] as const,
    users: (query: Record<string, unknown>) => ['admin', 'users', query] as const,
    videos: (query: Record<string, unknown>) => ['admin', 'videos', query] as const,
    auditLogs: (query: Record<string, unknown>) => ['admin', 'audit-logs', query] as const,
    settings: ['admin', 'settings'] as const,
  },
} as const;
