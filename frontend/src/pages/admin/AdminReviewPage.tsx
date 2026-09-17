/**
 * 内容审核：机审结果 + 人工复核队列，支持批量处置与键盘快捷操作。
 * 权限点 moderation:review（由路由守卫与 hook 双重收敛）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  ListSkeleton,
  Modal,
  Pagination,
  SearchInput,
  SurfaceCard,
  Tabs,
  Tag,
  Textarea,
} from '@/components/ui';
import { useDecideReview, useReviewTasks } from '@/hooks/useApi';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';
import type { ReviewTask } from '@/api/types';

type StatusFilter = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED';
type RiskFilter = 'ALL' | 'LOW' | 'MEDIUM' | 'HIGH';
type Decision = 'APPROVE' | 'REJECT';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'ALL', label: '全部' },
  { key: 'PENDING', label: '待审核' },
  { key: 'APPROVED', label: '已通过' },
  { key: 'REJECTED', label: '已驳回' },
];

const RISK_TABS: { key: RiskFilter; label: string }[] = [
  { key: 'ALL', label: '全部风险' },
  { key: 'LOW', label: '低' },
  { key: 'MEDIUM', label: '中' },
  { key: 'HIGH', label: '高' },
];

const STATUS_META: Record<ReviewTask['status'], { label: string; tone: 'neutral' | 'success' | 'warning' | 'brand' }> = {
  PENDING: { label: '待审核', tone: 'warning' },
  APPROVED: { label: '已通过', tone: 'success' },
  REJECTED: { label: '已驳回', tone: 'brand' },
};

const MACHINE_META: Record<ReviewTask['machineResult'], { label: string; tone: 'success' | 'warning' | 'brand' }> = {
  PASS: { label: '机审通过', tone: 'success' },
  SUSPECT: { label: '疑似违规', tone: 'warning' },
  BLOCK: { label: '机审拦截', tone: 'brand' },
};

const RISK_META: Record<ReviewTask['riskLevel'], { label: string; className: string }> = {
  LOW: { label: '低', className: 'text-fg-muted' },
  MEDIUM: { label: '中', className: 'text-warning' },
  HIGH: { label: '高', className: 'text-brand' },
};

const REJECT_TEMPLATES = ['封面与内容不符', '标题党', '含违规内容', '画质过低', '涉嫌搬运'];

const PAGE_SIZE = 10;
const TH_CLASS = 'sticky top-14 z-10 h-9 bg-surface px-3 text-xs font-medium text-fg-muted';

function ReviewRow({
  task,
  selected,
  checked,
  onCheck,
  onSelect,
  onApprove,
  onReject,
}: {
  task: ReviewTask;
  selected: boolean;
  checked: boolean;
  onCheck: () => void;
  onSelect: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const status = STATUS_META[task.status];
  const machine = MACHINE_META[task.machineResult];
  const risk = RISK_META[task.riskLevel];
  const editable = task.status === 'PENDING';

  return (
    <tr
      onClick={onSelect}
      className={cn(
        'h-12 border-b border-line text-[13px] transition-colors last:border-0',
        selected ? 'bg-accent-soft/60' : 'hover:bg-surface-2',
      )}
    >
      <td className="w-10 px-3">
        <input
          type="checkbox"
          className="size-4 accent-[var(--c-accent)]"
          checked={checked}
          aria-label={`选择 ${task.video.title}`}
          onChange={onCheck}
          onClick={(event) => event.stopPropagation()}
        />
      </td>
      <td className="px-3">
        <div className="flex items-center gap-2.5">
          <span className="h-9 w-16 shrink-0 overflow-hidden rounded-[4px] bg-surface-2">
            <img src={task.video.coverUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
          </span>
          <div className="min-w-0">
            <a
              href={`/video/${task.video.id}`}
              target="_blank"
              rel="noreferrer"
              className="block w-full truncate font-medium text-fg hover:text-accent"
            >
              {task.video.title}
            </a>
            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fg-subtle">
              <Avatar src={task.video.author.avatar} name={task.video.author.nickname} size="xs" />
              {task.video.author.nickname}
            </span>
          </div>
        </div>
      </td>
      <td className="hidden px-3 text-xs text-fg-muted xl:table-cell">{task.video.category?.name ?? '未分区'}</td>
      <td className="hidden px-3 text-xs text-fg-muted xl:table-cell">{formatRelative(task.submittedAt)}</td>
      <td className="px-3">
        <div className="flex flex-wrap items-center gap-1">
          <Badge tone={machine.tone}>{machine.label}</Badge>
          {task.machineLabels.slice(0, 2).map((label) => (
            <Tag key={label} label={label} size="sm" />
          ))}
        </div>
      </td>
      <td className={cn('px-3 text-xs font-medium', risk.className)}>{risk.label}</td>
      <td className="px-3 text-xs tabular-nums text-fg-muted">{task.reportCount}</td>
      <td className="px-3">
        <Badge tone={status.tone}>{status.label}</Badge>
      </td>
      <td className="px-3">
        <div className="flex items-center gap-1.5">
          <Button
            size="xs"
            variant="primary"
            disabled={!editable}
            title={editable ? '通过审核并发布' : '该任务已处理'}
            onClick={(event) => {
              event.stopPropagation();
              onApprove();
            }}
          >
            通过
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={!editable}
            title={editable ? '驳回并填写审核意见' : '该任务已处理'}
            onClick={(event) => {
              event.stopPropagation();
              onReject();
            }}
          >
            驳回
          </Button>
        </div>
      </td>
    </tr>
  );
}

function ReviewCard({
  task,
  checked,
  onCheck,
  onApprove,
  onReject,
}: {
  task: ReviewTask;
  checked: boolean;
  onCheck: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const status = STATUS_META[task.status];
  const machine = MACHINE_META[task.machineResult];
  const risk = RISK_META[task.riskLevel];
  const editable = task.status === 'PENDING';

  return (
    <SurfaceCard className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-[var(--c-accent)]"
          checked={checked}
          aria-label={`选择 ${task.video.title}`}
          onChange={onCheck}
        />
        <span className="h-12 w-20 shrink-0 overflow-hidden rounded-[4px] bg-surface-2">
          <img src={task.video.coverUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
        </span>
        <div className="min-w-0 flex-1">
          <a
            href={`/video/${task.video.id}`}
            target="_blank"
            rel="noreferrer"
            className="line-clamp-2 text-[13px] font-medium text-fg hover:text-accent"
          >
            {task.video.title}
          </a>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-fg-subtle">
            <Avatar src={task.video.author.avatar} name={task.video.author.nickname} size="xs" />
            {task.video.author.nickname}
            <span>·</span>
            {task.video.category?.name ?? '未分区'}
            <span>·</span>
            {formatRelative(task.submittedAt)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={machine.tone}>{machine.label}</Badge>
        <Badge tone={status.tone}>{status.label}</Badge>
        {task.machineLabels.map((label) => (
          <Tag key={label} label={label} size="sm" />
        ))}
        <span className={cn('text-[11px] font-medium', risk.className)}>风险 {risk.label}</span>
        <span className="text-[11px] text-fg-subtle">举报 {task.reportCount}</span>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={!editable} onClick={onApprove} className="flex-1">
          通过
        </Button>
        <Button size="sm" variant="outline" disabled={!editable} onClick={onReject} className="flex-1">
          驳回
        </Button>
      </div>
    </SurfaceCard>
  );
}

export default function AdminReviewPage() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>('PENDING');
  const [risk, setRisk] = useState<RiskFilter>('ALL');
  const [keyword, setKeyword] = useState(() => params.get('q') ?? '');
  const [page, setPage] = useState(1);
  const [cursorId, setCursorId] = useState<number | null>(null);
  const [checked, setChecked] = useState<number[]>([]);
  const [rejectTargets, setRejectTargets] = useState<ReviewTask[]>([]);
  const [note, setNote] = useState('');
  const [noteInvalid, setNoteInvalid] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const query = useReviewTasks({ page, pageSize: PAGE_SIZE, status, riskLevel: risk });
  const decide = useDecideReview();

  const items = query.data?.items;
  const visible = useMemo(() => {
    /*
     * 先丢弃 video 缺失的任务：审核行渲染时会读 task.video.title / coverUrl / author，
     * 一条 video 为 null 的记录（视频已删除但审核任务还在）就会让整个后台抛错白屏。
     * 后端已用 INNER JOIN videos 过滤这类孤儿行，这里再兜一层，保证坏数据不会打穿界面。
     */
    const list = (items ?? []).filter((task) => task.video);
    const term = keyword.trim().toLowerCase();
    return term ? list.filter((task) => task.video.title.toLowerCase().includes(term)) : list;
  }, [items, keyword]);

  const pendingIds = visible.filter((task) => task.status === 'PENDING').map((task) => task.id);
  const batchTargets = visible.filter((task) => checked.includes(task.id) && task.status === 'PENDING');
  const allChecked = pendingIds.length > 0 && pendingIds.every((id) => checked.includes(id));

  const runBatch = async (tasks: ReviewTask[], decision: Decision, reviewNote?: string) => {
    if (tasks.length === 0) return;
    setProgress({ done: 0, total: tasks.length });
    for (let index = 0; index < tasks.length; index += 1) {
      try {
        await decide.mutateAsync({ taskId: tasks[index].id, decision, note: reviewNote });
      } catch {
        // 单项失败不中断批量流程，失败原因由全局 mutation 错误提示给出
      }
      setProgress({ done: index + 1, total: tasks.length });
    }
    setProgress(null);
    setChecked([]);
    setCursorId(null);
  };

  const approveOne = (task: ReviewTask) => {
    void decide.mutateAsync({ taskId: task.id, decision: 'APPROVE' }).catch(() => undefined);
  };

  const openReject = (tasks: ReviewTask[]) => {
    if (tasks.length === 0) return;
    setRejectTargets(tasks);
    setNote('');
    setNoteInvalid(false);
  };

  const confirmReject = async () => {
    const trimmed = note.trim();
    if (!trimmed) {
      setNoteInvalid(true);
      return;
    }
    const targets = rejectTargets;
    setRejectTargets([]);
    await runBatch(targets, 'REJECT', trimmed);
  };

  /** 键盘快捷操作：J / K 移动，A 通过，R 驳回 */
  const decideRef = useRef(decide);
  const keyboardRef = useRef<{ visible: ReviewTask[]; cursorId: number | null; modalOpen: boolean }>({
    visible: [],
    cursorId: null,
    modalOpen: false,
  });

  // 每次渲染后同步最新状态到 ref，保证事件监听始终读取当前值
  useEffect(() => {
    decideRef.current = decide;
    keyboardRef.current = { visible, cursorId, modalOpen: rejectTargets.length > 0 };
  });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      }
      const state = keyboardRef.current;
      if (state.modalOpen) return;
      const key = event.key.toLowerCase();
      if (key !== 'j' && key !== 'k' && key !== 'a' && key !== 'r') return;
      const list = state.visible;
      if (list.length === 0) return;
      event.preventDefault();

      if (key === 'j' || key === 'k') {
        const current = list.findIndex((task) => task.id === state.cursorId);
        const nextIndex =
          current === -1
            ? key === 'j'
              ? 0
              : list.length - 1
            : Math.min(list.length - 1, Math.max(0, current + (key === 'j' ? 1 : -1)));
        setCursorId(list[nextIndex].id);
        return;
      }

      const task = list.find((item) => item.id === state.cursorId);
      if (!task || task.status !== 'PENDING') return;
      if (key === 'a') {
        void decideRef.current.mutateAsync({ taskId: task.id, decision: 'APPROVE' }).catch(() => undefined);
      } else {
        setRejectTargets([task]);
        setNote('');
        setNoteInvalid(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const resetForFilter = () => {
    setPage(1);
    setCursorId(null);
    setChecked([]);
  };

  const busy = decide.isPending || progress !== null;

  return (
    <div className="flex flex-col gap-4">
      <SurfaceCard className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
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
          <Tabs
            items={RISK_TABS}
            value={risk}
            variant="pill"
            size="sm"
            onChange={(value) => {
              setRisk(value);
              resetForFilter();
            }}
          />
          <SearchInput
            value={keyword}
            placeholder="按视频标题筛选"
            aria-label="按视频标题筛选"
            className="h-9 w-full sm:w-64"
            onChange={(event) => setKeyword(event.target.value)}
            onClear={() => setKeyword('')}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <label className="flex items-center gap-2 text-[13px] text-fg-muted">
            <input
              type="checkbox"
              className="size-4 accent-[var(--c-accent)]"
              checked={allChecked}
              disabled={pendingIds.length === 0}
              aria-label="选择本页全部待审核内容"
              onChange={(event) => {
                setChecked(event.target.checked ? pendingIds : []);
              }}
            />
            已选 {checked.length} 项
          </label>
          <Button
            size="sm"
            variant="primary"
            disabled={batchTargets.length === 0 || busy}
            onClick={() => void runBatch(batchTargets, 'APPROVE')}
          >
            批量通过
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={batchTargets.length === 0 || busy}
            onClick={() => openReject(batchTargets)}
          >
            批量驳回
          </Button>
          {progress && (
            <Badge tone="accent">
              处理中 {progress.done}/{progress.total}
            </Badge>
          )}
          <span className="ml-auto hidden text-[11px] text-fg-subtle lg:inline">
            快捷键：J / K 上下移动选中行，A 通过，R 驳回
          </span>
        </div>
      </SurfaceCard>

      {query.isPending ? (
        <ListSkeleton rows={6} />
      ) : query.isError ? (
        <ErrorState title="审核队列加载失败" description="暂时无法获取待审核内容，请稍后重试。" onRetry={() => void query.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="size-7" />}
          title="当前没有待审核内容"
          description="队列已清空。新的机审疑似内容会自动进入这里。"
        />
      ) : (
        <>
          <div className="hidden lg:block">
            <SurfaceCard padded={false}>
              <table className="w-full table-fixed border-collapse text-left">
                <thead>
                  <tr>
                    <th className={cn(TH_CLASS, 'w-10')} aria-label="选择" />
                    <th className={cn(TH_CLASS, 'w-[240px]')}>视频</th>
                    <th className={cn(TH_CLASS, 'hidden w-[72px] xl:table-cell')}>分区</th>
                    <th className={cn(TH_CLASS, 'hidden w-[88px] xl:table-cell')}>提交时间</th>
                    <th className={cn(TH_CLASS, 'w-[142px]')}>机审结果</th>
                    <th className={cn(TH_CLASS, 'w-[52px]')}>风险</th>
                    <th className={cn(TH_CLASS, 'w-[48px]')}>举报</th>
                    <th className={cn(TH_CLASS, 'w-[72px]')}>状态</th>
                    <th className={cn(TH_CLASS, 'w-[120px]')}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((task) => (
                    <ReviewRow
                      key={task.id}
                      task={task}
                      selected={cursorId === task.id}
                      checked={checked.includes(task.id)}
                      onSelect={() => setCursorId(task.id)}
                      onCheck={() =>
                        setChecked((prev) => (prev.includes(task.id) ? prev.filter((id) => id !== task.id) : [...prev, task.id]))
                      }
                      onApprove={() => approveOne(task)}
                      onReject={() => openReject([task])}
                    />
                  ))}
                </tbody>
              </table>
            </SurfaceCard>
          </div>

          <div className="flex flex-col gap-3 lg:hidden">
            {visible.map((task) => (
              <ReviewCard
                key={task.id}
                task={task}
                checked={checked.includes(task.id)}
                onCheck={() =>
                  setChecked((prev) => (prev.includes(task.id) ? prev.filter((id) => id !== task.id) : [...prev, task.id]))
                }
                onApprove={() => approveOne(task)}
                onReject={() => openReject([task])}
              />
            ))}
          </div>

          <Pagination page={page} total={query.data?.total ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}

      <Modal
        open={rejectTargets.length > 0}
        onClose={() => setRejectTargets([])}
        title={rejectTargets.length > 1 ? `批量驳回 ${rejectTargets.length} 个视频` : '驳回审核'}
        description="驳回后视频不会发布，作者会收到审核意见并可修改后重新提交。"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejectTargets([])}>
              取消
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void confirmReject()}>
              确认驳回
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-1.5 text-[13px] text-fg-muted">
            {rejectTargets.slice(0, 5).map((task) => (
              <li key={task.id} className="truncate">
                · {task.video.title}
              </li>
            ))}
            {rejectTargets.length > 5 && <li>· 其余 {rejectTargets.length - 5} 个视频</li>}
          </ul>

          <div className="flex flex-wrap gap-1.5">
            {REJECT_TEMPLATES.map((template) => (
              <Tag key={template} label={template} size="sm" onClick={() => setNote(template)} />
            ))}
          </div>

          <Textarea
            value={note}
            rows={3}
            maxLength={200}
            invalid={noteInvalid}
            placeholder="填写审核意见（必填），将原文展示给作者"
            aria-label="审核意见"
            onChange={(event) => {
              setNote(event.target.value);
              if (event.target.value.trim()) setNoteInvalid(false);
            }}
            footer={
              <>
                <span className={cn('text-[11px]', noteInvalid ? 'text-brand' : 'text-fg-subtle')}>
                  {noteInvalid ? '审核意见不能为空' : '审核意见会随通知发送给作者'}
                </span>
                <span className="text-[11px] tabular-nums text-fg-subtle">{note.length}/200</span>
              </>
            }
          />
        </div>
      </Modal>
    </div>
  );
}
