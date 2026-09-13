/**
 * 系统设置：审核策略、上传限制、推荐策略与青少年模式。
 * 权限点 admin:system_config；表单与已加载配置做浅比较，未变更时禁用保存。
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Plus, RotateCcw, Save, Settings } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorState, Input, SurfaceCard, Switch, Tag } from '@/components/ui';
import { usePlatformSettings, useUpdatePlatformSettings } from '@/hooks/useApi';
import { cn } from '@/lib/cn';
import { UPLOAD_LIMITS } from '@/lib/constants';
import type { PlatformSettings } from '@/api/types';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';

/** 平台默认配置：与后端初始化值保持一致（文档 10.1 / 13.3 / 14.3） */
const DEFAULT_SETTINGS: PlatformSettings = {
  review: { newUserForceReview: true, newUserWindowHours: 72, highTrustSampleRate: 0.05, autoReportThreshold: 5 },
  upload: {
    longMaxSizeGB: UPLOAD_LIMITS.long.maxSize / 1024 ** 3,
    shortMaxSizeMB: UPLOAD_LIMITS.short.maxSize / 1024 ** 2,
    longMaxDurationHours: UPLOAD_LIMITS.long.maxDuration / 3600,
    shortMaxDurationSeconds: UPLOAD_LIMITS.short.maxDuration,
    allowedExtensions: ['mp4', 'mov', 'webm', 'm4v'],
  },
  recommend: { personalizationEnabled: true, hotFallback: true },
  minor: { teenagerModeEnabled: false, dailyLimitMinutes: 40, nightBlockStart: '22:00', nightBlockEnd: '06:00' },
};

function settingsEqual(a: PlatformSettings, b: PlatformSettings): boolean {
  const extensionsEqual =
    a.upload.allowedExtensions.length === b.upload.allowedExtensions.length &&
    a.upload.allowedExtensions.every((ext, index) => ext === b.upload.allowedExtensions[index]);

  return (
    a.review.newUserForceReview === b.review.newUserForceReview &&
    a.review.newUserWindowHours === b.review.newUserWindowHours &&
    a.review.highTrustSampleRate === b.review.highTrustSampleRate &&
    a.review.autoReportThreshold === b.review.autoReportThreshold &&
    a.upload.longMaxSizeGB === b.upload.longMaxSizeGB &&
    a.upload.shortMaxSizeMB === b.upload.shortMaxSizeMB &&
    a.upload.longMaxDurationHours === b.upload.longMaxDurationHours &&
    a.upload.shortMaxDurationSeconds === b.upload.shortMaxDurationSeconds &&
    extensionsEqual &&
    a.recommend.personalizationEnabled === b.recommend.personalizationEnabled &&
    a.recommend.hotFallback === b.recommend.hotFallback &&
    a.minor.teenagerModeEnabled === b.minor.teenagerModeEnabled &&
    a.minor.dailyLimitMinutes === b.minor.dailyLimitMinutes &&
    a.minor.nightBlockStart === b.minor.nightBlockStart &&
    a.minor.nightBlockEnd === b.minor.nightBlockEnd
  );
}

function SectionCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <SurfaceCard className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {description && <p className="mt-1 text-xs leading-relaxed text-fg-muted">{description}</p>}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </SurfaceCard>
  );
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-wrap items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-fg">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] text-fg-subtle">{hint}</span>}
      </span>
      <Input
        type="number"
        value={String(value)}
        min={min}
        max={max}
        step="any"
        aria-label={label}
        className="h-9 w-36"
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (!Number.isFinite(parsed)) return;
          const clamped = max === undefined ? Math.max(min, parsed) : Math.min(max, Math.max(min, parsed));
          onChange(clamped);
        }}
        suffix={unit ? <span className="shrink-0 text-xs text-fg-subtle">{unit}</span> : undefined}
      />
    </label>
  );
}

