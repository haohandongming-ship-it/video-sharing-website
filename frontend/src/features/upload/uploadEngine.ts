import { create } from 'zustand';
import { createSha256 } from '@/lib/sha256';

/**
 * 上传任务状态机（文档 10.1 上传流程）
 *
 * 分片直传 → 服务端合并 → 转码队列 → 审核 → 发布。
 * 状态存放于 store，页面刷新后任务丢失符合预期（真实环境由 uploadId 恢复）。
 */
export type UploadPhase =
  | 'idle'
  | 'hashing'
  | 'uploading'
  | 'paused'
  | 'merging'
  | 'transcoding'
  | 'reviewing'
  | 'published'
  | 'failed';

export interface UploadPartState {
  partNumber: number;
  size: number;
  status: 'pending' | 'uploading' | 'done' | 'failed';
  /** 已上传字节（用于总进度计算） */
  loaded: number;
  speed: number;
}

export interface UploadTask {
  id: string;
  file: File;
  fileName: string;
  fileSize: number;
  videoType: 'LONG' | 'SHORT';
  sha256: string;
  uploadId: string | null;
  videoId: number | null;
  partSize: number;
  parts: UploadPartState[];
  phase: UploadPhase;
  /** 0-100 */
  progress: number;
  /** 字节/秒 */
  speed: number;
  eta: number;
  instant: boolean;
  error: string | null;
  title: string;
  categoryId: number | null;
  description: string;
  tags: string[];
  visibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
  downloadEnabled: boolean;
  coverDataUrl: string | null;
  createdAt: number;
}

interface UploadState {
  task: UploadTask | null;
  history: UploadTask[];
  setTask: (task: UploadTask | null) => void;
  patchTask: (patch: Partial<UploadTask>) => void;
  patchParts: (updater: (parts: UploadPartState[]) => UploadPartState[]) => void;
  completeTask: (task: UploadTask) => void;
  reset: () => void;
}

export const useUploadStore = create<UploadState>((set) => ({
  task: null,
  history: [],
  setTask: (task) => set({ task }),
  patchTask: (patch) =>
    set((state) => (state.task ? { task: { ...state.task, ...patch } } : state)),
  patchParts: (updater) =>
    set((state) => (state.task ? { task: { ...state.task, parts: updater(state.task.parts) } } : state)),
  completeTask: (task) =>
    set((state) => ({ history: [task, ...state.history].slice(0, 20) })),
  reset: () => set({ task: null }),
}));

/**
 * 计算 SHA-256：使用纯 JS 增量实现（`@/lib/sha256`）。
 *
 * 不用 `crypto.subtle` 的原因有两个，且都是实际踩到的问题：
 * 1. 它只在安全上下文（https / localhost）存在，局域网设备用 `http://<内网IP>:5173` 打开时是
 *    `undefined`，上传会在算哈希这步直接失败；
 * 2. Web Crypto 没有增量 API，老实现要把整个文件拼成一块内存，几百 MB 的短视频在手机上容易 OOM。
 *
 * 现在按 4MB 分片流式喂给哈希器：内存恒定，进度照常上报，任何浏览器上下文都能跑。
 */
export async function computeSha256(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<string> {
  const chunkSize = 4 * 1024 * 1024;
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
  const hasher = createSha256();

  for (let index = 0; index < totalChunks; index += 1) {
    const slice = file.slice(index * chunkSize, Math.min((index + 1) * chunkSize, file.size));
    hasher.update(new Uint8Array(await slice.arrayBuffer()));
    onProgress?.((index + 1) / totalChunks);
  }
  onProgress?.(1);
  return hasher.hex();
}

/** 文件魔数校验（文档 13.3：伪造扩展名/魔数必须被拒绝） */
export const MAGIC_NUMBERS: { hex: string; offset: number; mime: string; label: string }[] = [
  { hex: '66747970', offset: 4, mime: 'video/mp4', label: 'MP4/M4V' },
  { hex: '1a45dfa3', offset: 0, mime: 'video/webm', label: 'WebM/MKV' },
  { hex: '6d6f6f76', offset: 4, mime: 'video/quicktime', label: 'MOV' },
];

export interface FileValidationResult {
  ok: boolean;
  reason?: string;
  /** 客户端可读的媒体信息 */
  meta?: { duration: number; width: number; height: number };
}

export async function validateVideoFile(file: File, videoType: 'LONG' | 'SHORT'): Promise<FileValidationResult> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const allowedExt = ['mp4', 'mov', 'webm', 'm4v'];
  if (!allowedExt.includes(ext)) {
    return { ok: false, reason: `仅支持 ${allowedExt.join(' / ')} 格式，当前文件为 .${ext}` };
  }

  // 魔数校验：读取文件头 16 字节
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const headerHex = Array.from(header)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const magicOk = MAGIC_NUMBERS.some((magic) => {
    if (!headerHex.startsWith(magic.hex, magic.offset * 2)) return false;
    // WebM/MKV 的魔数是 EBML 头，只需匹配文件开头，避免与其它格式误判
    return magic.offset === 0 ? headerHex.startsWith(magic.hex) : true;
  });
  if (!magicOk) {
    return { ok: false, reason: '文件内容与扩展名不符，可能被篡改，已拒绝上传' };
  }

  const limits =
    videoType === 'LONG'
      ? { maxSize: 8 * 1024 ** 3, maxDuration: 4 * 3600, label: '长视频' }
      : { maxSize: 500 * 1024 ** 2, maxDuration: 180, label: '短视频' };

  if (file.size > limits.maxSize) {
    return {
      ok: false,
      reason: `${limits.label}最大支持 ${Math.round(limits.maxSize / 1024 ** 3) || Math.round(limits.maxSize / 1024 ** 2)}${limits.maxSize >= 1024 ** 3 ? 'GB' : 'MB'}，当前文件过大`,
    };
  }

  const meta = await probeMedia(file);
  if (meta && meta.duration > limits.maxDuration) {
    return {
      ok: false,
      reason: `${limits.label}时长上限 ${Math.round(limits.maxDuration / 60)} 分钟，当前视频约 ${Math.round(meta.duration / 60)} 分钟`,
    };
  }

  return { ok: true, meta: meta ?? undefined };
}

/** 读取媒体元信息（时长/分辨率），失败不阻塞上传 */
export function probeMedia(file: File): Promise<{ duration: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      resolve({ duration: video.duration || 0, width: video.videoWidth, height: video.videoHeight });
      URL.revokeObjectURL(url);
    };
    video.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    video.src = url;
  });
}

/** 截取视频首帧作为封面候选 */
export function captureFrame(file: File, atSecond = 1): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.onloadeddata = () => {
      video.currentTime = Math.min(atSecond, (video.duration || 1) / 2);
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 360;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        URL.revokeObjectURL(url);
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/webp', 0.8));
      URL.revokeObjectURL(url);
    };
    video.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    video.src = url;
  });
}
