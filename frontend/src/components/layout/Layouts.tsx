import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useUiStore } from '@/stores/uiStore';
import { MobileNavDrawer, SideNav, TopNav } from './TopNav';
import { BottomTabBar } from './BottomTabBar';

/** 标准主布局：顶部导航 + 可折叠左侧栏 + 内容区（文档 4.1） */
export function MainLayout() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);

  return (
    <div className="min-h-dvh bg-canvas">
      <TopNav />
      <MobileNavDrawer />
      <div className="flex">
        <aside
          className={cn(
            'sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 border-r border-line bg-canvas transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] lg:block',
            collapsed ? 'w-[72px]' : 'w-56',
          )}
        >
          <SideNav collapsed={collapsed} />
        </aside>
        <main className="min-w-0 flex-1 pb-16 lg:pb-0">
          <Outlet />
        </main>
      </div>
      <BottomTabBar />
    </div>
  );
}

/** 沉浸式布局：短视频全屏消费，无顶栏无侧栏（文档 4.2） */
export function ImmersiveLayout() {
  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <Outlet />
    </div>
  );
}

/** 管理后台布局：独立导航，视觉与主站区分 */
export function AdminLayout() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return <Outlet />;
}

/** 极简布局：登录/注册等独立页面 */
export function BlankLayout() {
  return (
    <div className="min-h-dvh bg-canvas">
      <Outlet />
    </div>
  );
}
