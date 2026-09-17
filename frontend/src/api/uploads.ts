import { http } from './client';
import { USE_MOCK } from './config';
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
    if (!USE_MOCK) {
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'XMLHttpRequest' },
        body: chunk,
        credentials: 'omit',
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`分片上传失败（${response.status}）`);
      onProgress?.(chunk.size);
      return response.headers.get('ETag') ?? '';
    }
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
    http.get<PageData<AppNotification> & { unreadCount: number; typeCounts: Record<string, number> }>(
      '/api/v1/notifications',
      {
        query: { ...query },
        auth: true,
      },
    ),

  unreadCount: () => http.get<{ count: number }>('/api/v1/notifications/unread-count'),

  markRead: (ids: number[] = []) =>
    http.post<{ success: boolean }>('/api/v1/notifications/read', { ids }, { auth: true }),
};

export const messageApi = {
  conversations: () => http.get<Conversation[]>('/api/v1/messages/conversations', { auth: true }),

  /** 找到或创建与目标用户的会话；不存在时后端建一条并返回其 id */
  openConversation: (peerId: number) =>
    http.post<Conversation>('/api/v1/messages/conversations', { peerId }, { auth: true }),

  /** 私信附件：本地图片/视频上传到对象存储，返回可附在消息里的附件对象 */
  uploadAttachment: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return http.post<NonNullable<DirectMessage['attachment']>>('/api/v1/messages/attachments', form, { auth: true });
  },

  messages: (conversationId: number) =>
    http.get<DirectMessage[]>(`/api/v1/messages/conversations/${conversationId}/messages`, { auth: true }),

  send: (conversationId: number, content: string, attachment?: DirectMessage['attachment']) =>
    http.post<DirectMessage>(
      `/api/v1/messages/conversations/${conversationId}/messages`,
      { content, attachment },
      { auth: true, idempotent: true },
    ),
};
