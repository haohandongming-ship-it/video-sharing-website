# 光影 · 视频分享平台前端

> 本目录是仓库的前端工程（仓库根目录另见 [`../README.md`](../README.md) 与
> 需求文档 [`../video-website.md`](../video-website.md)）。
> 技术栈：React 19 · TypeScript 5 · Vite 6 · Tailwind CSS 4 · TanStack Query 5 · Zustand 5 · Framer Motion 11 · HLS.js。

## 快速开始

在本目录（`frontend/`）下执行：

```bash
npm exec --yes pnpm@11.21.0 -- install --frozen-lockfile
Copy-Item .env.example .env
npm exec --yes pnpm@11.21.0 -- dev                  # http://localhost:5173
```

`.env.example` 默认 `VITE_USE_MOCK=false`，前端通过 Vite 代理连接本地后端；只有离线演示时才将其显式改为 `true`。
也可配置 `VITE_API_BASE_URL` / `VITE_PROXY_TARGET` 连接其他环境（`src/api/client.ts` 是唯一请求分支点）。

### 演示账号（Mock 环境，密码统一 `123456`，短信验证码 `123456`）

| 账号 | 角色 | 可验证的能力 |
| --- | --- | --- |
| `admin` | 管理员 | 数据概览、审核 / 举报处理、用户与角色管理、系统配置、操作日志 |
| `moderator` | 审核员 | 审核队列、举报处理（同时保留普通用户全部权限） |
| `laowang` | 创作者（已实名） | 上传、创作者中心数据看板、下载授权 |
| `newbie` | 新用户 | 先审后发策略（新用户内容需审核通过后发布） |

登录页提供「演示账号快捷登录」，一键切换角色体验权限差异。

## 目录结构

```
src/
├── api/            # 接口层：client（统一信封/401 静默刷新/幂等键）、各领域 api、realtime（STOMP+SSE 及降级）
├── app/            # 应用装配：AppProviders、路由表、守卫、QueryClient、错误边界
├── components/
│   ├── ui/         # 基础组件库（按钮/输入/弹层/骨架屏/空态/错误态/分页/进度…）
│   ├── video/      # VideoCard、VideoPlayer（HLS 自研控制层）、ActionBar、分享与举报弹窗
│   ├── comment/    # 评论区（二级嵌套、虚拟列表、乐观插入）
│   ├── feed/       # 微博式动态卡片
│   ├── user/       # 关注 / 订阅按钮
│   └── layout/     # TopNav、SideNav、底部标签栏、通知面板、四种布局壳
├── features/upload # 上传引擎：SHA-256、魔数校验、帧截取、上传 store
├── hooks/          # TanStack Query 封装（服务端状态唯一入口）
├── lib/            # 格式化、存储、动效曲线、query key 规范、cn
├── mocks/          # Mock 适配层（拦截 /api/**，写操作真实改内存态）+ 确定性种子数据
├── pages/          # 页面（含 admin/ 与 auth/ 子目录）
└── stores/         # Zustand：auth（Token 仅内存）/ ui / player / notification
```

## 关键实现说明

### 认证与会话（文档 5.1 / 13.1）

- **Access Token 只在内存**：由 `authBridge` 持有，绝不写入 localStorage；
  `localStorage` 仅存主题、音量、倍速、播放进度等非敏感偏好。
- **静默换新**：首屏渲染前 `hydrateStores()` 先回填持久化状态，再用 Refresh Token（真实环境为 httpOnly Cookie）
  调 `/auth/refresh` 换取新的 Access Token，避免路由守卫误判为游客（这一顺序是必须的，否则刷新页面会掉登录态）。
- **401 单飞刷新**：`client.ts` 内 `refreshPromise` 保证并发 401 只触发一次刷新，失败则清理会话并提示重新登录。
- **CSRF 双重防御**：所有请求带 `X-Requested-With`，配合 Cookie 的 `SameSite=Strict`（真实部署）。

### Mock 适配层

- `mocks/index.ts` 拦截同源 `/api/**`，返回与文档 6.3 一致的信封结构 `{ code, message, data, timestamp }`；
- 写操作（点赞、审核、封禁、设置、上传、秒传）会真实修改内存数据，因此「点赞后刷新仍为已赞」
  「审核通过后从待审列表消失」这类链路可端到端验证；
- 演示会话写入 `sessionStorage`（按标签页隔离），使刷新页面后登录态仍可还原，行为与真实 Cookie 一致；
- ⚠️ `VITE_USE_MOCK=true` 时 dev server **不配置 `/api` 代理**——否则请求会被转发到未启动的后端，永远到不了浏览器端 Mock。

### 播放器（文档 5.1 / 5.6）

`useHlsPlayer` + `VideoPlayer` 自研控制层：HLS.js 多清晰度与 ABR、Safari 原生回退、加载失败自动回退演示流；
键盘快捷键（空格 / ←→ / ↑↓ / F / M / C / 0-9）、记忆播放（localStorage + 服务端双写，15s 节流 + 离开页面上报）、
播放计数（≥3s 触发，服务端 24h 去重）、画中画、影院模式、自动连播。
演示流由 `pnpm demo:hls` 用 FFmpeg 生成（360P/540P/720P 三档 fMP4）。

### 短视频（文档 4.2）

全屏垂直滑动（指针拖拽 + 速度检测）、双击点赞（心形粒子扩散）、长按 2 倍速、滚轮切换、
静音状态、键盘 J/K/↑/↓/空格/M、相邻视频预加载，滑动时当前视频缩小至 0.95。

### 上传链路（文档 10.1）

分片 8MB、并发 3、断点续传、SHA-256 秒传、文件魔数校验（伪造扩展名直接拒绝）、
时长/体积双校验、首帧截图封面、暂停/继续/取消、转码进度轮询并展示四档清晰度阶段。

### 合规落点（文档 14 章）

- 可关闭个性化推荐（首页与设置页均有入口，附《互联网信息服务算法推荐管理规定》说明）；
- 青少年模式（时长上限 + 宵禁时段说明）；
- 账号注销 7 天冷静期与匿名化说明；
- 举报通道（视频 / 评论 / 动态 / 用户）与审核后台；
- 手机号脱敏展示、操作日志留存 6 个月提示、原创声明与侵权提示。

## 质量门禁

```bash
pnpm verify          # typecheck + lint + test + build
pnpm coverage        # 单元测试覆盖率（阈值已配置，未达标会失败）
```

### 浏览器端到端验收（需先 `pnpm dev`）

```bash
pnpm verify:browser                                  # 30 项：游客路由 / 守卫 / 登录 / 后台 / 手势 / 主题
pnpm verify:upload -- /tmp/upload-test.mp4           # 11 项：上传全链路 + 秒传（真实文件上传）
pnpm verify:session                                  # 会话持久化专项诊断
```

脚本基于 Chrome DevTools Protocol（Node 内置 WebSocket，无额外依赖），会捕获控制台错误与横向溢出。

## 已知取舍

- 弹幕、投币、字幕轨、私信附件为文档中的 P2 项，仅保留入口与占位交互；
- 推荐、搜索、榜单为前端规则实现，真实排序由后端算法服务提供；
- 上传/审核/举报的写操作在 Mock 下改内存态，刷新浏览器后回到种子数据（真实后端无此限制）。
