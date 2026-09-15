import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Clapperboard,
  Compass,
  Flame,
  History,
  LogIn,
  Menu,
  Moon,
  Search,
  Settings,
  Sun,
  Upload,
  UserRound,
  Video,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { APP_NAME } from '@/lib/constants';
import { formatCount } from '@/lib/format';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useUiStore } from '@/stores/uiStore';
import { Avatar, Badge, Button, Dropdown, IconButton, SearchInput } from '@/components/ui';
import { NotificationPanel } from '@/components/layout/NotificationPanel';
import { HOT_LINKS, PRIMARY_NAV, SECONDARY_NAV } from '@/components/layout/navItems';
import { USE_MOCK } from '@/api/config';

export function TopNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [suggestOpen, setSuggestOpen] = useState(false);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);

  const { status, user, logout } = useAuthStore();
  const unread = useNotificationStore((s) => s.unreadCount);
  const { theme, resolvedTheme, setTheme, toggleSidebar, setMobileDrawer } = useUiStore();
  const openConfirm = useUiStore((s) => s.openConfirm);
  const isLogin = status === 'authenticated';

  const onSearchSubmit = (event?: React.FormEvent) => {
    event?.preventDefault();
    const q = keyword.trim();
    if (!q) return;
    setSuggestOpen(false);
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  // 路由变化时收起浮层：用「渲染期同步前值」替代 effect，避免级联渲染
  const [prevRoute, setPrevRoute] = useState(`${location.pathname}${location.search}`);
  const route = `${location.pathname}${location.search}`;
  if (route !== prevRoute) {
    setPrevRoute(route);
    if (suggestOpen) setSuggestOpen(false);
    if (noticeOpen) setNoticeOpen(false);
  }

  useEffect(() => {
    if (!suggestOpen) return;
    const handler = (event: MouseEvent) => {
      if (!inputWrapRef.current?.contains(event.target as Node)) setSuggestOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [suggestOpen]);

  return (
    <header className="sticky top-0 z-60 border-b border-line bg-canvas/92 backdrop-blur-md">
      <div className="flex h-14 items-center gap-2 px-3 sm:gap-4 sm:px-4">
        {/* 移动端抽屉入口 / 桌面端侧栏折叠 */}
        <IconButton
          label="打开导航"
          className="lg:hidden"
          onClick={() => setMobileDrawer(true)}
        >
          <Menu className="size-5" />
        </IconButton>
        <IconButton label="收起侧边栏" className="hidden lg:inline-flex" onClick={toggleSidebar}>
          <Menu className="size-5" />
        </IconButton>

        <Link to="/" className="flex shrink-0 items-center gap-2" aria-label={`${APP_NAME} 首页`}>
          <span className="grid size-7 place-items-center rounded-[7px] bg-brand text-white">
            <Video className="size-4" aria-hidden />
          </span>
          <span className="hidden text-[17px] font-semibold tracking-[-0.02em] text-fg sm:block">{APP_NAME}</span>
        </Link>

        {/* 搜索栏：桌面端居中，移动端隐藏（由搜索页承载） */}
        <div ref={inputWrapRef} className="relative mx-auto hidden w-full max-w-[560px] md:block">
          <form onSubmit={onSearchSubmit} role="search" className="flex items-center gap-2">
            <SearchInput
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                setSuggestOpen(true);
              }}
              onFocus={() => setSuggestOpen(true)}
              onClear={() => setKeyword('')}
              placeholder="搜索视频、创作者、动态"
              aria-label="搜索"
              name="q"
            />
            <Button type="submit" variant="secondary" aria-label="提交搜索">搜索</Button>
          </form>
          {suggestOpen && (
            <div className="absolute inset-x-0 top-[calc(100%+6px)] z-70 overflow-hidden rounded-card border border-line bg-surface py-2 shadow-pop">
              {keyword.trim() ? (
                <button
                  type="button"
                  onClick={() => onSearchSubmit()}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-2"
                >
                  <Search className="size-3.5 text-fg-subtle" aria-hidden />
                  搜索「<span className="font-medium text-fg">{keyword.trim()}</span>」
                </button>
              ) : (
                <>
                  <p className="px-3 pt-1 pb-2 text-[11px] text-fg-subtle">热门搜索</p>
                  {HOT_LINKS.map((link) => (
                    <Link
                      key={link.to}
                      to={link.to}
                      className="flex items-center gap-2 px-3 py-2 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg"
                    >
                      <Flame className="size-3.5 text-brand" aria-hidden />
                      {link.label}
                    </Link>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
          <IconButton label="搜索" className="md:hidden" onClick={() => navigate('/search')}>
            <Search className="size-5" />
          </IconButton>

          {isLogin ? (
            <>
              <Link to="/upload" className="hidden sm:block">
                <Button size="sm" variant="secondary" icon={<Upload className="size-4" />}>
                  上传
                </Button>
              </Link>
              <Link to="/upload" className="sm:hidden">
                <IconButton label="上传视频">
                  <Upload className="size-5" />
                </IconButton>
              </Link>

              {/* 通知：未读红点 + 实时状态 */}
              <div className="relative">
                <IconButton label="通知" onClick={() => setNoticeOpen((v) => !v)} aria-expanded={noticeOpen}>
                  <Bell className="size-5" />
                  {unread > 0 && (
                    <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] leading-4 font-semibold text-white">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </IconButton>
                <NotificationPanel open={noticeOpen} onClose={() => setNoticeOpen(false)} />
              </div>

              <Dropdown
                align="end"
                items={[
                  { key: 'profile', label: '个人主页', icon: <UserRound className="size-4" />, onSelect: () => navigate(`/user/${user?.id ?? ''}`) },
                  { key: 'creator', label: '创作者中心', icon: <Clapperboard className="size-4" />, onSelect: () => navigate('/creator') },
                  { key: 'favorites', label: '我的收藏', icon: <Compass className="size-4" />, onSelect: () => navigate('/favorites') },
                  { key: 'history', label: '观看历史', icon: <History className="size-4" />, onSelect: () => navigate('/history') },
                  { key: 'settings', label: '设置', icon: <Settings className="size-4" />, onSelect: () => navigate('/settings'), separatorBefore: true },
                  ...(user?.permissions.some((p) => p.startsWith('moderation:') || p.startsWith('admin:'))
                    ? [
                        {
                          key: 'admin',
                          label: '管理后台',
                          icon: <Settings className="size-4" />,
                          onSelect: () => navigate('/admin'),
                        },
                      ]
                    : []),
                  {
                    key: 'logout',
                    label: '退出登录',
                    danger: true,
                    separatorBefore: true,
                    onSelect: () =>
                      openConfirm({
                        title: '确认退出登录？',
                        description: '退出后需要重新登录才能继续上传与互动。',
                        confirmText: '退出',
                        onConfirm: () => logout(),
                      }),
                  },
                ]}
                trigger={({ toggle }) => (
                  <button
                    type="button"
                    onClick={toggle}
                    aria-label="账号菜单"
                    className="ml-1 rounded-full transition-transform hover:scale-105"
                  >
                    <Avatar src={user?.avatar} name={user?.nickname ?? ''} size="sm" certified={user?.certified} />
                  </button>
                )}
              />
            </>
          ) : (
            <>
              <Link to="/login" className="hidden sm:block">
                <Button size="sm" variant="outline" icon={<LogIn className="size-4" />}>
                  登录
                </Button>
              </Link>
              <Link to="/login" className="sm:hidden">
                <IconButton label="登录">
                  <LogIn className="size-5" />
                </IconButton>
              </Link>
            </>
          )}

          {/* 主题切换：亮/暗/跟随系统 */}
          <Dropdown
            align="end"
            items={[
              { key: 'light', label: '亮色', onSelect: () => setTheme('light') },
              { key: 'dark', label: '暗色', onSelect: () => setTheme('dark') },
              { key: 'system', label: '跟随系统', onSelect: () => setTheme('system') },
            ]}
            trigger={({ toggle }) => (
              <IconButton
                label={`主题：${theme === 'system' ? '跟随系统' : resolvedTheme === 'dark' ? '暗色' : '亮色'}`}
                onClick={toggle}
              >
                {resolvedTheme === 'dark' ? <Moon className="size-5" /> : <Sun className="size-5" />}
              </IconButton>
            )}
          />
        </div>
      </div>

      {/* 移动端搜索入口 */}
      <div className="border-t border-line px-3 pb-2 md:hidden">
        <MobileSearchBar />
      </div>
    </header>
  );
}

function MobileSearchBar() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate('/search')}
      className="flex h-9 w-full items-center gap-2 rounded-pill border border-line bg-surface px-3 text-left text-[13px] text-fg-subtle"
    >
      <Search className="size-4" aria-hidden />
      搜索视频、创作者、动态
    </button>
  );
}

/* ------------------------------------------------------------------ 侧栏 */

export function SideNav({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const isLogin = useAuthStore((s) => s.status === 'authenticated');
  const user = useAuthStore((s) => s.user);
  const unread = useNotificationStore((s) => s.unreadCount);

  const items = [...PRIMARY_NAV, ...SECONDARY_NAV].filter((item) => !item.auth || isLogin);

  return (
    <nav className="flex h-full flex-col gap-1 overflow-y-auto px-2 py-3" aria-label="主导航">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-btn px-3 py-2.5 text-sm font-medium transition-colors duration-150',
              isActive ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
              collapsed && 'justify-center px-0',
            )
          }
          title={collapsed ? item.label : undefined}
        >
          <item.icon className="size-[18px] shrink-0" aria-hidden />
          {!collapsed && <span className="truncate">{item.label}</span>}
          {!collapsed && item.to === '/messages' && unread > 0 && (
            <Badge tone="brand" className="ml-auto">
              {unread}
            </Badge>
          )}
        </NavLink>
      ))}

      {isLogin && (
        <>
          <div className="my-2 h-px bg-line" />
          <Link
            to="/creator"
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 rounded-btn px-3 py-2.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg',
              collapsed && 'justify-center px-0',
            )}
            title={collapsed ? '创作者中心' : undefined}
          >
            <Clapperboard className="size-[18px] shrink-0" aria-hidden />
            {!collapsed && <span>创作者中心</span>}
          </Link>
          {user?.permissions.some((p) => p.startsWith('moderation:') || p.startsWith('admin:')) && (
            <Link
              to="/admin"
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 rounded-btn px-3 py-2.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg',
                collapsed && 'justify-center px-0',
              )}
              title={collapsed ? '管理后台' : undefined}
            >
              <Settings className="size-[18px] shrink-0" aria-hidden />
              {!collapsed && <span>管理后台</span>}
            </Link>
          )}
        </>
      )}

      {!collapsed && (
        <div className="mt-4 rounded-card bg-surface-2 p-3">
          <p className="text-[11px] leading-relaxed text-fg-muted">
            {USE_MOCK
              ? '当前为演示数据环境，前端已内置 Mock 适配层。'
              : '已连接真实后端，账号与内容变更会持久化保存。'}
          </p>
          {isLogin && (
            <p className="mt-2 text-[11px] text-fg-subtle">
              登录身份：<span className="font-medium text-fg">{user?.nickname}</span>
            </p>
          )}
          {isLogin && user && (
            <p className="mt-0.5 text-[11px] text-fg-subtle">
              粉丝 {formatCount(user.followerCount ?? 0)} · 作品 {user.videoCount}
            </p>
          )}
        </div>
      )}
    </nav>
  );
}

/** 移动端抽屉侧栏 */
export function MobileNavDrawer() {
  const open = useUiStore((s) => s.mobileDrawerOpen);
  const setOpen = useUiStore((s) => s.setMobileDrawer);

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-90 lg:hidden" role="dialog" aria-modal="true" aria-label="导航菜单">
          <div className="absolute inset-0 bg-overlay" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[82vw] max-w-[300px] flex-col border-r border-line bg-surface">
            <div className="flex h-14 items-center justify-between border-b border-line px-3">
              <Link to="/" onClick={() => setOpen(false)} className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-[7px] bg-brand text-white">
                  <Video className="size-4" aria-hidden />
                </span>
                <span className="text-base font-semibold">{APP_NAME}</span>
              </Link>
              <IconButton label="关闭导航" size="icon-sm" onClick={() => setOpen(false)}>
                <X className="size-4" />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1">
              <SideNav onNavigate={() => setOpen(false)} />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
