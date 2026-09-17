/**
 * 实名认证审核：待审队列 + 通过/驳回。
 * 权限点 moderation:realname（由路由守卫与 hook 双重收敛）。
 *
 * 背景：用户可以提交实名申请（auth_status 变为 PENDING），但此前没有任何审核入口，
 * 申请会永久停在待审状态；且证件号只存了不可逆的哈希，审核员无从核对。
 * 后端 V10 迁移补上了证件号密文，本页据此提供审核能力。
 */
import { useState } from 'react';
import { BadgeCheck, IdCard, ShieldCheck } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  ListSkeleton,
  Modal,
  Pagination,
  SurfaceCard,
  Tabs,
  Textarea,
} from '@/components/ui';
import { useDecideRealName, useRealNameTasks } from '@/hooks/useApi';
import { formatRelative } from '@/lib/format';
import type { RealNameTask } from '@/api/types';

type StatusFilter = 'PENDING' | 'CERTIFIED' | 'REJECTED';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'PENDING', label: '待审核' },
  { key: 'CERTIFIED', label: '已通过' },
  { key: 'REJECTED', label: '已驳回' },
];

const PAGE_SIZE = 10;

/** 快速填充的驳回原因，减少审核员手打 */
const REJECT_TEMPLATES = ['证件信息与填写不一致', '证件照片不清晰', '姓名与证件号不匹配', '涉嫌冒用他人身份'];

export default function AdminRealNamePage() {
  const [status, setStatus] = useState<StatusFilter>('PENDING');
  const [page, setPage] = useState(1);
  const [rejectTarget, setRejectTarget] = useState<RealNameTask | null>(null);
  const [note, setNote] = useState('');
  const [noteInvalid, setNoteInvalid] = useState(false);

  const query = useRealNameTasks({ status, page, pageSize: PAGE_SIZE });
  const decide = useDecideRealName();

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const approve = (task: RealNameTask) => {
    void decide.mutateAsync({ userId: task.userId, decision: 'APPROVE' }).catch(() => undefined);
  };

  const confirmReject = async () => {
    const trimmed = note.trim();
    if (!trimmed) {
      setNoteInvalid(true);
      return;
    }
    const target = rejectTarget;
    setRejectTarget(null);
    if (!target) return;
    await decide
      .mutateAsync({ userId: target.userId, decision: 'REJECT', note: trimmed })
      .catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-4">
      <SurfaceCard className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-fg-subtle" aria-hidden />
            <h1 className="text-base font-semibold text-fg">实名认证审核</h1>
            <Badge tone="neutral">共 {total}</Badge>
          </div>
          <Tabs
            items={STATUS_TABS}
            value={status}
            variant="segment"
            size="sm"
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          />
        </div>
        <p className="text-xs text-fg-muted">
          证件号在库中以 AES-256-GCM 加密保存，此处仅展示掩码（前 6 后 4），避免审核界面泄露完整证件号。
        </p>
      </SurfaceCard>

      {query.isLoading ? (
        <ListSkeleton rows={4} />
      ) : query.isError ? (
        <ErrorState
          title="实名申请加载失败"
          description="网络似乎不太稳定，请稍后重试。"
          onRetry={() => void query.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<IdCard className="size-7" />}
          title={status === 'PENDING' ? '没有待审核的实名申请' : '暂无记录'}
          description={status === 'PENDING' ? '用户提交实名认证后，申请会出现在这里。' : '切换上方标签查看其他状态。'}
        />
      ) : (
        <SurfaceCard padded={false} className="overflow-hidden">
          <ul className="divide-y divide-line">
            {items.map((task) => (
              <li key={task.userId} className="flex flex-wrap items-center gap-4 p-4">
                <Avatar src={task.avatar} name={task.nickname} size="md" certified={task.status === 'CERTIFIED'} />

                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-fg">
                    {task.nickname}
                    <span className="text-xs font-normal text-fg-subtle">@{task.username}</span>
                    {task.status === 'CERTIFIED' && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-accent">
                        <BadgeCheck className="size-3.5" aria-hidden />
                        已认证
                      </span>
                    )}
                    {task.status === 'REJECTED' && <Badge tone="danger">已驳回</Badge>}
                  </p>
                  <dl className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-xs text-fg-muted">
                    <div className="flex gap-1.5">
                      <dt>真实姓名</dt>
                      <dd className="font-medium text-fg">{task.realName ?? '—'}</dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>证件号</dt>
                      <dd className="font-mono tabular-nums">{task.idCardMasked ?? '—'}</dd>
                    </div>
                    {task.phone && (
                      <div className="flex gap-1.5">
                        <dt>手机号</dt>
                        <dd className="tabular-nums">{task.phone}</dd>
                      </div>
                    )}
                    <div className="flex gap-1.5">
                      <dt>{task.status === 'PENDING' ? '提交于' : '处理于'}</dt>
                      <dd>{formatRelative(task.certifiedAt ?? task.submittedAt ?? new Date().toISOString())}</dd>
                    </div>
                  </dl>
                </div>

                {task.status === 'PENDING' && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={decide.isPending}
                      onClick={() => approve(task)}
                    >
                      通过
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={decide.isPending}
                      onClick={() => {
                        setRejectTarget(task);
                        setNote('');
                        setNoteInvalid(false);
                      }}
                    >
                      驳回
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </SurfaceCard>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
        </div>
      )}

      <Modal
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        title="驳回实名认证"
        description={rejectTarget ? `将驳回 ${rejectTarget.nickname} 的实名认证申请，原因会通知该用户。` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejectTarget(null)}>
              取消
            </Button>
            <Button variant="primary" disabled={decide.isPending} onClick={() => void confirmReject()}>
              确认驳回
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {REJECT_TEMPLATES.map((template) => (
              <button
                key={template}
                type="button"
                onClick={() => {
                  setNote(template);
                  setNoteInvalid(false);
                }}
                className="rounded-pill border border-line px-2.5 py-1 text-[11px] text-fg-muted transition-colors hover:border-accent hover:text-accent"
              >
                {template}
              </button>
            ))}
          </div>
          <Textarea
            value={note}
            rows={3}
            maxLength={200}
            placeholder="请填写驳回原因（必填，会通知申请人）"
            aria-label="驳回原因"
            invalid={noteInvalid}
            onChange={(event) => {
              setNote(event.target.value);
              setNoteInvalid(false);
            }}
          />
          {noteInvalid && <p className="text-xs text-danger">请填写驳回原因</p>}
        </div>
      </Modal>
    </div>
  );
}
