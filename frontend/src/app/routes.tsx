/**
 * 路由表 —— 严格对齐《项目开发文档 v2.0》第 5.2 节。
 * 所有页面按路由懒加载，配合 manualChunks 控制首屏体积（验收：FCP ≤ 1.5s）。
 */
import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout, BlankLayout, ImmersiveLayout, MainLayout } from '@/components/layout/Layouts';
import { RequireAuth, RequirePermission } from './guards';
import { EmptyState, LoadingBlock } from '@/components/ui';
import { Compass } from 'lucide-react';

const HomePage = lazy(() => import('@/pages/HomePage'));
const VideoPlayerPage = lazy(() => import('@/pages/VideoPlayerPage'));
const ShortsPage = lazy(() => import('@/pages/ShortsPage'));
const SearchPage = lazy(() => import('@/pages/SearchPage'));
const RankingPage = lazy(() => import('@/pages/RankingPage'));
const FeedPage = lazy(() => import('@/pages/FeedPage'));
const FeedDetailPage = lazy(() => import('@/pages/FeedDetailPage'));
const UserProfilePage = lazy(() => import('@/pages/UserProfilePage'));
const UploadPage = lazy(() => import('@/pages/UploadPage'));
const HistoryPage = lazy(() => import('@/pages/HistoryPage'));
const FavoritesPage = lazy(() => import('@/pages/FavoritesPage'));
const MessagesPage = lazy(() => import('@/pages/MessagesPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const CreatorPage = lazy(() => import('@/pages/CreatorPage'));
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));

const AdminDashboardPage = lazy(() => import('@/pages/admin/AdminDashboardPage'));
const AdminReviewPage = lazy(() => import('@/pages/admin/AdminReviewPage'));
const AdminReportPage = lazy(() => import('@/pages/admin/AdminReportPage'));
const AdminUserPage = lazy(() => import('@/pages/admin/AdminUserPage'));
const AdminVideoPage = lazy(() => import('@/pages/admin/AdminVideoPage'));
const AdminSettingsPage = lazy(() => import('@/pages/admin/AdminSettingsPage'));
const AdminAuditPage = lazy(() => import('@/pages/admin/AdminAuditPage'));
const AdminShell = lazy(() => import('@/pages/admin/AdminShell'));

function NotFoundPage() {
  return (
    <EmptyState
      icon={<Compass className="size-7" />}
      title="页面走丢了"
      description="你访问的地址不存在或已被移除。可以返回首页继续浏览，或使用顶部搜索找到想看的内容。"
      action={
        <a href="/" className="text-sm font-medium text-accent hover:underline">
          返回首页
        </a>
      }
    />
  );
}

export function AppRoutes() {
  return (
    <Suspense fallback={<LoadingBlock label="页面加载中" className="min-h-[50vh]" />}>
      <Routes>
        {/* 主布局 */}
        <Route element={<MainLayout />}>
          <Route index element={<HomePage />} />
          <Route path="video/:id" element={<VideoPlayerPage />} />
          <Route path="feed" element={<FeedPage />} />
          <Route path="feed/:id" element={<FeedDetailPage />} />
          <Route path="user/:id" element={<UserProfilePage />} />
          <Route path="user/:id/videos" element={<UserProfilePage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="ranking" element={<RankingPage />} />
          <Route
            path="upload"
            element={
              <RequireAuth>
                <UploadPage />
              </RequireAuth>
            }
          />
          <Route
            path="history"
            element={
              <RequireAuth>
                <HistoryPage />
              </RequireAuth>
            }
          />
          <Route
            path="favorites"
            element={
              <RequireAuth>
                <FavoritesPage />
              </RequireAuth>
            }
          />
          <Route
            path="messages"
            element={
              <RequireAuth>
                <MessagesPage />
              </RequireAuth>
            }
          />
          <Route
            path="settings"
            element={
              <RequireAuth>
                <SettingsPage />
              </RequireAuth>
            }
          />
          <Route
            path="creator"
            element={
              <RequireAuth>
                <CreatorPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>

        {/* 沉浸式短视频 */}
        <Route element={<ImmersiveLayout />}>
          <Route path="shorts" element={<ShortsPage />} />
        </Route>

        {/* 独立页面 */}
        <Route element={<BlankLayout />}>
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<LoginPage initialMode="register" />} />
        </Route>

        {/* 管理后台（审核员及以上，权限点判定） */}
        <Route
          path="admin"
          element={
            <RequireAuth>
              <AdminShell />
            </RequireAuth>
          }
        >
          <Route element={<AdminLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<AdminDashboardPage />} />
            <Route
              path="reviews"
              element={
                <RequirePermission permission="moderation:review">
                  <AdminReviewPage />
                </RequirePermission>
              }
            />
            <Route
              path="reports"
              element={
                <RequirePermission permission="moderation:report">
                  <AdminReportPage />
                </RequirePermission>
              }
            />
            <Route
              path="videos"
              element={
                <RequirePermission permission="moderation:review">
                  <AdminVideoPage />
                </RequirePermission>
              }
            />
            <Route
              path="users"
              element={
                <RequirePermission permission="admin:user_manage">
                  <AdminUserPage />
                </RequirePermission>
              }
            />
            <Route
              path="audit"
              element={
                <RequirePermission permission="admin:analytics">
                  <AdminAuditPage />
                </RequirePermission>
              }
            />
            <Route
              path="settings"
              element={
                <RequirePermission permission="admin:system_config">
                  <AdminSettingsPage />
                </RequirePermission>
              }
            />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
