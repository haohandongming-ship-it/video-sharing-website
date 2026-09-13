/**
 * 操作日志：后台处置行为的审计追溯。
 * 权限点 admin:analytics；日志含操作 IP，按合规要求留存 6 个月。
 */
import { useMemo, useState } from 'react';
import { ScrollText } from 'lucide-react';
import {
  Avatar,
  Badge,
  EmptyState,
  ErrorState,
  Input,
  ListSkeleton,
  Pagination,
  SurfaceCard,
} from '@/components/ui';
import { useAuditLogs } from '@/hooks/useApi';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import type { AuditLogRow } from '@/api/types';

type ActionFilter = 'ALL' | keyof typeof ACTION_META;

const ACTION_META = {
  APPROVE_VIDEO: { label: '通过审核', tone: 'success' },
  REJECT_VIDEO: { label: '驳回视频', tone: 'brand' },
  BAN_USER: { label: '封禁用户', tone: 'brand' },
  UNBAN_USER: { label: '解封用户', tone: 'accent' },
  ASSIGN_ROLE: { label: '角色分配', tone: 'warning' },
  RESOLVE_REPORT: { label: '处理举报', tone: 'success' },
  UPDATE_SETTINGS: { label: '更新配置', tone: 'accent' },
  DELETE_COMMENT: { label: '删除评论', tone: 'neutral' },
} as const satisfies Record<string, { label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' | 'brand' }>;

const ACTION_KEYS = Object.keys(ACTION_META) as (keyof typeof ACTION_META)[];

const TARGET_LABELS: Record<string, string> = {
  VIDEO: '视频',
  USER: '用户',
  REPORT: '举报',
  SETTING: '配置',
  COMMENT: '评论',
  FEED: '动态',
};

const DETAIL_LABELS: Record<string, string> = {
  note: '备注',
  ip: 'IP',
  reason: '原因',
  role: '角色',
  status: '状态',
  title: '标题',
  targetTitle: '目标标题',
  count: '数量',
};

const TH_CLASS = 'sticky top-14 z-10 h-9 bg-surface px-3 text-xs font-medium text-fg-muted';
const PAGE_SIZE = 15;

type ActionMeta = { label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' | 'brand' };

const ACTION_LOOKUP: Record<string, ActionMeta> = ACTION_META;

function actionMeta(action: string): ActionMeta {
  return ACTION_LOOKUP[action] ?? { label: action, tone: 'neutral' };
}

function DetailList({ detail }: { detail: AuditLogRow['detail'] }) {
  const entries = Object.entries(detail);
  if (entries.length === 0) return <span className="text-xs text-fg-subtle">—</span>;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-relaxed">
      {entries.map(([key, value]) => (
        <li key={key} className="min-w-0">
          <span className="text-fg-subtle">{DETAIL_LABELS[key] ?? key}：</span>
          <span className="break-all text-fg-muted">{String(value)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function AdminAuditPage() {
  const [action, setAction] = useState<ActionFilter>('ALL');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);

  const query = useAuditLogs({ page, pageSize: PAGE_SIZE, status: action === 'ALL' ? undefined : action, keyword: keyword || undefined });

  const items = query.data?.items;
  const visible = useMemo(() => {
    const list = items ?? [];
    const term = keyword.trim().toLowerCase();
    return list.filter((log) => {
      if (action !== 'ALL' && log.action !== action) return false;
      if (!term) return true;
      const meta = actionMeta(log.action);
      const haystack = [
        log.action,
        meta.label,
        log.operator.nickname,
        log.operator.username,
        log.targetType,
        TARGET_LABELS[log.targetType] ?? '',
        String(log.targetId),
        ...Object.values(log.detail).map((value) => String(value)),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [items, action, keyword]);

  const hasIp = visible.some((log) => Object.prototype.hasOwnProperty.call(log.detail, 'ip'));

  return (
    <div className="flex flex-col gap-4">
      <SurfaceCard className="flex flex-wrap items-center gap-2">
        <select
          value={action}
          aria-label="操作类型"
          className="h-9 rounded-btn border border-line bg-surface px-3 text-[13px] text-fg outline-none transition-colors focus:border-accent"
          onChange={(event) => {
            setAction(event.target.value as ActionFilter);
            setPage(1);
          }}
        >
          <option value="ALL">全部操作类型</option>
          {ACTION_KEYS.map((key) => (
            <option key={key} value={key}>
              {ACTION_META[key].label}
            </option>
          ))}
        </select>
        <Input
          type="search"
          value={keyword}
          placeholder="搜索操作人、目标或详情"
          aria-label="搜索操作人、目标或详情"
          className="h-9 w-full sm:w-72"
          onChange={(event) => setKeyword(event.target.value)}
        />
        <span className="text-[11px] text-fg-subtle">
          筛选在已加载结果内生效，切换页码会重新拉取该页日志
        </span>
      </SurfaceCard>

      {query.isPending ? (
        <ListSkeleton rows={8} />
      ) : query.isError ? (
        <ErrorState title="操作日志加载失败" description="暂时无法获取审计日志，请稍后重试。" onRetry={() => void query.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="size-7" />}
          title="没有符合条件的操作日志"
          description="调整操作类型或关键词后重试。日志仅保留 6 个月，超期记录不可查询。"
        />
      ) : (
        <>
          <div className="hidden lg:block">
            <SurfaceCard padded={false}>
              <table className="w-full table-fixed border-collapse text-left">
                <thead>
                  <tr>
                    <th className={cn(TH_CLASS, 'w-[130px]')}>时间</th>
                    <th className={cn(TH_CLASS, 'w-[150px]')}>操作人</th>
                    <th className={cn(TH_CLASS, 'w-[110px]')}>操作类型</th>
                    <th className={cn(TH_CLASS, 'w-[140px]')}>目标</th>
                    <th className={TH_CLASS}>详情</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((log) => {
                    const meta = actionMeta(log.action);
                    return (
                      <tr key={log.id} className="border-b border-line align-top transition-colors last:border-0 hover:bg-surface-2">
                        <td className="px-3 py-3 text-xs tabular-nums text-fg-muted">{formatDateTime(log.createdAt)}</td>
                        <td className="px-3 py-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <Avatar src={log.operator.avatar} name={log.operator.nickname} size="xs" />
                            <div className="min-w-0">
                              <p className="truncate text-[13px] text-fg">{log.operator.nickname}</p>
                              <p className="truncate text-[11px] text-fg-subtle">@{log.operator.username}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </td>
                        <td className="px-3 py-3 text-xs text-fg-muted">
                          <span className="block">{TARGET_LABELS[log.targetType] ?? log.targetType}</span>
                          <span className="block tabular-nums text-fg-subtle">#{log.targetId}</span>
                        </td>
                        <td className="px-3 py-3">
                          <DetailList detail={log.detail} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </SurfaceCard>
          </div>

          <ol className="flex flex-col gap-3 lg:hidden">
            {visible.map((log) => {
              const meta = actionMeta(log.action);
              return (
                <li key={log.id}>
                  <SurfaceCard className="flex flex-col gap-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] tabular-nums text-fg-subtle">{formatDateTime(log.createdAt)}</span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Avatar src={log.operator.avatar} name={log.operator.nickname} size="xs" />
                      <span className="text-[13px] text-fg">{log.operator.nickname}</span>
                      <span className="text-[11px] text-fg-subtle">
                        {TARGET_LABELS[log.targetType] ?? log.targetType} #{log.targetId}
                      </span>
                    </div>
                    <DetailList detail={log.detail} />
                  </SurfaceCard>
                </li>
              );
            })}
          </ol>

          <Pagination page={page} total={query.data?.total ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}

      <p className="text-[11px] leading-relaxed text-fg-subtle">
        合规提示：操作日志包含操作人、操作 IP 与变更详情，按《网络安全法》要求留存 6 个月，仅授权管理员可查询，
        导出与调阅同样会记入日志。
        {hasIp && ' 当前列表中的 IP 信息仅供内部审计使用。'}
      </p>
    </div>
  );
}
