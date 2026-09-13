/**
 * 举报处理：按优先级处理用户举报，处置结果会通知举报人。
 * 权限点 moderation:report。
 */
import { useState, type ComponentType } from 'react';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Avatar,
  ListSkeleton,
  Modal,
  Pagination,
  SearchInput,
  SurfaceCard,
  Tabs,
  Textarea,
} from '@/components/ui';
import { Flag, MessageSquare, Newspaper, UserRound, Video } from 'lucide-react';
import { useHandleReport, useReportTasks } from '@/hooks/useApi';
import { cn } from '@/lib/cn';
import { REPORT_REASONS } from '@/lib/constants';
import { formatRelative } from '@/lib/format';
import type { ReportReason, ReportTask } from '@/api/types';

type StatusFilter = 'ALL' | ReportTask['status'];
type ReasonFilter = 'ALL' | ReportReason;

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'PENDING', label: '待处理' },
  { key: 'PROCESSING', label: '处理中' },
  { key: 'RESOLVED', label: '已处理' },
  { key: 'REJECTED', label: '已驳回' },
  { key: 'ALL', label: '全部' },
];

const STATUS_META: Record<ReportTask['status'], { label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' }> = {
  PENDING: { label: '待处理', tone: 'warning' },
  PROCESSING: { label: '处理中', tone: 'accent' },
  RESOLVED: { label: '已处理', tone: 'success' },
  REJECTED: { label: '已驳回', tone: 'neutral' },
};

const TARGET_LABELS: Record<ReportTask['targetType'], string> = {
  VIDEO: '视频',
  COMMENT: '评论',
  FEED: '动态',
  USER: '用户',
};

const TARGET_ICONS: Record<ReportTask['targetType'], ComponentType<{ className?: string }>> = {
  VIDEO: Video,
  COMMENT: MessageSquare,
  FEED: Newspaper,
  USER: UserRound,
};

const REASON_LABELS = REPORT_REASONS.reduce<Record<string, string>>((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {});

const PAGE_SIZE = 10;

function targetHref(report: ReportTask): string | null {
  if (report.targetType === 'VIDEO') return `/video/${report.targetId}`;
  if (report.targetType === 'FEED') return `/feed/${report.targetId}`;
  if (report.targetType === 'USER') return `/user/${report.targetId}`;
  return null;
}

function PriorityDots({ value }: { value: number }) {
  const level = Math.min(5, Math.max(1, Math.round(value)));
  return (
    <span className="inline-flex items-center gap-1.5" title={`优先级 ${level} / 5`}>
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((step) => (
          <span
            key={step}
            className={cn(
              'size-1.5 rounded-full',
              step <= level ? (level >= 4 ? 'bg-brand' : 'bg-warning') : 'bg-surface-3',
            )}
          />
        ))}
      </span>
      <span className="text-[11px] tabular-nums text-fg-subtle">P{level}</span>
    </span>
  );
}

function ReportRow({ report, onOpen }: { report: ReportTask; onOpen: () => void }) {
  const Icon = TARGET_ICONS[report.targetType];
  const status = STATUS_META[report.status];
  const href = targetHref(report);

  return (
    <li className="flex flex-col gap-2.5 px-4 py-3.5 transition-colors hover:bg-surface-2 lg:flex-row lg:items-center lg:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
          <span className="inline-flex items-center gap-1 rounded-[6px] bg-surface-2 px-1.5 py-0.5 text-fg-muted">
            <Icon className="size-3.5" aria-hidden />
            {TARGET_LABELS[report.targetType]}
          </span>
          <span className="tabular-nums">#{report.id}</span>
          <PriorityDots value={report.priority} />
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="max-w-[320px] truncate text-[13px] font-medium text-fg hover:text-accent"
            >
              {report.targetTitle}
            </a>
          ) : (
            <span className="max-w-[320px] truncate text-[13px] font-medium text-fg">{report.targetTitle}</span>
          )}
          <Badge tone="danger">{REASON_LABELS[report.reason] ?? report.reason}</Badge>
        </div>

        <p className="line-clamp-2 text-xs leading-relaxed text-fg-muted">{report.description || '举报人未填写补充说明'}</p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-subtle">
          <span className="inline-flex items-center gap-1.5">
            <Avatar src={report.reporter.avatar} name={report.reporter.nickname} size="xs" />
            {report.reporter.nickname}
          </span>
          <span>{formatRelative(report.createdAt)}</span>
          {report.evidenceUrls.length > 0 && <span>证据 {report.evidenceUrls.length} 条</span>}
          {report.handledAt && <span>处置于 {formatRelative(report.handledAt)}</span>}
        </div>
      </div>

      <Button size="sm" variant="outline" className="self-start lg:self-center" onClick={onOpen}>
        处理
      </Button>
    </li>
  );
}

