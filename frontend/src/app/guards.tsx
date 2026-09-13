import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '@/stores/authStore';
import type { Permission } from '@/api/types';
import { EmptyState, LoadingBlock } from '@/components/ui';
import { ShieldAlert } from 'lucide-react';

/** 登录守卫：未登录跳转登录页并记录回跳地址（文档 5.2 路由表鉴权列） */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();

  if (status === 'loading') return <LoadingBlock label="正在恢复登录状态" />;
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <>{children}</>;
}

/** 权限守卫：基于权限点集合判定，角色不互斥（文档 2.1 / 2.3） */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const has = useAuthStore((s) => s.user?.permissions.includes(permission) ?? false);

  if (status === 'loading') return <LoadingBlock label="正在校验权限" />;
  if (status !== 'authenticated') return <Navigate to="/login" replace />;
  if (!has) {
    return (
      <EmptyState
        icon={<ShieldAlert className="size-7" />}
        title="没有访问权限"
        description="该区域仅对具备相应权限的审核员或管理员开放。如认为这是误判，请联系平台管理员。"
      />
    );
  }
  return <>{children}</>;
}
