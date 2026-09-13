import { http } from './client';
import type {
  CommentItem,
  CommentQuery,
  CursorData,
  CursorQuery,
  PageData,
  Quality,
  RankingItem,
  RankingQuery,
  SearchQuery,
  VideoDetail,
  VideoQuery,
  VideoSummary,
} from './types';

export interface SearchResult extends PageData<VideoSummary> {
  suggestions?: string[];
  costMs?: number;
}

export interface FavoriteFolder {
  id: number;
  name: string;
  count: number;
  isDefault: boolean;
}

export interface Playlist {
  id: number;
  name: string;
  count: number;
  cover: string;
}

export const videoApi = {
  recommend: (query: VideoQuery = {}) =>
    http.get<PageData<VideoSummary>>('/api/v1/videos/recommend', { query: { ...query } }),

  detail: (id: number) => http.get<VideoDetail>(`/api/v1/videos/${id}`),

  /** 获取带签名的播放地址（防盗链，文档 10.3） */
  play: (id: number) =>
    http.get<{ hlsUrl: string; qualities: Quality[]; expiresAt: string; poster: string }>(
      `/api/v1/videos/${id}/play`,
    ),

  related: (id: number) => http.get<VideoSummary[]>(`/api/v1/videos/${id}/related`),

  /** 播放计数：≥3s 且 24h 去重（文档 11.3） */
  reportView: (id: number) => http.post<{ counted: boolean; views: number }>(`/api/v1/videos/${id}/view`, undefined, {
    idempotent: true,
  }),

  /** 记忆播放进度上报（节流 15s，文档 5.6） */
  reportProgress: (id: number, progress: number) =>
    http.post<{ saved: boolean; progress: number }>(`/api/v1/videos/${id}/progress`, { progress }),

  ranking: (query: RankingQuery) =>
    http.get<RankingItem[]>('/api/v1/videos/ranking', { query: { ...query } }),

  search: (query: SearchQuery) => http.get<SearchResult>('/api/v1/videos/search', { query: { ...query } }),

  shorts: (query: CursorQuery = {}) =>
    http.get<CursorData<VideoSummary>>('/api/v1/videos/shorts', { query: { ...query } }),

  history: (page = 1, pageSize = 20) =>
    http.get<PageData<VideoSummary>>('/api/v1/videos/history', { query: { page, pageSize }, auth: true }),

  favorites: (query: { page?: number; pageSize?: number; folderId?: number } = {}) =>
    http.get<PageData<VideoSummary> & { folders: FavoriteFolder[] }>('/api/v1/videos/favorites', {
      query: { ...query },
      auth: true,
    }),

  playlists: () => http.get<Playlist[]>('/api/v1/videos/playlists', { auth: true }),
  playlistVideos: (playlistId: number) => http.get<VideoSummary[]>(`/api/v1/videos/playlists/${playlistId}`, { auth: true }),
  createPlaylist: (name: string, description?: string) => http.post<Playlist>('/api/v1/videos/playlists', { name, description }, { auth: true }),
  addToPlaylist: (playlistId: number, videoId: number) => http.post<{ success: boolean }>(`/api/v1/videos/playlists/${playlistId}/videos`, { videoId }, { auth: true }),

  like: (id: number, active: boolean) =>
    http.post<{ active: boolean; count: number }>(
      `/api/v1/videos/${id}/like`,
      { action: active ? 'LIKE' : 'UNLIKE' },
      { auth: true },
    ),

  dislike: (id: number, active: boolean) =>
    http.post<{ active: boolean; count: number }>(
      `/api/v1/videos/${id}/dislike`,
      { action: active ? 'DISLIKE' : 'UNDISLIKE' },
      { auth: true },
    ),

  favorite: (id: number, active: boolean, folderId?: number) =>
    http.post<{ active: boolean; count: number }>(
      `/api/v1/videos/${id}/favorite`,
      { action: active ? 'FAVORITE' : 'UNFAVORITE', folderId },
      { auth: true },
    ),

  subscribe: (id: number, active: boolean) =>
    http.post<{ active: boolean }>(
      `/api/v1/videos/${id}/subscribe`,
      { action: active ? 'SUBSCRIBE' : 'UNSUBSCRIBE' },
      { auth: true },
    ),

  download: (id: number) =>
    http.get<{ url: string; expiresIn: number; quality: Quality; fileName?: string }>(`/api/v1/videos/${id}/download`, {
      auth: true,
    }),

  comments: (id: number, query: CommentQuery = {}) =>
    http.get<PageData<CommentItem>>(`/api/v1/videos/${id}/comments`, { query: { ...query } }),

  postComment: (id: number, content: string) =>
    http.post<CommentItem>(`/api/v1/videos/${id}/comments`, { content }, { auth: true, idempotent: true }),

  replies: (commentId: number, page = 1, pageSize = 10) =>
    http.get<PageData<CommentItem>>(`/api/v1/comments/${commentId}/replies`, { query: { page, pageSize } }),

  replyComment: (commentId: number, content: string) =>
    http.post<CommentItem>(`/api/v1/comments/${commentId}/reply`, { content }, { auth: true, idempotent: true }),

  likeComment: (commentId: number, active: boolean) =>
    http.post<{ active: boolean; count: number }>(
      `/api/v1/comments/${commentId}/like`,
      { action: active ? 'LIKE' : 'UNLIKE' },
      { auth: true },
    ),

  deleteComment: (commentId: number) => http.delete<{ success: boolean }>(`/api/v1/comments/${commentId}`, { auth: true }),

  update: (id: number, payload: Partial<Pick<VideoDetail, 'title' | 'description' | 'tags' | 'visibility'>>) =>
    http.put<VideoDetail>(`/api/v1/videos/${id}`, payload, { auth: true }),

  /** 软删除，30 天回收站（文档 7.2） */
  remove: (id: number) =>
    http.delete<{ success: boolean; recoverableUntil: string }>(`/api/v1/videos/${id}`, { auth: true }),

  report: (payload: {
    targetType: 'VIDEO' | 'COMMENT' | 'FEED' | 'USER';
    targetId: number;
    reason: string;
    description?: string;
    evidenceUrls?: string[];
  }) => http.post<{ reportId: number; status: string }>('/api/v1/reports', payload, { auth: true, idempotent: true }),
};

export const categoryApi = {
  list: () => http.get<import('./types').Category[]>('/api/v1/categories'),
};
