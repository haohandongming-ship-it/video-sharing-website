# 前端开发规范（供并行开发者/AI 协作者遵循）

> 项目：光影 · 视频分享平台前端（React 19 + Vite 6 + TS 5 + Tailwind 4 + TanStack Query 5 + Zustand 5 + Framer Motion 11）
> 位置：仓库 `frontend/` 目录；本文中所有相对路径均以 `frontend/` 为基准。
> 依据：《视频分享网站 · 项目开发文档 v2.0》（仓库根目录 `video-website.md`）

## 1. 硬性规则

1. **只写自己负责的文件**，不要修改他人文件、不要改 `src/index.css`、不要改 `package.json`。
2. **不要新增第三方依赖**。可用依赖：react, react-dom, react-router-dom, @tanstack/react-query, @tanstack/react-virtual, zustand, framer-motion, hls.js, @stomp/stompjs, lucide-react, clsx, tailwind-merge, dayjs。
3. **TypeScript 严格模式**：`strict: true`、`verbatimModuleSyntax: true`（类型导入必须用 `import type`）、路径别名 `@/`。
4. **所有文案使用简体中文**，语气克制、具体，禁止营销腔与 AI 味（禁止「赋能」「一站式」「开启精彩旅程」这类空话）。
5. **样式只能用设计令牌类名**，禁止写裸色值（`bg-[#ff0000]`）、禁止紫蓝渐变、禁止玻璃拟态。
6. 页面必须覆盖 **骨架屏 / 空状态 / 错误态** 三态（文档 12.2）。
7. 不得使用 `any`；不得留 `console.log`（`console.error` 仅用于异常上报）。
8. 文件保持单一职责，单文件建议 ≤ 400 行；超长时拆分子组件到 `src/components/<domain>/`。

## 2. 设计令牌（Tailwind 语义类）

| 类名 | 用途 |
| --- | --- |
| `bg-canvas` / `bg-surface` / `bg-surface-2` / `bg-surface-3` | 页面底色 / 卡片 / 次级容器 / 三级容器 |
| `text-fg` / `text-fg-muted` / `text-fg-subtle` | 主文字 / 次文字 / 辅助文字 |
| `border-line` | 分割线、描边 |
| `bg-brand` / `text-brand` / `bg-brand-soft` | 品牌珊瑚红（主 CTA、点赞激活） |
| `bg-accent` / `text-accent` / `bg-accent-soft` | 靛蓝辅助色（链接、选中态、信息类） |
| `bg-success` `bg-success-soft` `text-warning` `bg-warning-soft` | 状态色 |
| `rounded-card`(12px) `rounded-btn`(8px) `rounded-pill` | 圆角规范 |
| `shadow-card` `shadow-raised` `shadow-pop` | 阴影层级 |

自定义工具类：`card-surface`、`skeleton-sheen`、`hide-scrollbar`、`tap-highlight-none`、`text-shadow-media`、`safe-bottom`、`safe-top`、`no-select`、`comment-highlight`。

动效曲线（`@/lib/motion`）：`EASE.enter` `EASE.exit` `EASE.springy`；变体 `pageTransition` `fadeIn` `listContainer` `listItem`。页面切换/列表进入必须带 `prefers-reduced-motion` 兼容（框架已全局处理 `reduce-motion`）。

## 3. 可用基础组件（`@/components/ui`）

```
Button, IconButton, PillAction
Input, Textarea, SearchInput, Switch, RadioGroup
Avatar, AvatarWithMeta
Badge, Tag, ProgressBar, RingProgress
Skeleton, VideoCardSkeleton, VideoGridSkeleton, CommentSkeleton, ListSkeleton
EmptyState, ErrorState, Spinner, LoadingBlock, LoadMoreSentinel, OfflineBanner
Modal, Drawer, Dropdown, Tooltip
Tabs, Collapsible, Pagination
Toaster, ConfirmDialog
SectionHeader, PageContainer, SurfaceCard, Divider, StatTile
JsonLd
```

