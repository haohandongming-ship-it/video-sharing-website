/**
 * 管理后台外壳：左侧固定侧栏 + 顶部条，内容由子路由通过 <Outlet /> 渲染。
 * 菜单与数据请求均按权限点收敛，无 admin:analytics 时回落到首个有权限的菜单项（文档 2.3）。
 */
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useIsFetching } from '@tanstack/react-query';
import {
  ChevronRight,
  ExternalLink,
  Flag,
  IdCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Users,
  Video,
} from 'lucide-react';
import { Avatar, Badge, Drawer, Dropdown, EmptyState, IconButton } from '@/components/ui';
import { useAdminOverview } from '@/hooks/useApi';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import type { Permission, Role } from '@/api/types';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';

type IconType = ComponentType<{ className?: string }>;

interface AdminNavItem {
  to: string;
  label: string;
  permission: Permission;
  icon: IconType;
  /** 徽标数据来源：待审核视频 / 待处理举报 */
  badge?: 'reviewing' | 'reports';
}

const ADMIN_NAV: AdminNavItem[] = [
  { to: '/admin/dashboard', label: '数据概览', permission: 'admin:analytics', icon: LayoutDashboard },
  { to: '/admin/reviews', label: '内容审核', permission: 'moderation:review', icon: ShieldCheck, badge: 'reviewing' },
  { to: '/admin/reports', label: '举报处理', permission: 'moderation:report', icon: Flag, badge: 'reports' },
  { to: '/admin/videos', label: '视频管理', permission: 'moderation:review', icon: Video },
  { to: '/admin/real-names', label: '实名审核', permission: 'moderation:realname', icon: IdCard },
  { to: '/admin/users', label: '用户管理', permission: 'admin:user_manage', icon: Users },
  { to: '/admin/audit', label: '操作日志', permission: 'admin:analytics', icon: ScrollText },
  { to: '/admin/settings', label: '系统设置', permission: 'admin:system_config', icon: Settings },
];

const ROLE_LABELS: Record<Role, string> = {
  USER: '普通用户',
  MODERATOR: '审核员',
  ADMIN: '管理员',
};

interface NavCounts {
  reviewing: number;
  reports: number;
}

function SidebarBody({
  items,
  counts,
  onNavigate,
}: {
  items: AdminNavItem[];
  counts: NavCounts;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <span className="grid size-6 place-items-center rounded-[6px] bg-brand text-[11px] font-semibold text-white">
          光
        </span>
        <span className="text-sm font-semibold text-fg">管理后台</span>
      </div>
      <nav aria-label="管理后台导航" className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2.5">
        {items.map((item) => {
          const Icon = item.icon;
          const count = item.badge === 'reviewing' ? counts.reviewing : item.badge === 'reports' ? counts.reports : 0;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex h-10 items-center gap-2.5 rounded-btn px-3 text-[13px] font-medium transition-colors duration-150',
                  isActive ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                )
              }
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {count > 0 && <Badge tone="brand">{count > 99 ? '99+' : count}</Badge>}
            </NavLink>
          );
        })}
      </nav>
    </>
  );
}

