/**
 * 用户管理：账号检索、状态处置（封禁 / 解封）与角色分配。
 * 权限点 admin:user_manage；角色变更额外要求 admin:role_assign。
 */
import { useEffect, useState } from 'react';
import { Ban, Eye, EyeOff, MoreHorizontal, ShieldCheck, UserCog, UserRound } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  ListSkeleton,
  Modal,
  Pagination,
  SurfaceCard,
  Tabs,
  Textarea,
  type DropdownItem,
} from '@/components/ui';
import { useAdminUsers, useAssignRole, useUpdateUserStatus } from '@/hooks/useApi';
import { cn } from '@/lib/cn';
import { formatDate, formatRelative, maskPhone } from '@/lib/format';
import type { AdminUserRow, Role, UserStatus } from '@/api/types';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';

type RoleFilter = 'ALL' | Role;
type StatusFilter = 'ALL' | UserStatus;

const ROLE_LABELS: Record<Role, string> = {
  USER: '普通用户',
  MODERATOR: '审核员',
  ADMIN: '管理员',
};

const ROLE_TONES: Record<Role, 'neutral' | 'accent' | 'brand'> = {
  USER: 'neutral',
  MODERATOR: 'accent',
  ADMIN: 'brand',
};

const STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: '正常',
  BANNED: '已封禁',
  DEACTIVATED: '已注销',
  DELETED: '已删除',
};

const STATUS_TONES: Record<UserStatus, 'success' | 'brand' | 'neutral'> = {
  ACTIVE: 'success',
  BANNED: 'brand',
  DEACTIVATED: 'neutral',
  DELETED: 'neutral',
};

const ROLE_FILTERS: { key: RoleFilter; label: string }[] = [
  { key: 'ALL', label: '全部角色' },
  { key: 'USER', label: '普通用户' },
  { key: 'MODERATOR', label: '审核员' },
  { key: 'ADMIN', label: '管理员' },
];

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'ALL', label: '全部状态' },
  { key: 'ACTIVE', label: '正常' },
  { key: 'BANNED', label: '已封禁' },
  { key: 'DEACTIVATED', label: '已注销' },
];

/** 角色变更的权限影响说明：危险操作必须写清后果 */
const ROLE_IMPACT: Record<Role, string> = {
  MODERATOR: '该账号将获得内容审核与举报处理权限，可查看并处置全站视频与举报，但无法管理用户或系统配置。',
  ADMIN: '该账号将获得全部后台权限，包括用户管理、角色分配与系统配置。请确认该账号可信后再继续。',
  USER: '该账号将失去全部后台权限，仅保留普通用户功能；已打开的后台页面会在下次权限校验时被拒绝。',
};

const TH_CLASS = 'sticky top-14 z-10 h-9 bg-surface px-3 text-xs font-medium text-fg-muted';
const PAGE_SIZE = 10;

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const name = email.slice(0, at);
  const domain = email.slice(at);
  const head = name.slice(0, Math.min(2, name.length));
  return `${head}${'*'.repeat(Math.max(1, name.length - head.length))}${domain}`;
}

