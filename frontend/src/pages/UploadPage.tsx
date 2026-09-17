import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Check,
  CheckCircle2,
  CloudUpload,
  Film,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  ShieldCheck,
  Tags,
  TriangleAlert,
  X,
} from 'lucide-react';
import { uploadApi } from '@/api/uploads';
import type { VideoStatus, VideoType, Visibility } from '@/api/types';
import {
  Badge,
  Button,
  Input,
  PageContainer,
  ProgressBar,
  RadioGroup,
  RingProgress,
  SectionHeader,
  SurfaceCard,
  Switch,
  Tag,
  Textarea,
} from '@/components/ui';
import {
  captureFrame,
  computeSha256,
  probeMedia,
  useUploadStore,
  validateVideoFile,
  type UploadPartState,
  type UploadPhase,
  type UploadTask,
} from '@/features/upload/uploadEngine';
import { useCategories, useTranscodeProgress } from '@/hooks/useApi';
import { cn } from '@/lib/cn';
import {
  CATEGORY_FALLBACK,
  QUALITY_LABELS,
  QUALITY_ORDER,
  UPLOAD_LIMITS,
  VIDEO_MAX_TITLE,
  VIDEO_STATUS_LABELS,
  VIDEO_TYPE_LABELS,
} from '@/lib/constants';
import { formatDuration, formatDurationText, formatFileSize } from '@/lib/format';
import { EASE } from '@/lib/motion';
import { useUiStore } from '@/stores/uiStore';

/* ------------------------------------------------------------------ 常量 */

type StepKey = 'file' | 'info' | 'upload' | 'done';

interface MediaMeta {
  duration: number;
  width: number;
  height: number;
}

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'file', label: '选择文件' },
  { key: 'info', label: '填写信息' },
  { key: 'upload', label: '上传中' },
  { key: 'done', label: '完成' },
];

const VIDEO_TYPE_OPTIONS = [
  { value: 'LONG' as const, label: '长视频', description: '时长超过 3 分钟，单文件 ≤ 8GB，最长 4 小时' },
  { value: 'SHORT' as const, label: '短视频', description: '时长 ≤ 3 分钟，单文件 ≤ 500MB，竖屏横屏均可' },
];

const VISIBILITY_OPTIONS = [
  { value: 'PUBLIC' as const, label: '公开', description: '所有人可见，可被搜索与推荐收录' },
  { value: 'PRIVATE' as const, label: '仅自己可见', description: '不进入任何列表与推荐，仅自己可播放' },
  { value: 'UNLISTED' as const, label: '不公开列出', description: '不进入列表，凭链接可以访问' },
];

const MAX_TAGS = 10;
const MAX_DESCRIPTION = 2000;
const TILE_LIMIT = 160;

const PHASE_TEXT: Record<UploadPhase, { title: string; hint: string }> = {
  idle: { title: '准备上传', hint: '开始后先计算文件校验值，用于秒传与断点续传。' },
  hashing: { title: '正在计算文件校验值', hint: '大文件计算耗时较长，请保持页面开启，此阶段不占用上传带宽。' },
  uploading: { title: '正在上传分片', hint: '分片直传对象存储，单片失败会自动重试 3 次。' },
  paused: { title: '已暂停', hint: '已上传的分片保留在服务端，继续后只补传缺失分片。' },
  merging: { title: '正在合并分片', hint: '服务端校验分片完整性与文件魔数。' },
  transcoding: { title: '正在转码', hint: '按源分辨率生成 360P–1080P 阶梯，转码完成后进入审核。' },
  reviewing: { title: '已进入审核', hint: '新用户内容先审后发，审核通过后自动发布。' },
  published: { title: '已发布', hint: '视频已公开发布，可在创作中心查看播放数据。' },
  failed: { title: '上传中断', hint: '已上传的分片会保留，可重试续传，无需从头开始。' },
};

const PART_STATUS_LABELS: Record<UploadPartState['status'], string> = {
  pending: '待上传',
  uploading: '上传中',
  done: '已完成',
  failed: '失败',
};

const TILE_STYLES: Record<UploadPartState['status'], string> = {
  pending: 'bg-surface-3',
  uploading: 'bg-accent animate-pulse',
  done: 'bg-success',
  failed: 'bg-brand',
};

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/* ------------------------------------------------------ 步骤指示条 / 分片网格 */

