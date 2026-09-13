import { http } from './client';
import type {
  AdminOverview,
  AdminQuery,
  AdminUserRow,
  AuditLogRow,
  PageData,
  PlatformSettings,
  ReportTask,
  ReviewTask,
  Role,
  UserStatus,
  VideoSummary,
} from './types';

export const adminApi = {
  overview: () => http.get<AdminOverview>('/api/v1/admin/overview', { auth: true }),

  reviews: (query: AdminQuery = {}) =>
    http.get<PageData<ReviewTask>>('/api/v1/admin/reviews', { query: { ...query }, auth: true }),

  /** 审核决定：通过 / 驳回（含审核意见） */
  decideReview: (taskId: number, decision: 'APPROVE' | 'REJECT', note?: string) =>
    http.post<{ success: boolean; status: string }>(
      `/api/v1/admin/reviews/${taskId}/decision`,
      { decision, note },
      { auth: true, idempotent: true },
    ),

  reports: (query: AdminQuery = {}) =>
    http.get<PageData<ReportTask>>('/api/v1/admin/reports', { query: { ...query }, auth: true }),

  handleReport: (reportId: number, status: ReportTask['status'], note?: string) =>
    http.post<{ success: boolean; status: string }>(
      `/api/v1/admin/reports/${reportId}/handle`,
      { status, note },
      { auth: true, idempotent: true },
    ),

  users: (query: AdminQuery = {}) =>
    http.get<PageData<AdminUserRow>>('/api/v1/admin/users', { query: { ...query }, auth: true }),

  updateUserStatus: (userId: number, status: UserStatus, reason?: string) =>
    http.put<{ success: boolean; status: UserStatus }>(
      `/api/v1/admin/users/${userId}/status`,
      { status, reason },
      { auth: true },
    ),

  assignRole: (userId: number, role: Role) =>
    http.put<{ success: boolean; role: Role }>(`/api/v1/admin/users/${userId}/role`, { role }, { auth: true }),

  videos: (query: AdminQuery = {}) =>
    http.get<PageData<VideoSummary>>('/api/v1/admin/videos', { query: { ...query }, auth: true }),

  auditLogs: (query: AdminQuery = {}) =>
    http.get<PageData<AuditLogRow>>('/api/v1/admin/audit-logs', { query: { ...query }, auth: true }),

  settings: () => http.get<PlatformSettings>('/api/v1/admin/settings', { auth: true }),

  updateSettings: (payload: Partial<PlatformSettings>) =>
    http.put<PlatformSettings>('/api/v1/admin/settings', payload, { auth: true }),
};