export default function AdminReportPage() {
  const [status, setStatus] = useState<StatusFilter>('PENDING');
  const [reason, setReason] = useState<ReasonFilter>('ALL');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<ReportTask | null>(null);
  const [note, setNote] = useState('');

  const query = useReportTasks({ page, pageSize: PAGE_SIZE, status, reason });
  const handle = useHandleReport();

  const items = query.data?.items ?? [];
  const term = keyword.trim().toLowerCase();
  const visible = term
    ? items.filter(
        (report) =>
          report.targetTitle.toLowerCase().includes(term) ||
          report.description.toLowerCase().includes(term) ||
          report.reporter.nickname.toLowerCase().includes(term),
      )
    : items;

  const resetForFilter = () => {
    setPage(1);
  };

  const openDetail = (report: ReportTask) => {
    setActive(report);
    setNote('');
  };

  const submit = async (next: 'PROCESSING' | 'RESOLVED' | 'REJECTED') => {
    if (!active) return;
    await handle.mutateAsync({ reportId: active.id, status: next, note: note.trim() || undefined });
    setActive(null);
  };

  const terminal = active?.status === 'RESOLVED' || active?.status === 'REJECTED';

  return (
    <div className="flex flex-col gap-4">
      <SurfaceCard className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            items={STATUS_TABS}
            value={status}
            variant="segment"
            size="sm"
            onChange={(value) => {
              setStatus(value);
              resetForFilter();
            }}
          />
          <SearchInput
            value={keyword}
            placeholder="按目标标题、描述或举报人筛选"
            aria-label="按目标标题、描述或举报人筛选"
            className="h-9 w-full sm:w-72"
            onChange={(event) => setKeyword(event.target.value)}
            onClear={() => setKeyword('')}
          />
        </div>
        <div className="hide-scrollbar flex items-center gap-1.5 overflow-x-auto border-t border-line pt-3">
          <button
            type="button"
            onClick={() => {
              setReason('ALL');
              resetForFilter();
            }}
            className={cn(
              'h-7 shrink-0 rounded-pill border px-3 text-xs font-medium transition-colors',
              reason === 'ALL' ? 'border-transparent bg-fg text-canvas' : 'border-line text-fg-muted hover:text-fg',
            )}
          >
            全部类型
          </button>
          {REPORT_REASONS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                setReason(item.value);
                resetForFilter();
              }}
              className={cn(
                'h-7 shrink-0 rounded-pill border px-3 text-xs font-medium transition-colors',
                reason === item.value
                  ? 'border-transparent bg-fg text-canvas'
                  : 'border-line text-fg-muted hover:text-fg',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </SurfaceCard>

      {query.isPending ? (
        <ListSkeleton rows={6} />
      ) : query.isError ? (
        <ErrorState title="举报列表加载失败" description="暂时无法获取举报数据，请稍后重试。" onRetry={() => void query.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Flag className="size-7" />}
          title="没有符合条件的举报"
          description="当前筛选条件下没有待处理记录。可切换状态或举报类型查看历史处置结果。"
        />
      ) : (
        <>
          <SurfaceCard padded={false}>
            <ul className="divide-y divide-line">
              {visible.map((report) => (
                <ReportRow key={report.id} report={report} onOpen={() => openDetail(report)} />
              ))}
            </ul>
          </SurfaceCard>
          <Pagination page={page} total={query.data?.total ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}

      <Modal
        open={active !== null}
        onClose={() => setActive(null)}
        title={active ? `举报详情 #${active.id}` : '举报详情'}
        description="处置结果会通知举报人，操作会记入后台操作日志。"
        size="lg"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setActive(null)}>
              取消
            </Button>
            <Button
              variant="outline"
              disabled={terminal || handle.isPending}
              title={terminal ? '该举报已处置完毕' : '举报不成立，保留原内容'}
              onClick={() => void submit('REJECTED')}
            >
              驳回举报
            </Button>
            <Button
              variant="secondary"
              disabled={terminal || handle.isPending}
              title={terminal ? '该举报已处置完毕' : '标记为处理中，稍后继续跟进'}
              onClick={() => void submit('PROCESSING')}
            >
              标记处理中
            </Button>
            <Button
              variant="danger"
              loading={handle.isPending}
              disabled={terminal}
              title={terminal ? '该举报已处置完毕' : '认定违规并下架被举报内容'}
              onClick={() => void submit('RESOLVED')}
            >
              认定违规并下架
            </Button>
          </div>
        }
      >
        {active && (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-fg-subtle">目标类型</dt>
                <dd className="mt-0.5 text-fg">{TARGET_LABELS[active.targetType]}</dd>
              </div>
              <div>
                <dt className="text-fg-subtle">目标 ID</dt>
                <dd className="mt-0.5 tabular-nums text-fg">{active.targetId}</dd>
              </div>
              <div>
                <dt className="text-fg-subtle">举报原因</dt>
                <dd className="mt-0.5 text-fg">{REASON_LABELS[active.reason] ?? active.reason}</dd>
              </div>
              <div>
                <dt className="text-fg-subtle">举报人</dt>
                <dd className="mt-0.5 text-fg">{active.reporter.nickname}</dd>
              </div>
              <div>
                <dt className="text-fg-subtle">举报时间</dt>
                <dd className="mt-0.5 text-fg">{formatRelative(active.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-fg-subtle">优先级</dt>
                <dd className="mt-0.5">
                  <PriorityDots value={active.priority} />
                </dd>
              </div>
            </dl>

            <div>
              <p className="mb-1.5 text-xs text-fg-subtle">目标快照</p>
              <p className="rounded-btn border border-line bg-surface-2 px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap text-fg-muted">
                {active.targetSnapshot || active.targetTitle}
              </p>
            </div>

            <div>
              <p className="mb-1.5 text-xs text-fg-subtle">举报描述</p>
              <p className="text-[13px] leading-relaxed text-fg">{active.description || '举报人未填写补充说明'}</p>
            </div>

            {active.evidenceUrls.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs text-fg-subtle">证据链接</p>
                <ul className="flex flex-col gap-1">
                  {active.evidenceUrls.map((url) => (
                    <li key={url}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-xs text-accent hover:underline"
                      >
                        {url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="mb-1.5 text-xs text-fg-subtle">处理备注（选填，仅后台可见）</p>
              <Textarea
                value={note}
                rows={3}
                maxLength={200}
                disabled={terminal}
                placeholder="记录判断依据，便于后续复核"
                aria-label="处理备注"
                onChange={(event) => setNote(event.target.value)}
              />
            </div>

            <p className="text-[11px] leading-relaxed text-fg-subtle">
              认定违规并下架：内容立即对用户不可见并进入回收站，30 天内可恢复；驳回举报：保留原内容，仅关闭该举报单；
              标记处理中：举报单保留在队列中，便于多人协作跟进。
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