export default function AdminSettingsPage() {
  const canConfig = useAuthStore((s) => s.hasPermission('admin:system_config'));
  const openConfirm = useUiStore((s) => s.openConfirm);
  const { data, isPending, isError, refetch } = usePlatformSettings();
  const update = useUpdatePlatformSettings();

  /** 本地草稿：为空时直接使用服务端配置，避免额外的同步副作用 */
  const [localDraft, setLocalDraft] = useState<PlatformSettings | null>(null);
  const [newExtension, setNewExtension] = useState('');

  const draft: PlatformSettings | null = localDraft ?? data ?? null;
  const dirty = useMemo(() => (draft && data ? !settingsEqual(draft, data) : false), [draft, data]);

  const setReview = (patch: Partial<PlatformSettings['review']>) =>
    setLocalDraft((prev) => {
      const base = prev ?? data;
      return base ? { ...base, review: { ...base.review, ...patch } } : prev;
    });
  const setUpload = (patch: Partial<PlatformSettings['upload']>) =>
    setLocalDraft((prev) => {
      const base = prev ?? data;
      return base ? { ...base, upload: { ...base.upload, ...patch } } : prev;
    });
  const setRecommend = (patch: Partial<PlatformSettings['recommend']>) =>
    setLocalDraft((prev) => {
      const base = prev ?? data;
      return base ? { ...base, recommend: { ...base.recommend, ...patch } } : prev;
    });
  const setMinor = (patch: Partial<PlatformSettings['minor']>) =>
    setLocalDraft((prev) => {
      const base = prev ?? data;
      return base ? { ...base, minor: { ...base.minor, ...patch } } : prev;
    });

  const addExtension = () => {
    if (!draft) return;
    const value = newExtension.trim().replace(/^\./, '').toLowerCase();
    if (!value) return;
    if (!draft.upload.allowedExtensions.includes(value)) {
      setUpload({ allowedExtensions: [...draft.upload.allowedExtensions, value] });
    }
    setNewExtension('');
  };

  const resetToDefault = () => {
    openConfirm({
      title: '重置为默认值',
      description: '表单将恢复为平台默认配置，需再点击「保存修改」才会写入并生效。当前未保存的修改会被覆盖。',
      confirmText: '重置表单',
      danger: true,
      onConfirm: () => setLocalDraft(structuredClone(DEFAULT_SETTINGS)),
    });
  };

  if (!canConfig) {
    return (
      <EmptyState
        icon={<Settings className="size-7" />}
        title="当前账号无权修改系统配置"
        description="系统设置仅对具备 admin:system_config 权限的账号开放。"
      />
    );
  }

  if (isPending || (!draft && !isError)) {
    return (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="rounded-card border border-line bg-surface p-5">
            <div className="skeleton-sheen h-4 w-24 rounded-[4px]" />
            <div className="skeleton-sheen mt-4 h-3 w-3/4 rounded-[4px]" />
            <div className="skeleton-sheen mt-3 h-3 w-2/3 rounded-[4px]" />
            <div className="skeleton-sheen mt-3 h-3 w-1/2 rounded-[4px]" />
          </div>
        ))}
      </div>
    );
  }

  if (isError || !draft) {
    return <ErrorState title="系统配置加载失败" description="暂时无法获取平台配置，请稍后重试。" onRetry={() => void refetch()} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard
          title="审核策略"
          description="新用户与高信任账号的审核强度，影响内容进入公开可见范围的速度。"
        >
          <Switch
            checked={draft.review.newUserForceReview}
            onChange={(checked) => setReview({ newUserForceReview: checked })}
            label="新用户强制先审后发"
            description="注册时间在新用户窗口内的账号，投稿一律进入人工审核队列。"
          />
          <NumberField
            label="新用户窗口时长"
            hint="超过该时长后按账号信任分决定是否先审后发"
            value={draft.review.newUserWindowHours}
            min={0}
            max={720}
            unit="小时"
            onChange={(value) => setReview({ newUserWindowHours: value })}
          />
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-fg">高信任用户抽检比例</span>
                <span className="mt-0.5 block text-[11px] text-fg-subtle">仅对高信任账号随机抽检，其余直接发布</span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-fg">
                {Math.round(draft.review.highTrustSampleRate * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={draft.review.highTrustSampleRate}
              aria-label="高信任用户抽检比例"
              className="w-full accent-[var(--c-accent)]"
              onChange={(event) => setReview({ highTrustSampleRate: Number(event.target.value) })}
            />
          </div>
          <NumberField
            label="自动下架举报阈值"
            hint="同一内容被举报达到该数量时自动下架并进入人工复核"
            value={draft.review.autoReportThreshold}
            min={1}
            max={100}
            unit="次"
            onChange={(value) => setReview({ autoReportThreshold: value })}
          />
        </SectionCard>

        <SectionCard title="上传限制" description="超出限制的文件会在客户端直接拦截，不消耗上传带宽。">
          <NumberField
            label="长视频最大体积"
            hint="单文件上限"
            value={draft.upload.longMaxSizeGB}
            min={1}
            max={64}
            unit="GB"
            onChange={(value) => setUpload({ longMaxSizeGB: value })}
          />
          <NumberField
            label="短视频最大体积"
            hint="单文件上限"
            value={draft.upload.shortMaxSizeMB}
            min={10}
            max={2048}
            unit="MB"
            onChange={(value) => setUpload({ shortMaxSizeMB: value })}
          />
          <NumberField
            label="长视频最长时长"
            value={draft.upload.longMaxDurationHours}
            min={1}
            max={24}
            unit="小时"
            onChange={(value) => setUpload({ longMaxDurationHours: value })}
          />
          <NumberField
            label="短视频最长时长"
            value={draft.upload.shortMaxDurationSeconds}
            min={10}
            max={600}
            unit="秒"
            onChange={(value) => setUpload({ shortMaxDurationSeconds: value })}
          />
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-fg">允许的扩展名</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {draft.upload.allowedExtensions.map((ext) => (
                <Tag key={ext} label={`.${ext}`} size="sm" onRemove={() => setUpload({
                  allowedExtensions: draft.upload.allowedExtensions.filter((item) => item !== ext),
                })} />
              ))}
              {draft.upload.allowedExtensions.length === 0 && (
                <span className="text-[11px] text-fg-subtle">尚未配置扩展名，保存后将拒绝所有格式投稿</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={newExtension}
                placeholder="例如 mkv"
                aria-label="新增允许的扩展名"
                className="h-9 w-40"
                onChange={(event) => setNewExtension(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addExtension();
                  }
                }}
              />
              <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={addExtension}>
                添加
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="推荐策略" description="个性化推荐开关同时作用于首页推荐流、短视频流与相关推荐。">
          <Switch
            checked={draft.recommend.personalizationEnabled}
            onChange={(checked) => setRecommend({ personalizationEnabled: checked })}
            label="启用个性化推荐"
            description="关闭后首页仅展示热门榜与关注时间线内容。"
          />
          <Switch
            checked={draft.recommend.hotFallback}
            onChange={(checked) => setRecommend({ hotFallback: checked })}
            label="算法不可用时回退热门"
            description="推荐服务超时或降级时，使用热度榜结果兜底，避免首页空白。"
          />
          <p className="rounded-btn border border-line bg-surface-2 px-3 py-2.5 text-[11px] leading-relaxed text-fg-muted">
            合规说明：依据《互联网信息服务算法推荐管理规定》，需完成算法备案并提供关闭个性化推荐的入口。
            本站已在「设置 - 隐私偏好」与后台提供关闭开关，关闭后不影响用户浏览热门内容。
          </p>
        </SectionCard>

        <SectionCard title="青少年模式" description="青少年模式开启后，用户端需监护密码才能关闭。">
          <Switch
            checked={draft.minor.teenagerModeEnabled}
            onChange={(checked) => setMinor({ teenagerModeEnabled: checked })}
            label="启用青少年模式"
            description="限制内容池为适龄范围，并按下方时长与宵禁规则限制使用。"
          />
          <NumberField
            label="每日时长上限"
            value={draft.minor.dailyLimitMinutes}
            min={10}
            max={240}
            unit="分钟"
            onChange={(value) => setMinor({ dailyLimitMinutes: value })}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-fg">宵禁时间</span>
              <span className="mt-0.5 block text-[11px] text-fg-subtle">宵禁时段内禁止使用，跨零点区间同样生效</span>
            </span>
            <span className="flex items-center gap-2">
              <Input
                type="time"
                value={draft.minor.nightBlockStart}
                aria-label="宵禁开始时间"
                className="h-9 w-32"
                onChange={(event) => setMinor({ nightBlockStart: event.target.value })}
              />
              <span className="text-xs text-fg-subtle">至</span>
              <Input
                type="time"
                value={draft.minor.nightBlockEnd}
                aria-label="宵禁结束时间"
                className="h-9 w-32"
                onChange={(event) => setMinor({ nightBlockEnd: event.target.value })}
              />
            </span>
          </div>
        </SectionCard>
      </div>

      <div
        className={cn(
          'sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-surface px-4 py-3 lg:-mx-6 lg:px-6',
        )}
      >
        <Button
          variant="primary"
          icon={<Save className="size-4" />}
          disabled={!dirty}
          loading={update.isPending}
          title={dirty ? '保存并立即生效' : '当前没有未保存的变更'}
          onClick={() => update.mutate(draft)}
        >
          保存修改
        </Button>
        <Button variant="outline" icon={<RotateCcw className="size-4" />} onClick={resetToDefault}>
          重置为默认值
        </Button>
        {dirty ? (
          <Badge tone="warning">有未保存的变更</Badge>
        ) : (
          <span className="text-[11px] text-fg-subtle">配置与线上一致</span>
        )}
        <span className="ml-auto hidden text-[11px] text-fg-subtle sm:inline">
          配置变更会记入操作日志，包含操作人与变更时间
        </span>
      </div>
    </div>
  );
}
