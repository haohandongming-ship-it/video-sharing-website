import { NavLink } from 'react-router-dom';
import { Clapperboard, Home, Rss, Trophy, UserRound } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/authStore';

const TABS = [
  { to: '/', label: '首页', icon: Home },
  { to: '/shorts', label: '短视频', icon: Clapperboard },
  { to: '/feed', label: '动态', icon: Rss },
  { to: '/ranking', label: '榜单', icon: Trophy },
];

/** 移动端底部标签栏：拇指可达的主导航（移动优先体验） */
export function BottomTabBar() {
  const user = useAuthStore((s) => s.user);
  const isLogin = useAuthStore((s) => s.status === 'authenticated');

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-60 border-t border-line bg-canvas/95 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="底部导航"
    >
      <ul className="flex h-14 items-stretch">
        {TABS.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              end={tab.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex h-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                  isActive ? 'text-brand' : 'text-fg-muted',
                )
              }
            >
              <tab.icon className="size-5" aria-hidden />
              {tab.label}
            </NavLink>
          </li>
        ))}
        <li className="flex-1">
          <NavLink
            to={isLogin && user ? `/user/${user.id}` : '/login'}
            className={({ isActive }) =>
              cn(
                'flex h-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                isActive ? 'text-brand' : 'text-fg-muted',
              )
            }
          >
            <UserRound className="size-5" aria-hidden />
            {isLogin ? '我的' : '登录'}
          </NavLink>
        </li>
      </ul>
    </nav>
  );
}