export default function AdminShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const theme = useUiStore((s) => s.theme);
  const resolvedTheme = useUiStore((s) => s.resolvedTheme);
  const setTheme = useUiStore((s) => s.setTheme);
  const openConfirm = useUiStore((s) => s.openConfirm);

  /** 无 admin:analytics 时该查询自动禁用，不产生请求 */
  const overview = useAdminOverview();
  const syncing = useIsFetching() > 0;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const items = useMemo(() => ADMIN_NAV.filter((item) => hasPermission(item.permission)), [hasPermission]);

  const counts: NavCounts = {
    reviewing: overview.data?.videos.reviewing ?? 0,
    reports: overview.data?.interaction.reportsPending ?? 0,
  };

  const active = items.find((item) => location.pathname.startsWith(item.to));
  const title = active?.label ?? '管理后台';

  // 缺少数据概览权限时，首个有权限的菜单项作为默认展示
  const fallback = items[0];
  const atAdminRoot = location.pathname === '/admin' || location.pathname === '/admin/';
  const atDashboard = location.pathname.startsWith('/admin/dashboard');
  if (!hasPermission('admin:analytics') && fallback && (atAdminRoot || atDashboard)) {
    return <Navigate to={fallback.to} replace />;
  }

  const handleLogout = () => {
    openConfirm({
      title: '退出登录',
      description: '退出后需要重新验证身份才能回到管理后台，未提交的处置操作将会丢失。',
      confirmText: '退出登录',
      danger: true,
      onConfirm: async () => {
        await logout();
        navigate('/', { replace: true });
      },
    });
  };

  const themeLabel = theme === 'system' ? '跟随系统' : resolvedTheme === 'dark' ? '暗色' : '亮色';

  if (items.length === 0) {
    return (
      <div className="min-h-dvh bg-canvas p-6">
        <EmptyState
          icon={<ShieldAlert className="size-7" />}
          title="当前账号没有后台权限"
          description="管理后台仅对具备审核或管理权限的账号开放。如认为这是误判，请联系平台管理员。"
          action={
            <button type="button" onClick={() => navigate('/')} className="text-sm font-medium text-accent hover:underline">
              返回主站
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        <SidebarBody items={items} counts={counts} />
        <div className="shrink-0 border-t border-line p-3">
          <div className="flex items-center gap-2.5">
            <Avatar src={user?.avatar} name={user?.nickname ?? '未登录'} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-fg">{user?.nickname ?? '未登录'}</p>
              <p className="truncate text-[11px] text-fg-subtle">{ROLE_LABELS[user?.role ?? 'USER']}</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface px-3 sm:px-4 lg:px-6">
          <IconButton label="打开菜单" className="lg:hidden" onClick={() => setDrawerOpen(true)}>
            <Menu className="size-5" />
          </IconButton>

          <div className="flex min-w-0 items-center gap-2">
            <span className="hidden text-xs text-fg-subtle sm:inline">管理后台</span>
            <ChevronRight className="hidden size-3.5 shrink-0 text-fg-subtle sm:inline" aria-hidden />
            <h1 className="truncate text-sm font-semibold text-fg">{title}</h1>
          </div>

          <span className="ml-auto hidden items-center gap-1.5 rounded-pill bg-surface-2 px-2.5 py-1 text-[11px] text-fg-muted md:inline-flex">
            <span
              aria-hidden
              className={cn('size-1.5 rounded-full', syncing ? 'animate-pulse-dot bg-warning' : 'bg-success')}
            />
            {syncing ? '数据同步中' : '运行正常'}
            <span className="tabular-nums text-fg-subtle">{formatDate(now, 'HH:mm')}</span>
          </span>

          <div className="ml-auto flex items-center gap-1 md:ml-0">
            <a
              href="/"
              className="inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-[13px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <ExternalLink className="size-4" aria-hidden />
              <span className="hidden sm:inline">返回主站</span>
            </a>

            <Dropdown
              align="end"
              trigger={({ toggle }) => (
                <IconButton label={`主题：${themeLabel}`} onClick={toggle}>
                  {resolvedTheme === 'dark' ? <Moon className="size-5" /> : <Sun className="size-5" />}
                </IconButton>
              )}
              items={[
                { key: 'light', label: '亮色', onSelect: () => setTheme('light') },
                { key: 'dark', label: '暗色', onSelect: () => setTheme('dark') },
                { key: 'system', label: '跟随系统', onSelect: () => setTheme('system') },
              ]}
            />

            <span className="ml-1 hidden items-center gap-2 sm:flex">
              <Avatar src={user?.avatar} name={user?.nickname ?? '未登录'} size="xs" />
              <span className="max-w-24 truncate text-[13px] text-fg-muted">{user?.nickname ?? '未登录'}</span>
            </span>

            <IconButton label="退出登录" onClick={handleLogout}>
              <LogOut className="size-4" />
            </IconButton>
          </div>
        </header>

        <main className="p-4 lg:p-6">
          <Outlet />
        </main>
      </div>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="管理后台"
        side="left"
        className="flex w-60 max-w-60 flex-col"
      >
        <SidebarBody items={items} counts={counts} onNavigate={() => setDrawerOpen(false)} />
      </Drawer>
    </div>
  );
}