function StepIndicator({ current }: { current: StepKey }) {
  const activeIndex = STEPS.findIndex((item) => item.key === current);

  return (
    <ol className="flex items-center gap-2" aria-label="上传步骤">
      {STEPS.map((item, index) => {
        const state = index < activeIndex ? 'done' : index === activeIndex ? 'current' : 'todo';
        return (
          <li key={item.key} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums',
                state === 'done' && 'bg-success-soft text-success',
                state === 'current' && 'bg-fg text-canvas',
                state === 'todo' && 'bg-surface-3 text-fg-subtle',
              )}
            >
              {state === 'done' ? <Check className="size-3.5" aria-hidden /> : index + 1}
            </span>
            <span className={cn('truncate text-xs', state === 'todo' ? 'text-fg-subtle' : 'text-fg')}>{item.label}</span>
            {index < STEPS.length - 1 && <span className="ml-1 hidden h-px flex-1 bg-line sm:block" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

interface PartTile {
  key: string;
  status: UploadPartState['status'];
  title: string;
}

/** 分片数很多时按桶聚合，避免一次渲染上千个方块 */
function toTiles(parts: UploadPartState[], limit: number): PartTile[] {
  if (parts.length <= limit) {
    return parts.map((part) => ({
      key: String(part.partNumber),
      status: part.status,
      title: `第 ${part.partNumber} 片 · ${PART_STATUS_LABELS[part.status]}`,
    }));
  }
  const bucket = Math.ceil(parts.length / limit);
  const tiles: PartTile[] = [];
  for (let start = 0; start < parts.length; start += bucket) {
    const group = parts.slice(start, start + bucket);
    const first = group[0];
    const last = group[group.length - 1];
    const status: UploadPartState['status'] = group.some((part) => part.status === 'failed')
      ? 'failed'
      : group.some((part) => part.status === 'uploading')
        ? 'uploading'
        : group.every((part) => part.status === 'done')
          ? 'done'
          : 'pending';
    tiles.push({ key: `g${first.partNumber}`, status, title: `第 ${first.partNumber}–${last.partNumber} 片` });
  }
  return tiles;
}

function PartGrid({ parts }: { parts: UploadPartState[] }) {
  const tiles = useMemo(() => toTiles(parts, TILE_LIMIT), [parts]);
  const doneCount = parts.filter((part) => part.status === 'done').length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
        <span>
          分片进度{' '}
          <span className="font-medium tabular-nums text-fg">
            {doneCount}/{parts.length}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-3 text-[11px] text-fg-subtle">
          {(['pending', 'uploading', 'done', 'failed'] as const).map((status) => (
            <span key={status} className="inline-flex items-center gap-1">
              <span className={cn('size-2.5 rounded-[2px]', TILE_STYLES[status])} aria-hidden />
              {PART_STATUS_LABELS[status]}
            </span>
          ))}
        </span>
      </div>
      <div
        className="mt-2 flex flex-wrap gap-1"
        role="img"
        aria-label={`分片上传状态：已完成 ${doneCount} 片，共 ${parts.length} 片`}
      >
        {tiles.map((tile) => (
          <span key={tile.key} title={tile.title} className={cn('size-3.5 rounded-[3px]', TILE_STYLES[tile.status])} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ 右侧信息栏 */

function UploadGuidelines({ videoType }: { videoType: VideoType }) {
  const limits = videoType === 'LONG' ? UPLOAD_LIMITS.long : UPLOAD_LIMITS.short;

  return (
    <div className="flex flex-col gap-4">
      <SurfaceCard>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Film className="size-4 text-fg-subtle" aria-hidden />
          上传须知
        </h2>
        <ul className="mt-3 flex flex-col gap-2.5 text-xs leading-relaxed text-fg-muted">
          <li>格式：mp4 / mov / webm / m4v，扩展名与文件内容不一致会被拒绝。</li>
          <li>
            当前为{limits.label}：单文件 ≤ {formatFileSize(limits.maxSize)}，时长 ≤ {formatDurationText(limits.maxDuration)}。
          </li>
          <li>分片直传对象存储，中断后可续传；同一文件重复上传会命中秒传，不再消耗带宽。</li>
          <li>请勿上传未获授权的影视、音乐、赛事片段与纯搬运内容，侵权内容会被下架并记录。</li>
          <li>上传即代表同意平台内容规范，涉及违法违规内容将移交相关部门。</li>
        </ul>
      </SurfaceCard>

      <SurfaceCard>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <ShieldCheck className="size-4 text-fg-subtle" aria-hidden />
          审核与信任分
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">
          新用户上传内容需先审后发，审核通过后自动发布。随着内容质量与合规记录积累，信任分提升后可先发后审，平台按比例抽检。
        </p>
      </SurfaceCard>
    </div>
  );
}

/* ------------------------------------------------------------------ 页面 */

export default function UploadPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const task = useUploadStore((s) => s.task);
  const setTask = useUploadStore((s) => s.setTask);
  const patchTask = useUploadStore((s) => s.patchTask);
  const patchParts = useUploadStore((s) => s.patchParts);
  const completeTask = useUploadStore((s) => s.completeTask);
  const resetTask = useUploadStore((s) => s.reset);

  const { data: categoryData } = useCategories();
  const categories = useMemo(() => categoryData ?? CATEGORY_FALLBACK, [categoryData]);

  const [formStep, setFormStep] = useState<'file' | 'info'>('file');
  const [videoType, setVideoType] = useState<VideoType>('LONG');
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<MediaMeta | null>(null);
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null);
  const [captureAt, setCaptureAt] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('PUBLIC');
  const [downloadEnabled, setDownloadEnabled] = useState(false);
  const [declared, setDeclared] = useState(false);

  const [hashRatio, setHashRatio] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pausedRef = useRef(false);
  const cancelledRef = useRef(false);
  const stopRef = useRef(false);
  const loadedRef = useRef(0);
  const samplesRef = useRef<{ bytes: number; seconds: number }[]>([]);
  const etagsRef = useRef<Map<number, string>>(new Map());
  const partUrlsRef = useRef<{ partNumber: number; url: string }[]>([]);
  const uploadIdRef = useRef<string | null>(null);
  const completedRef = useRef(false);

  const phase = task?.phase ?? 'idle';
  const busy = phase === 'hashing' || phase === 'uploading' || phase === 'paused' || phase === 'merging';
  const polling = phase === 'transcoding' || phase === 'reviewing';
  const transcode = useTranscodeProgress(videoId, polling);

  /** 步骤由任务阶段推导：任务不存在时用表单步骤，避免用 effect 回写状态 */
  const step: StepKey = task === null
    ? formStep
    : phase === 'reviewing' || phase === 'published'
      ? 'done'
      : 'upload';

  const progress = task?.progress ?? 0;
  const speed = task?.speed ?? 0;
  const eta = task?.eta ?? 0;
  const totalBytes = task?.fileSize ?? file?.size ?? 0;
  const uploadedBytes = Math.round((Math.min(100, progress) / 100) * totalBytes);
  const limits = videoType === 'LONG' ? UPLOAD_LIMITS.long : UPLOAD_LIMITS.short;

  const transcodeStatus = transcode.data?.status;
  const transcodeVideoStatus = transcode.data?.videoStatus ?? null;

  /* 转码/审核完成 → 进入完成态（步骤由 phase 推导） */
  useEffect(() => {
    if (videoId === null || transcodeStatus !== 'SUCCESS' || transcodeVideoStatus === null) return;
    if (transcodeVideoStatus !== 'REVIEWING' && transcodeVideoStatus !== 'PUBLISHED' && transcodeVideoStatus !== 'REJECTED') {
      return;
    }
    patchTask({
      phase:
        transcodeVideoStatus === 'PUBLISHED' ? 'published' : transcodeVideoStatus === 'REJECTED' ? 'failed' : 'reviewing',
    });
    if (transcodeVideoStatus === 'PUBLISHED') {
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      queryClient.invalidateQueries({ queryKey: ['creator', 'videos'] });
    }
  }, [videoId, transcodeStatus, transcodeVideoStatus, patchTask, queryClient]);

  /* 归档到历史，最多保留 20 条 */
  useEffect(() => {
    if (step !== 'done' || completedRef.current) return;
    const current = useUploadStore.getState().task;
    if (!current) return;
    completedRef.current = true;
    completeTask(current);
  }, [step, completeTask]);

  /* 上传中离开页面保护 */
  useEffect(() => {
    if (!busy) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [busy]);

  /* ---------------------------------------------------------------- 步骤 1 */

  async function handleFile(nextFile: File, type: VideoType = videoType) {
    setChecking(true);
    setFileError(null);
    setFailure(null);
    setFile(null);
    setMeta(null);
    setCoverDataUrl(null);

    const result = await validateVideoFile(nextFile, type);
    if (!result.ok) {
      setChecking(false);
      setFileError(result.reason ?? '文件校验未通过，请更换文件');
      return;
    }

    const probed = result.meta ?? (await probeMedia(nextFile));
    setMeta(probed ?? null);
    setFile(nextFile);
    setChecking(false);

    if (probed) {
      const at = probed.duration > 2 ? 1 : 0;
      setCaptureAt(at);
      const auto = await captureFrame(nextFile, at);
      setCoverDataUrl(auto);
      // 抓帧失败必须是可见的：否则视频列表会静默退回内置占位图，用户以为封面是自己选的
      if (!auto) {
        useUiStore.getState().toast({
          title: '封面自动截取失败',
          description: '可拖动时间点后点击「重新截取」，或先上传稍后在作品中更换封面',
          tone: 'warning',
        });
      }
    }
  }

  async function recapture() {
    if (!file) return;
    setCapturing(true);
    const cover = await captureFrame(file, captureAt);
    setCapturing(false);
    if (cover) {
      setCoverDataUrl(cover);
      return;
    }
    useUiStore.getState().toast({ title: '截取失败', description: '该时间点无法读取画面，请换一个时间点重试', tone: 'warning' });
  }

  /* ---------------------------------------------------------------- 步骤 2 */

  function addTag() {
    const value = tagInput.trim().replace(/^#+/, '');
    if (!value) return;
    if (tags.includes(value)) {
      setTagInput('');
      return;
    }
    if (tags.length >= MAX_TAGS) {
      useUiStore.getState().toast({ title: `最多添加 ${MAX_TAGS} 个标签`, tone: 'warning' });
      return;
    }
    setTags([...tags, value]);
    setTagInput('');
  }

  /* ---------------------------------------------------------------- 步骤 3 */

  function markPartLoaded(partNumber: number, bytes: number, seconds: number) {
    samplesRef.current = [...samplesRef.current.slice(-4), { bytes, seconds }];
    const sampleBytes = samplesRef.current.reduce((sum, sample) => sum + sample.bytes, 0);
    const sampleSeconds = samplesRef.current.reduce((sum, sample) => sum + sample.seconds, 0);
    const currentSpeed = sampleSeconds > 0 ? sampleBytes / sampleSeconds : 0;
    loadedRef.current += bytes;

    patchParts((parts) => parts.map((part) => (part.partNumber === partNumber ? { ...part, status: 'done', loaded: bytes, speed: currentSpeed } : part)));

    const total = useUploadStore.getState().task?.fileSize ?? 0;
    const loaded = Math.min(loadedRef.current, total);
    patchTask({
      progress: total > 0 ? (loaded / total) * 100 : 0,
      speed: currentSpeed,
      eta: currentSpeed > 0 ? (total - loaded) / currentSpeed : 0,
    });
  }

  async function uploadPart(partNumber: number, url: string) {
    const current = useUploadStore.getState().task;
    if (!current) return;
    const start = (partNumber - 1) * current.partSize;
    const blob = current.file.slice(start, Math.min(start + current.partSize, current.fileSize));
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (cancelledRef.current || stopRef.current) return;
      while (pausedRef.current) {
        if (cancelledRef.current || stopRef.current) return;
        await sleep(180);
      }
      patchParts((parts) => parts.map((part) => (part.partNumber === partNumber ? { ...part, status: 'uploading' } : part)));
      const startedAt = performance.now();
      try {
        const etag = await uploadApi.putPart(url, blob);
        etagsRef.current.set(partNumber, etag);
        markPartLoaded(partNumber, blob.size, Math.max(0.001, (performance.now() - startedAt) / 1000));
        return;
      } catch (error) {
        lastError = error;
        if (cancelledRef.current || stopRef.current) return;
        if (attempt < 3) await sleep(600 * attempt);
      }
    }

    patchParts((parts) => parts.map((part) => (part.partNumber === partNumber ? { ...part, status: 'failed' } : part)));
    throw lastError instanceof Error ? lastError : new Error(`第 ${partNumber} 片上传失败`);
  }

  /** 并发池：不使用第三方依赖，按 UPLOAD_LIMITS.maxConcurrency 控制同时上传数 */
  async function runPool(targets: { partNumber: number; url: string }[]) {
    const queue = [...targets];
    let cursor = 0;
    const workerCount = Math.min(UPLOAD_LIMITS.maxConcurrency, queue.length);
    const worker = async () => {
      for (;;) {
        if (cancelledRef.current || stopRef.current) return;
        const index = cursor;
        cursor += 1;
        const item = queue[index];
        if (!item) return;
        await uploadPart(item.partNumber, item.url);
      }
    };
    await Promise.all(Array.from({ length: workerCount }, worker));
  }

  async function finishUpload(uploadId: string) {
    patchTask({ phase: 'merging', speed: 0, eta: 0 });
    const done = await uploadApi.complete(uploadId, {
      parts: [...etagsRef.current.entries()].map(([partNumber, etag]) => ({ partNumber, etag })),
    });
    setVideoId(done.videoId);
    patchTask({ phase: 'transcoding', videoId: done.videoId, progress: 100 });
  }

  function reportFailure(error: unknown) {
    stopRef.current = true;
    const message = error instanceof Error ? error.message : '上传失败，请检查网络后重试';
    patchTask({ phase: 'failed', error: message });
    setFailure(message);
  }

  async function startUpload() {
    const chosenCategory = categoryId;
    if (!file || chosenCategory === null || !title.trim()) return;

    cancelledRef.current = false;
    stopRef.current = false;
    pausedRef.current = false;
    completedRef.current = false;
    loadedRef.current = 0;
    samplesRef.current = [];
    etagsRef.current = new Map();
    partUrlsRef.current = [];
    uploadIdRef.current = null;
    setFailure(null);
    setHashRatio(0);
    setVideoId(null);

    const initial: UploadTask = {
      id: `task_${Date.now().toString(36)}`,
      file,
      fileName: file.name,
      fileSize: file.size,
      videoType,
      sha256: '',
      uploadId: null,
      videoId: null,
      partSize: UPLOAD_LIMITS.partSize,
      parts: [],
      phase: 'hashing',
      progress: 0,
      speed: 0,
      eta: 0,
      instant: false,
      error: null,
      title: title.trim(),
      categoryId: chosenCategory,
      description: description.trim(),
      tags,
      visibility,
      downloadEnabled,
      coverDataUrl,
      createdAt: Date.now(),
    };
    setTask(initial);

    try {
      const sha256 = await computeSha256(file, (ratio) => setHashRatio(ratio));
      if (cancelledRef.current) return;
      patchTask({ sha256 });

      const init = await uploadApi.init({
        fileName: file.name,
        fileSize: file.size,
        sha256,
        videoType,
        title: title.trim(),
        categoryId: chosenCategory,
        description: description.trim(),
        visibility,
        tags,
        duration: Math.max(0, Math.round(meta?.duration ?? 0)),
        // 把用户截取（或默认首帧）的封面交给后端落存储，否则视频列表会统一显示占位图
        coverDataUrl: coverDataUrl ?? undefined,
      });
      if (cancelledRef.current) return;

      uploadIdRef.current = init.uploadId ?? null;
      patchTask({ uploadId: init.uploadId ?? null, videoId: init.videoId ?? null, instant: init.instant });

      if (init.instant) {
        const existingId = init.videoId ?? null;
        setVideoId(existingId);
        patchTask({ phase: 'reviewing', progress: 100 });
        useUiStore.getState().toast({ title: '已秒传', description: '文件已存在，无需重复上传', tone: 'success' });
        return;
      }

      const partSize = init.partSize ?? UPLOAD_LIMITS.partSize;
      const remoteParts = init.parts ?? [];
      const uploadedParts = new Set(init.uploadedParts ?? []);
      partUrlsRef.current = remoteParts;

      const parts: UploadPartState[] = remoteParts.map((part) => {
        const size = Math.max(0, Math.min(partSize, file.size - (part.partNumber - 1) * partSize));
        const uploaded = uploadedParts.has(part.partNumber);
        return { partNumber: part.partNumber, size, status: uploaded ? 'done' : 'pending', loaded: uploaded ? size : 0, speed: 0 };
      });
      loadedRef.current = parts.reduce((sum, part) => sum + part.loaded, 0);
      patchTask({
        partSize,
        parts,
        phase: 'uploading',
        progress: file.size > 0 ? (loadedRef.current / file.size) * 100 : 0,
      });

      const missing = remoteParts.filter((part) => !uploadedParts.has(part.partNumber));
      if (missing.length > 0) await runPool(missing);
      if (cancelledRef.current) return;

      const uploadId = uploadIdRef.current;
      if (!uploadId) throw new Error('上传会话已失效，请重新开始上传');
      await finishUpload(uploadId);
    } catch (error) {
      reportFailure(error);
    }
  }

  /** 失败续传：只补传未完成的分片 */
  async function retryUpload() {
    const uploadId = uploadIdRef.current;
    const current = useUploadStore.getState().task;
    if (!current || !uploadId) {
      resetTask();
      setFailure(null);
      setFormStep('info');
      useUiStore.getState().toast({ title: '上传会话已失效', description: '请返回上一步重新开始上传', tone: 'warning' });
      return;
    }
    cancelledRef.current = false;
    stopRef.current = false;
    pausedRef.current = false;
    setFailure(null);
    patchTask({ phase: 'uploading', error: null });

    const remaining = partUrlsRef.current.filter((part) => {
      const state = current.parts.find((item) => item.partNumber === part.partNumber);
      return state?.status !== 'done';
    });

    try {
      if (remaining.length > 0) await runPool(remaining);
      if (cancelledRef.current) return;
      await finishUpload(uploadId);
    } catch (error) {
      reportFailure(error);
    }
  }

  function togglePause() {
    if (phase === 'paused') {
      pausedRef.current = false;
      patchTask({ phase: 'uploading' });
      return;
    }
    pausedRef.current = true;
    patchTask({ phase: 'paused' });
  }

  function requestCancel() {
    useUiStore.getState().openConfirm({
      title: '取消本次上传？',
      description: '已上传的分片会被服务端清理，需要重新开始上传。',
      confirmText: '取消上传',
      danger: true,
      onConfirm: async () => {
        cancelledRef.current = true;
        stopRef.current = true;
        pausedRef.current = false;
        const uploadId = uploadIdRef.current;
        if (uploadId) {
          try {
            await uploadApi.abort(uploadId);
          } catch {
            /* 服务端清理失败不阻塞本地重置 */
          }
        }
        uploadIdRef.current = null;
        partUrlsRef.current = [];
        etagsRef.current = new Map();
        loadedRef.current = 0;
        samplesRef.current = [];
        setVideoId(null);
        setFailure(null);
        setHashRatio(0);
        resetTask();
        setFormStep('info');
      },
    });
  }

  function startOver() {
    cancelledRef.current = true;
    stopRef.current = true;
    pausedRef.current = false;
    completedRef.current = false;
    uploadIdRef.current = null;
    partUrlsRef.current = [];
    etagsRef.current = new Map();
    loadedRef.current = 0;
    samplesRef.current = [];
    resetTask();
    setVideoId(null);
    setFailure(null);
    setHashRatio(0);
    setFile(null);
    setMeta(null);
    setCoverDataUrl(null);
    setFileError(null);
    setTitle('');
    setDescription('');
    setCategoryId(null);
    setTags([]);
    setTagInput('');
    setVisibility('PUBLIC');
    setDownloadEnabled(false);
    setDeclared(false);
    setFormStep('file');
  }

  /* ---------------------------------------------------------------- 渲染 */

  const ringValue =
    phase === 'hashing'
      ? hashRatio * 100
      : phase === 'transcoding' || phase === 'reviewing'
        ? (transcode.data?.progress ?? 0)
        : phase === 'published'
          ? 100
          : progress;

  const resultVideoId = videoId ?? task?.videoId ?? null;
  const resultStatus: VideoStatus =
    phase === 'published' || transcodeVideoStatus === 'PUBLISHED'
      ? 'PUBLISHED'
      : phase === 'reviewing' || transcodeVideoStatus === 'REVIEWING'
        ? 'REVIEWING'
        : phase === 'failed'
          ? 'REJECTED'
          : 'PROCESSING';
  const canPlayResult = resultVideoId !== null && phase !== 'failed';

  const stepBody = (
    <motion.div
      key={step}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE.enter }}
    >
      {step === 'file' && (
        <SurfaceCard className="flex flex-col gap-5">
          <div>
            <h2 className="text-sm font-medium text-fg">视频类型</h2>
            <RadioGroup
              className="mt-3"
              name="upload-video-type"
              value={videoType}
              options={VIDEO_TYPE_OPTIONS}
              onChange={(value) => {
                setVideoType(value);
                if (file) void handleFile(file, value);
              }}
            />
          </div>

          <div>
            <h2 className="text-sm font-medium text-fg">选择文件</h2>
            <div
              role="button"
              tabIndex={0}
              aria-label="选择或拖入视频文件"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const dropped = event.dataTransfer.files?.[0];
                if (dropped) void handleFile(dropped);
              }}
              className={cn(
                'mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed px-4 py-10 text-center transition-colors duration-150',
                dragging ? 'border-accent bg-accent-soft' : 'border-line bg-surface-2 hover:border-fg-subtle',
              )}
            >
              {checking ? (
                <Loader2 className="size-6 animate-spin text-fg-subtle" aria-hidden />
              ) : (
                <CloudUpload className="size-7 text-fg-subtle" aria-hidden />
              )}
              <p className="text-sm font-medium text-fg">
                {checking ? '正在校验文件…' : '把视频拖到这里，或点击选择文件'}
              </p>
              <p className="text-xs text-fg-muted">
                支持 mp4 / mov / webm / m4v · {limits.label} ≤ {formatFileSize(limits.maxSize)} · 时长 ≤{' '}
                {formatDurationText(limits.maxDuration)}
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp4,.mov,.webm,.m4v,video/mp4,video/quicktime,video/webm"
              className="hidden"
              aria-label="选择视频文件"
              onChange={(event) => {
                const picked = event.target.files?.[0];
                if (picked) void handleFile(picked);
                event.target.value = '';
              }}
            />
          </div>

          {fileError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-btn border border-brand/40 bg-brand-soft px-3 py-2.5 text-xs leading-relaxed text-brand"
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{fileError}</span>
            </div>
          )}

          {file && (
            <div className="rounded-card border border-line bg-surface-2 p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                <span className="max-w-full truncate font-medium text-fg">{file.name}</span>
                <span className="tabular-nums">{formatFileSize(file.size)}</span>
                {meta && <span className="tabular-nums">时长 {formatDuration(meta.duration)}</span>}
                {meta && (
                  <span className="tabular-nums">
                    {meta.width}×{meta.height}
                  </span>
                )}
              </div>

              <div className="mt-3 grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
                <div className="overflow-hidden rounded-btn border border-line bg-surface">
                  {coverDataUrl ? (
                    <img src={coverDataUrl} alt="封面候选帧" className="aspect-video w-full object-cover" />
                  ) : (
                    <div className="grid aspect-video place-items-center text-xs text-fg-subtle">暂未截取封面</div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs leading-relaxed text-fg-muted">
                    默认取视频首帧作为封面候选，可拖动滑块选择其他时间点后重新截取。
                  </p>
                  <label htmlFor="cover-time" className="mt-3 block text-xs text-fg-muted">
                    截取时间点 <span className="tabular-nums text-fg">{formatDuration(captureAt)}</span>
                  </label>
                  <input
                    id="cover-time"
                    type="range"
                    className="range-control mt-1.5 w-full accent-[var(--c-accent)]"
                    min={0}
                    max={Math.max(1, Math.floor(meta?.duration ?? 1))}
                    step={1}
                    value={captureAt}
                    aria-label="封面截取时间点"
                    onChange={(event) => setCaptureAt(Number(event.target.value))}
                  />
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    icon={<Scissors className="size-3.5" />}
                    loading={capturing}
                    loadingText="截取中"
                    onClick={() => void recapture()}
                  >
                    重新截取
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button variant="primary" disabled={!file} onClick={() => setFormStep('info')}>
              下一步：填写信息
            </Button>
          </div>
        </SurfaceCard>
      )}

      {step === 'info' && (
        <SurfaceCard className="flex flex-col gap-6">
          <div>
            <label htmlFor="upload-title" className="text-sm font-medium text-fg">
              标题 <span className="text-brand">*</span>
            </label>
            <Input
              id="upload-title"
              className="mt-2"
              value={title}
              maxLength={VIDEO_MAX_TITLE}
              placeholder="一句话说明视频内容，避免夸张标题"
              onChange={(event) => setTitle(event.target.value)}
            />
            <div className="mt-1 flex justify-end text-[11px] tabular-nums text-fg-subtle">
              {title.length}/{VIDEO_MAX_TITLE}
            </div>
          </div>

          <div>
            <label htmlFor="upload-description" className="text-sm font-medium text-fg">
              简介
            </label>
            <Textarea
              id="upload-description"
              className="mt-2 min-h-28"
              value={description}
              maxLength={MAX_DESCRIPTION}
              placeholder="补充创作背景、素材来源、拍摄设备等信息"
              onChange={(event) => setDescription(event.target.value)}
              footer={
                <>
                  <span className="text-[11px] text-fg-subtle">可留空</span>
                  <span className="text-[11px] tabular-nums text-fg-subtle">
                    {description.length}/{MAX_DESCRIPTION}
                  </span>
                </>
              }
            />
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-fg">
              分区 <span className="text-brand">*</span>
            </legend>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" role="radiogroup" aria-label="选择分区">
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  role="radio"
                  aria-checked={categoryId === category.id}
                  onClick={() => setCategoryId(category.id)}
                  className={cn(
                    'h-9 rounded-btn border px-3 text-[13px] transition-colors duration-150',
                    categoryId === category.id
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg',
                  )}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="upload-tags" className="text-sm font-medium text-fg">
              标签
            </label>
            <Input
              id="upload-tags"
              className="mt-2"
              value={tagInput}
              icon={<Tags className="size-4" aria-hidden />}
              placeholder="输入后按回车添加，最多 10 个"
              maxLength={24}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addTag();
                }
              }}
            />
            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <Tag key={tag} label={tag} onRemove={() => setTags(tags.filter((item) => item !== tag))} />
                ))}
              </div>
            )}
            <p className="mt-1 text-[11px] tabular-nums text-fg-subtle">
              {tags.length}/{MAX_TAGS} · 标签用于搜索与推荐，请勿堆砌无关词
            </p>
          </div>

          <div>
            <h2 className="text-sm font-medium text-fg">可见性</h2>
            <RadioGroup
              className="mt-2"
              name="upload-visibility"
              value={visibility}
              options={VISIBILITY_OPTIONS}
              onChange={setVisibility}
            />
          </div>

          <div className="flex flex-col gap-4 rounded-card border border-line bg-surface-2 p-4">
            <Switch
              id="upload-download"
              checked={downloadEnabled}
              onChange={setDownloadEnabled}
              label="允许下载"
              description="开启后登录用户可以下载转码后的文件；关闭后仅在线播放。"
            />
            <Switch
              id="upload-declare"
              checked={declared}
              onChange={setDeclared}
              label="原创声明（必选）"
              description="依据《信息网络传播权保护条例》，我保证对该作品享有合法权利或已获得权利人授权，不含侵权与违规内容。"
            />
          </div>

          <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" onClick={() => setFormStep('file')}>
              上一步
            </Button>
            <div className="flex items-center justify-end gap-3">
              {!declared && <span className="text-[11px] text-fg-subtle">需勾选原创声明后才能提交</span>}
              <Button
                variant="primary"
                disabled={!declared || title.trim().length === 0 || categoryId === null}
                onClick={() => void startUpload()}
              >
                开始上传
              </Button>
            </div>
          </div>
        </SurfaceCard>
      )}

      {step === 'upload' && (
        <SurfaceCard className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <RingProgress value={ringValue} size={84}>
              <span className="text-sm font-semibold tabular-nums text-fg">{Math.round(ringValue)}%</span>
            </RingProgress>
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">{PHASE_TEXT[phase].title}</p>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">{PHASE_TEXT[phase].hint}</p>
            </div>
          </div>

          {(phase === 'hashing' || phase === 'uploading' || phase === 'paused' || phase === 'merging') && (
            <ProgressBar value={progress} size="md" tone={phase === 'paused' ? 'accent' : 'brand'} />
          )}

          {phase !== 'hashing' && (
            <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div className="rounded-btn bg-surface-2 px-3 py-2">
                <dt className="text-fg-subtle">已上传</dt>
                <dd className="mt-0.5 font-medium tabular-nums text-fg">
                  {formatFileSize(uploadedBytes)} / {formatFileSize(totalBytes)}
                </dd>
              </div>
              <div className="rounded-btn bg-surface-2 px-3 py-2">
                <dt className="text-fg-subtle">上传速度</dt>
                <dd className="mt-0.5 font-medium tabular-nums text-fg">{speed > 0 ? `${formatFileSize(speed)}/s` : '—'}</dd>
              </div>
              <div className="rounded-btn bg-surface-2 px-3 py-2">
                <dt className="text-fg-subtle">剩余时间</dt>
                <dd className="mt-0.5 font-medium tabular-nums text-fg">
                  {eta > 1 && phase !== 'transcoding' && phase !== 'reviewing' ? formatDurationText(eta) : '—'}
                </dd>
              </div>
              <div className="rounded-btn bg-surface-2 px-3 py-2">
                <dt className="text-fg-subtle">文件大小</dt>
                <dd className="mt-0.5 font-medium tabular-nums text-fg">{formatFileSize(totalBytes)}</dd>
              </div>
            </dl>
          )}

          {(phase === 'uploading' || phase === 'paused' || phase === 'merging') && (task?.parts.length ?? 0) > 0 && (
            <PartGrid parts={task?.parts ?? []} />
          )}

          {(phase === 'transcoding' || phase === 'reviewing' || phase === 'published') && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[...QUALITY_ORDER].reverse().map((quality, index, list) => {
                  const unit = 100 / list.length;
                  const value = transcode.data?.progress ?? 0;
                  const done = value >= (index + 1) * unit;
                  const current = !done && value > index * unit;
                  return (
                    <div
                      key={quality}
                      className={cn(
                        'rounded-btn border px-3 py-2 text-xs transition-colors',
                        done ? 'border-success/40 bg-success-soft text-success' : current ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-fg-subtle',
                      )}
                    >
                      <span className="font-medium">{QUALITY_LABELS[quality]}</span>
                      <span className="mt-0.5 block text-[11px]">{done ? '已完成' : current ? '转码中' : '等待中'}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs leading-relaxed text-fg-muted">
                {phase === 'published'
                  ? '视频已发布，可在创作中心查看播放与互动数据。'
                  : '转码与审核期间可以离开页面，进度会在创作中心继续更新。'}
              </p>
            </div>
          )}

          {failure && (
            <div
              role="alert"
              className="rounded-btn border border-brand/40 bg-brand-soft px-3 py-2.5 text-xs leading-relaxed text-brand"
            >
              <p className="font-medium">上传中断：{failure}</p>
              <p className="mt-1">已上传的分片会保留在服务端，可重试续传；若上传会话已过期则需要重新开始。</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void retryUpload()}>
                  重试续传
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    resetTask();
                    setFailure(null);
                    setFormStep('info');
                  }}
                >
                  返回修改信息
                </Button>
              </div>
            </div>
          )}

          {(phase === 'uploading' || phase === 'paused') && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                icon={phase === 'paused' ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                onClick={togglePause}
              >
                {phase === 'paused' ? '继续上传' : '暂停'}
              </Button>
              <Button variant="ghost" size="sm" icon={<X className="size-3.5" />} onClick={requestCancel}>
                取消上传
              </Button>
              <span className="text-[11px] text-fg-subtle">并发 {UPLOAD_LIMITS.maxConcurrency} 片 · 分片大小 {formatFileSize(task?.partSize ?? UPLOAD_LIMITS.partSize)}</span>
            </div>
          )}
        </SurfaceCard>
      )}

      {step === 'done' && (
        <SurfaceCard className="flex flex-col gap-5">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-success-soft text-success">
              <CheckCircle2 className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-fg">{task?.instant ? '已秒传' : '上传完成'}</h2>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                {task?.instant
                  ? '已秒传，文件已存在，无需重复上传。'
                  : '文件已上传完成，正在转码与审核，通过后自动发布。'}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-card border border-line bg-surface-2 p-4 sm:flex-row">
            <div className="aspect-video w-full overflow-hidden rounded-btn border border-line bg-surface sm:w-56">
              {task?.coverDataUrl ? (
                <img src={task.coverDataUrl} alt="视频封面" className="size-full object-cover" />
              ) : (
                <div className="grid size-full place-items-center text-xs text-fg-subtle">无封面</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="line-clamp-2 text-sm font-medium text-fg">{task?.title ?? title}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-fg-muted">
                <Badge tone={resultStatus === 'PUBLISHED' ? 'success' : resultStatus === 'REJECTED' ? 'brand' : 'warning'}>
                  {VIDEO_STATUS_LABELS[resultStatus]}
                </Badge>
                <span>{VIDEO_TYPE_LABELS[task?.videoType ?? videoType]}</span>
                {meta && <span className="tabular-nums">{formatDuration(meta.duration)}</span>}
                <span className="tabular-nums">{formatFileSize(task?.fileSize ?? file?.size ?? 0)}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {canPlayResult && resultVideoId !== null && (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Play className="size-3.5" />}
                    onClick={() =>
                      navigate((task?.videoType ?? videoType) === 'SHORT' ? `/shorts?v=${resultVideoId}` : `/video/${resultVideoId}`)
                    }
                  >
                    查看视频
                  </Button>
                )}
                <Button variant="outline" size="sm" icon={<RotateCcw className="size-3.5" />} onClick={startOver}>
                  继续上传
                </Button>
              </div>
            </div>
          </div>
        </SurfaceCard>
      )}
    </motion.div>
  );

  return (
    <PageContainer className="py-5 sm:py-6">
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0">
          <SectionHeader
            level={1}
            title="上传视频"
            subtitle="分片直传对象存储，支持断点续传与秒传；上传完成后进入转码与审核流程。"
          />
          <div className="mt-4">
            <StepIndicator current={step} />
          </div>
          <div className="mt-5">{stepBody}</div>
        </div>

        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <UploadGuidelines videoType={videoType} />
        </aside>
      </div>
    </PageContainer>
  );
}
