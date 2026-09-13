import { http } from './client';
import type {
  CursorData,
  CursorQuery,
  FeedPost,
  FeedPublishPayload,
  PageData,
  CommentItem,
} from './types';

export interface FeedQuery extends CursorQuery {
  type?: 'recommend' | 'following' | 'hot';
  topicId?: number;
}

export const feedApi = {
  list: (query: FeedQuery = {}) => http.get<CursorData<FeedPost>>('/api/v1/feeds', { query: { ...query } }),

  detail: (id: number) => http.get<FeedPost>(`/api/v1/feeds/${id}`),

  publish: (payload: FeedPublishPayload) => http.post<FeedPost>('/api/v1/feeds', payload, { auth: true, idempotent: true }),

  remove: (id: number) => http.delete<{ success: boolean }>(`/api/v1/feeds/${id}`, { auth: true }),

  like: (id: number, active: boolean) =>
    http.post<{ active: boolean; count: number }>(`/api/v1/feeds/${id}/like`, { action: active ? 'LIKE' : 'UNLIKE' }, {
      auth: true,
    }),

  repost: (id: number) => http.post<{ count: number }>(`/api/v1/feeds/${id}/repost`, undefined, { auth: true, idempotent: true }),

  comments: (id: number, page = 1, pageSize = 20) =>
    http.get<PageData<CommentItem>>(`/api/v1/feeds/${id}/comments`, { query: { page, pageSize } }),

  postComment: (id: number, content: string) =>
    http.post<CommentItem>(`/api/v1/feeds/${id}/comments`, { content }, { auth: true, idempotent: true }),
};