export default function AdminUserPage() {
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const canRoleAssign = useAuthStore((s) => s.hasPermission('admin:role_assign'));
  const openConfirm = useUiStore((s) => s.openConfirm);

  const [term, setTerm] = useState('');
  const [keyword, setKeyword] = useState('');
  const [role, setRole] = useState<RoleFilter>('ALL');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [page, setPage] = useState(1);
  const [showEmail, setShowEmail] = useState(false);
  const [statusTarget, setStatusTarget] = useState<{ user: AdminUserRow; next: UserStatus } | null>(null);
  const [reason, setReason] = useState('');
  const [reasonInvalid, setReasonInvalid] = useState(false);

  const query = useAdminUsers({ page, pageSize: PAGE_SIZE, keyword: keyword || undefined, role, status });
  const updateStatus = useUpdateUserStatus();
  const assignRole = useAssignRole();

  /** 关键词防抖 300ms，避免逐字请求 */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setKeyword(term.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [term]);

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  const openStatusModal = (user: AdminUserRow, next: UserStatus) => {
    setStatusTarget({ user, next });
    setReason('');
    setReasonInvalid(false);
  };

  const confirmStatus = () => {
    if (!statusTarget) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setReasonInvalid(true);
      return;
    }
    const { user, next } = statusTarget;
    setStatusTarget(null);
    openConfirm({
      title: next === 'BANNED' ? `封禁「${user.nickname}」` : `解封「${user.nickname}」`,
      description:
        next === 'BANNED'
          ? `封禁后该账号无法登录、上传、评论与私信，已发布内容仍可被浏览。处置原因：${trimmed}。操作会记入操作日志。`
          : `解封后该账号可重新登录并恢复全部互动功能。解封说明：${trimmed}。操作会记入操作日志。`,
      confirmText: next === 'BANNED' ? '确认封禁' : '确认解封',
      danger: next === 'BANNED',
      onConfirm: async () => {
        await updateStatus.mutateAsync({ userId: user.id, status: next, reason: trimmed });
      },
    });
  };

  const requestRole = (user: AdminUserRow, next: Role) => {
    openConfirm({
      title: `将「${user.nickname}」设为${ROLE_LABELS[next]}`,
      description: `${ROLE_IMPACT[next]}操作会记入操作日志。`,
      confirmText: '确认变更',
      danger: next === 'ADMIN',
      onConfirm: async () => {
        await assignRole.mutateAsync({ userId: user.id, role: next });
      },
    });
  };

  const buildMenu = (user: AdminUserRow): DropdownItem[] => {
    const isSelf = user.id === currentUserId;
    // DropdownItem 不支持 title，权限不足时把原因写进文案
    const suffix = isSelf ? '（不能操作当前登录账号）' : canRoleAssign ? '' : '（缺少角色分配权限）';
    return [
      {
        key: 'profile',
        label: '查看主页',
        icon: <UserRound className="size-4" />,
        onSelect: () => window.open(`/user/${user.id}`, '_blank', 'noopener'),
      },
      {
        key: 'status',
        label: user.status === 'BANNED' ? '解封账号' : '封禁账号',
        icon: <Ban className="size-4" />,
        danger: user.status !== 'BANNED',
        separatorBefore: true,
        disabled: isSelf,
        onSelect: () => openStatusModal(user, user.status === 'BANNED' ? 'ACTIVE' : 'BANNED'),
      },
      {
        key: 'moderator',
        label: `设为审核员${suffix}`,
        icon: <ShieldCheck className="size-4" />,
        separatorBefore: true,
        disabled: !canRoleAssign || isSelf || user.role === 'MODERATOR',
        onSelect: () => requestRole(user, 'MODERATOR'),
      },
      {
        key: 'admin',
        label: `设为管理员${suffix}`,
        icon: <UserCog className="size-4" />,
        disabled: !canRoleAssign || isSelf || user.role === 'ADMIN',
        onSelect: () => requestRole(user, 'ADMIN'),
      },
      {
        key: 'demote',
        label: `降级为普通用户${suffix}`,
        danger: user.role !== 'USER',
        disabled: !canRoleAssign || isSelf || user.role === 'USER',
        onSelect: () => requestRole(user, 'USER'),
      },
    ];
  };

  const masked = !showEmail;

  return (
    <div className="flex flex-col gap-4">
      <SurfaceCard className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            value={term}
            placeholder="搜索用户名、昵称或邮箱"
            aria-label="搜索用户名、昵称或邮箱"
            className="h-9 w-full sm:w-72"
            onChange={(event) => setTerm(event.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            icon={showEmail ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            onClick={() => setShowEmail((prev) => !prev)}
          >
            {showEmail ? '隐藏邮箱' : '显示完整邮箱'}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <Tabs
            items={ROLE_FILTERS}
            value={role}
            variant="segment"
            size="sm"
            onChange={(value) => {
              setRole(value);
              setPage(1);
            }}
          />
          <Tabs
            items={STATUS_FILTERS}
            value={status}
            variant="pill"
            size="sm"
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          />
          {!canRoleAssign && (
            <Badge tone="neutral" className="ml-auto">
              当前账号缺少 admin:role_assign，角色变更不可用
            </Badge>
          )}
        </div>
      </SurfaceCard>

      {query.isPending ? (
        <ListSkeleton rows={7} />
      ) : query.isError ? (
        <ErrorState title="用户列表加载失败" description="暂时无法获取用户数据，请稍后重试。" onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<UserRound className="size-7" />}
          title="没有符合条件的用户"
          description="换一个关键词，或将角色与状态筛选恢复为全部。"
        />
      ) : (
        <>
          <div className="hidden lg:block">
            <SurfaceCard padded={false}>
              <table className="w-full table-fixed border-collapse text-left">
                <thead>
                  <tr>
                    <th className={cn(TH_CLASS, 'w-[220px]')}>用户</th>
                    <th className={cn(TH_CLASS, 'w-[170px]')}>邮箱</th>
                    <th className={cn(TH_CLASS, 'hidden w-[92px] xl:table-cell')}>手机号</th>
                    <th className={cn(TH_CLASS, 'w-[80px]')}>角色</th>
                    <th className={cn(TH_CLASS, 'w-[72px]')}>状态</th>
                    <th className={cn(TH_CLASS, 'hidden w-[56px] xl:table-cell')}>认证</th>
                    <th className={cn(TH_CLASS, 'w-[56px]')}>作品</th>
                    <th className={cn(TH_CLASS, 'hidden w-[90px] xl:table-cell')}>注册时间</th>
                    <th className={cn(TH_CLASS, 'hidden w-[90px] xl:table-cell')}>最后登录</th>
                    <th className={cn(TH_CLASS, 'w-[56px]')}>
                      <span className="sr-only">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((user) => (
                    <tr key={user.id} className="h-12 border-b border-line text-[13px] transition-colors last:border-0 hover:bg-surface-2">
                      <td className="px-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar src={user.avatar} name={user.nickname} size="sm" certified={user.certified} />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-fg">{user.nickname}</p>
                            <p className="truncate text-[11px] text-fg-subtle">@{user.username}</p>
                          </div>
                        </div>
                      </td>
                      <td className="truncate px-3 text-xs text-fg-muted">
                        {masked ? maskEmail(user.email) : user.email}
                      </td>
                      <td className="hidden px-3 text-xs tabular-nums text-fg-muted xl:table-cell">
                        {user.phone ? maskPhone(user.phone) : '—'}
                      </td>
                      <td className="px-3">
                        <Badge tone={ROLE_TONES[user.role]}>{ROLE_LABELS[user.role]}</Badge>
                      </td>
                      <td className="px-3">
                        <Badge tone={STATUS_TONES[user.status]}>{STATUS_LABELS[user.status]}</Badge>
                      </td>
                      <td className="hidden px-3 text-xs text-fg-muted xl:table-cell">{user.certified ? '已认证' : '未认证'}</td>
                      <td className="px-3 text-xs tabular-nums text-fg-muted">{user.videoCount}</td>
                      <td className="hidden px-3 text-xs text-fg-muted xl:table-cell">{formatDate(user.createdAt)}</td>
                      <td className="hidden px-3 text-xs text-fg-muted xl:table-cell">
                        {user.lastLoginAt ? formatRelative(user.lastLoginAt) : '从未登录'}
                      </td>
                      <td className="px-3">
                        <Dropdown
                          align="end"
                          trigger={({ toggle }) => (
                            <IconButton
                              label={`${user.nickname} 的操作`}
                              size="icon-sm"
                              title={
                                canRoleAssign
                                  ? `${user.nickname} 的操作`
                                  : `${user.nickname} 的操作（角色变更需要 admin:role_assign 权限）`
                              }
                              onClick={toggle}
                            >
                              <MoreHorizontal className="size-4" />
                            </IconButton>
                          )}
                          items={buildMenu(user)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SurfaceCard>
          </div>

          <div className="flex flex-col gap-3 lg:hidden">
            {items.map((user) => (
              <SurfaceCard key={user.id} className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <Avatar src={user.avatar} name={user.nickname} size="md" certified={user.certified} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{user.nickname}</p>
                    <p className="truncate text-[11px] text-fg-subtle">@{user.username}</p>
                    <p className="mt-0.5 truncate text-[11px] text-fg-muted">{masked ? maskEmail(user.email) : user.email}</p>
                  </div>
                  <Dropdown
                    align="end"
                    trigger={({ toggle }) => (
                      <IconButton label={`${user.nickname} 的操作`} size="icon-sm" onClick={toggle}>
                        <MoreHorizontal className="size-4" />
                      </IconButton>
                    )}
                    items={buildMenu(user)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
                  <Badge tone={ROLE_TONES[user.role]}>{ROLE_LABELS[user.role]}</Badge>
                  <Badge tone={STATUS_TONES[user.status]}>{STATUS_LABELS[user.status]}</Badge>
                  <span>作品 {user.videoCount}</span>
                  <span>{user.phone ? maskPhone(user.phone) : '未绑定手机号'}</span>
                  <span>注册于 {formatDate(user.createdAt)}</span>
                </div>
              </SurfaceCard>
            ))}
          </div>

          <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}

      <Modal
        open={statusTarget !== null}
        onClose={() => setStatusTarget(null)}
        title={statusTarget?.next === 'BANNED' ? '封禁账号' : '解封账号'}
        description={
          statusTarget?.next === 'BANNED'
            ? `将封禁「${statusTarget?.user.nickname}」，该账号无法登录、上传与互动。`
            : `将解封「${statusTarget?.user.nickname}」，该账号可重新登录。`
        }
        size="sm"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setStatusTarget(null)}>
              取消
            </Button>
            <Button variant={statusTarget?.next === 'BANNED' ? 'danger' : 'primary'} onClick={confirmStatus}>
              下一步
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 rounded-btn border border-line bg-surface-2 px-3 py-2.5">
            <Avatar src={statusTarget?.user.avatar} name={statusTarget?.user.nickname ?? ''} size="sm" />
            <div className="min-w-0 text-xs">
              <p className="truncate font-medium text-fg">{statusTarget?.user.nickname}</p>
              <p className="truncate text-fg-subtle">
                @{statusTarget?.user.username} · 注册于 {statusTarget ? formatDate(statusTarget.user.createdAt) : ''}
              </p>
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs text-fg-muted">
              {statusTarget?.next === 'BANNED' ? '封禁原因（必填）' : '解封说明（必填）'}
            </p>
            <Textarea
              value={reason}
              rows={3}
              maxLength={200}
              invalid={reasonInvalid}
              placeholder={statusTarget?.next === 'BANNED' ? '例如：多次上传违规内容' : '例如：申诉通过，误判已核实'}
              aria-label="处置原因"
              onChange={(event) => {
                setReason(event.target.value);
                if (event.target.value.trim()) setReasonInvalid(false);
              }}
              footer={
                <>
                  <span className={cn('text-[11px]', reasonInvalid ? 'text-brand' : 'text-fg-subtle')}>
                    {reasonInvalid ? '请填写原因，将同步给用户并记入日志' : '原因会记入操作日志'}
                  </span>
                  <span className="text-[11px] tabular-nums text-fg-subtle">{reason.length}/200</span>
                </>
              }
            />
          </div>
          <p className="text-[11px] leading-relaxed text-fg-subtle">
            点击「下一步」后仍需二次确认。封禁属于影响账号使用的高风险操作，请确认事实清楚、依据充分。
          </p>
        </div>
      </Modal>
    </div>
  );
}
