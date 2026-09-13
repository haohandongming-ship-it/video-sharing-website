import { Clapperboard, Compass, History, Home, MessageSquare, Rss, Settings, Trophy } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  auth?: boolean;
}

/** 主导航（文档 4.1 左侧菜单） */
export const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: '首页', icon: Home },
  { to: '/ranking', label: '排行榜', icon: Trophy },
  { to: '/shorts', label: '短视频', icon: Clapperboard },
  { to: '/feed', label: '动态', icon: Rss },
  { to: '/history', label: '观看历史', icon: History, auth: true },
  { to: '/favorites', label: '我的收藏', icon: Compass, auth: true },
  { to: '/messages', label: '私信', icon: MessageSquare, auth: true },
];

export const SECONDARY_NAV: NavItem[] = [{ to: '/settings', label: '设置', icon: Settings, auth: true }];

/** 搜索框下的热门搜索词 */
export const HOT_LINKS = [
  { to: '/search?q=%E6%9E%B6%E6%9E%84', label: '架构设计' },
  { to: '/search?q=%E5%AE%B6%E5%B8%B8%E8%8F%9C', label: '家常菜' },
  { to: '/search?q=React', label: 'React 19' },
  { to: '/search?q=%E9%AA%91%E8%A1%8C', label: '骑行' },
];
