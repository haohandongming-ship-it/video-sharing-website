import { http } from './client';
import type { PageData, UserBrief, UserProfile, VideoSummary } from './types';
import type { FeedPost } from './types';

export interface FollowUser extends UserBrief {
  followed: boolean;
  mutual: boolean;
  followedAt: string;
}

export const userApi = {
  profile: (id: number) => http.get<UserProfile>(`/api/v1/users/${id}`),

  videos: (id: number, page = 1, pageSize = 12) =>
    http.get<PageData<VideoSummary>>(`/api/v1/users/${id}/videos`, { query: { page, pageSize } }),

  feeds: (id: number, page = 1, pageSize = 10) =>
    http.get<PageData<FeedPost>>(`/api/v1/users/${id}/feeds`, { query: { page, pageSize } }),

  favorites: (id: number, page = 1, pageSize = 12) =>
    http.get<PageData<VideoSummary>>(`/api/v1/users/${id}/favorites`, { query: { page, pageSize } }),

  followers: (id: number, page = 1, pageSize = 20) =>
    http.get<PageData<FollowUser>>(`/api/v1/users/${id}/followers`, { query: { page, pageSize } }),

  following: (id: number, page = 1, pageSize = 20) =>
    http.get<PageData<FollowUser>>(`/api/v1/users/${id}/following`, { query: { page, pageSize } }),

  follow: (id: number, active: boolean) =>
    http.post<{ active: boolean; mutual: boolean }>(
      `/api/v1/users/${id}/follow`,
      { action: active ? 'FOLLOW' : 'UNFOLLOW' },
      { auth: true },
    ),

  suggested: () =>
    http.get<(UserBrief & { reason: string })[]>('/api/v1/users/suggested'),
};

export interface CreatorVideoRow extends VideoSummary {
  transcodeProgress: number;
  rejectReason: string | null;
  views7d: number;
}

export interface CreatorDashboard {
  trend: { date: string; views: number; likes: number; comments: number; favorites: number; followers: number }[];
  totals: { views: number; likes: number; comments: number; favorites: number };
  followerTotal: number;
  followerDelta: number;
  avgWatchSeconds: number;
  completionRate: number;
}

export const creatorApi = {
  videos: (query: { page?: number; pageSize?: number; status?: string } = {}) =>
    http.get<PageData<CreatorVideoRow>>('/api/v1/creator/videos', { query: { ...query }, auth: true }),

  dashboard: (days = 30) => http.get<CreatorDashboard>('/api/v1/creator/dashboard', { query: { days }, auth: true }),
};