领域组件：
- `@/components/video/VideoCard`：`VideoCard`（layout: grid|row|compact|poster）、`VideoCardGrid`、`ShortVideoCard`
- `@/components/video/VideoPlayer`：`VideoPlayer`、`ShortVideoPlayer`
- `@/components/video/ActionBar`：`ActionBar`、`ChannelCard`
- `@/components/video/ShareDialog`、`@/components/video/ReportDialog`
- `@/components/comment/CommentSection`（含 `CommentInput`）
- `@/components/feed/FeedCard`
- `@/components/user/SubscribeButton`
- `@/components/layout/TopNav`（`TopNav`、`SideNav`、`MobileNavDrawer`）、`BottomTabBar`

## 4. 数据层

- **API 层**：`@/api`（`authApi, videoApi, feedApi, userApi, creatorApi, uploadApi, notificationApi, messageApi, adminApi, categoryApi`）。
  `USE_MOCK` 时由 `src/mocks` 拦截 `/api/**`，所有写操作真实改变内存态。
- **Query hooks**：`@/hooks/useApi`（如 `useVideoDetail`、`useComments`、`usePostComment`、`useReviewTasks`、`useAdminOverview`…）。**页面禁止直接调用 api 层**，用 hooks；新增查询请在 `@/lib/queryKeys` 注册 key 并在此文件新增 hook。
- **客户端状态**：`@/stores`（`useAuthStore` / `useUiStore` / `usePlayerStore` / `useNotificationStore`）。
  - Toast：`useUiStore.getState().toast({ title, description, tone })`
  - 二次确认：`openConfirm({ title, description, confirmText, danger, onConfirm })`
  - 主题：`theme` / `setTheme` / `resolvedTheme`
  - 登录态：`useAuthStore(s => s.status === 'authenticated')`、`s.user`、`s.hasPermission('moderation:review')`
- **乐观更新**：点赞/收藏/评论等已在 hooks 内实现，页面直接用 `mutation.mutate(...)`。

## 5. 路由表（文档 5.2，勿改路径）

| 路径 | 页面文件 |
| --- | --- |
| `/` | `src/pages/HomePage.tsx` |
| `/video/:id` | `src/pages/VideoPlayerPage.tsx` |
| `/shorts` | `src/pages/ShortsPage.tsx` |
| `/feed` | `src/pages/FeedPage.tsx` |
| `/feed/:id` | `src/pages/FeedDetailPage.tsx` |
| `/user/:id`、`/user/:id/videos` | `src/pages/UserProfilePage.tsx` |
| `/upload` | `src/pages/UploadPage.tsx` |
| `/search` | `src/pages/SearchPage.tsx` |
| `/ranking` | `src/pages/RankingPage.tsx` |
| `/history` | `src/pages/HistoryPage.tsx` |
| `/favorites` | `src/pages/FavoritesPage.tsx` |
| `/messages` | `src/pages/MessagesPage.tsx` |
| `/settings` | `src/pages/SettingsPage.tsx` |
| `/creator` | `src/pages/CreatorPage.tsx` |
| `/login`、`/register` | `src/pages/auth/LoginPage.tsx` |
| `/admin/*` | `src/pages/admin/*` |

页面默认导出（`export default function XxxPage()`），由 `src/app/routes.tsx` 懒加载。

## 6. 验收要求（文档 19）

- 响应式：≥ 3 断点（移动 < 640、平板 640–1024、桌面 > 1024），移动端底部有 56px 安全区（`pb-16 lg:pb-0` 已由布局处理）。
- 无障碍：交互元素需 `aria-label`，可点击区域 ≥ 40px，键盘可达。
- 性能：长列表必须 `loading="lazy"`、`decoding="async"`；超过 200 条使用虚拟列表。
- 合规：涉及个性化推荐、青少年模式、账号注销的入口需与设置页一致；举报入口必须存在。

## 7. 自检命令

```bash
pnpm typecheck            # 必须 0 error
pnpm lint                 # 必须 0 error
```

只针对自己新增文件排查错误即可，他人文件报错请在总结中说明，不要代改。
