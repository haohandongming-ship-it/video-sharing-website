import { http } from './client';
import type {
  AppNotification,
  Conversation,
  DirectMessage,
  PageData,
  TranscodeProgress,
  UploadCompletePayload,
  UploadCompleteResult,
  UploadInitPayload,
  UploadInitResult,
  VideoStatus,
} from './types';

export interface TranscodeProgressResult extends TranscodeProgress {
  videoStatus: VideoStatus;
}

export const uploadApi = {
  /** 秒传检查 + 初始化分片上传，返回预签名 URL（文档 6.4） */
  init: (payload: UploadInitPayload) =>
    http.post<UploadInitResult>('/api/v1/uploads/init', payload, { auth: true, idempotent: true }),

  /** 分片直传：真实环境为 MinIO 预签名 PUT，此处由 mock 拦截 */
  putPart: async (url: string, chunk: Blob, onProgress?: (loaded: number) => void): Promise<string> => {
    const response = await http.put<void>(url, chunk, {
      headers: { 'Content-Type': 'application/octet-stream' },
      timeout: 120_000,
    });
    void response;
    onProgress?.(chunk.size);
    return `"etag-${url.split('/').pop()}"`;
  },

  complete: (uploadId: string, payload: UploadCompletePayload) =>
    http.post<UploadCompleteResult>(`/api/v1/uploads/${uploadId}/complete`, payload, {
      auth: true,
      idempotent: true,
    }),

  abort: (uploadId: string) =>
    http.post<{ success: boolean }>(`/api/v1/uploads/${uploadId}/abort`, undefined, { auth: true }),

  /** 转码进度：真实环境为 STOMP 推送，本实现以轮询兜底（文档 15.2 降级矩阵） */
  transcodeProgress: (videoId: number) =>
    http.get<TranscodeProgressResult>(`/api/v1/transcode/${videoId}/progress`),
};

export const notificationApi = {
  list: (query: { page?: number; pageSize?: number; type?: string } = {}) =>
    http.get<PageData<AppNotification> & { unreadCount: number }>('/api/v1/notifications', {
      query: { ...query },
      auth: true,
    }),

  unreadCount: () => http.get<{ count: number }>('/api/v1/notifications/unread-count'),

  markRead: (ids: number[] = []) =>
    http.post<{ success: boolean }>('/api/v1/notifications/read', { ids }, { auth: true }),
};

export const messageApi = {
  conversations: () => http.get<Conversation[]>('/api/v1/messages/conversations', { auth: true }),

  messages: (conversationId: number) =>
    http.get<DirectMessage[]>(`/api/v1/messages/conversations/${conversationId}/messages`, { auth: true }),

  send: (conversationId: number, content: string, attachment?: DirectMessage['attachment']) =>
    http.post<DirectMessage>(
      `/api/v1/messages/conversations/${conversationId}/messages`,
      { content, attachment },
      { auth: true, idempotent: true },
    ),
};
