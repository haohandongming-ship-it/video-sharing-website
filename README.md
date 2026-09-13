# 光影 · 视频分享平台

本仓库由两部分组成：

```
.
├── frontend/            # 前端工程（React 19 + Vite 6 + TS + Tailwind 4）
├── video-website.md     # 《视频分享网站 · 项目开发文档 v2.0》—— 全栈需求与设计依据
└── LICENSE
```

## 快速开始

```bash
cd frontend
pnpm install
cp .env.example .env      # 默认 VITE_USE_MOCK=true，无需后端即可完整体验
pnpm dev                  # http://localhost:5173
```

后端就绪后，把 `frontend/.env` 中 `VITE_USE_MOCK` 改为 `false` 并配置
`VITE_API_BASE_URL` / `VITE_PROXY_TARGET`，前端会自动关闭 Mock 适配层并直连真实接口。

### 演示账号（Mock 环境，密码统一 `123456`，短信验证码 `123456`）

| 账号 | 角色 | 可验证的能力 |
| --- | --- | --- |
| `admin` | 管理员 | 数据概览、审核 / 举报处理、用户与角色管理、系统配置、操作日志 |
| `moderator` | 审核员 | 审核队列、举报处理（同时保留普通用户全部权限） |
| `laowang` | 创作者（已实名） | 上传、创作者中心数据看板、下载授权 |
| `newbie` | 新用户 | 先审后发策略（新用户内容需审核通过后发布） |

登录页提供「演示账号快捷登录」，一键切换角色体验权限差异。

## 文档索引

| 文档 | 位置 | 内容 |
| --- | --- | --- |
| 项目开发文档 v2.0 | [`video-website.md`](./video-website.md) | 需求、架构、数据库、API、UI/UX 规范、合规与验收标准 |
| 前端说明 | [`frontend/README.md`](./frontend/README.md) | 启动方式、目录结构、关键实现说明、质量门禁 |
| 前端开发规范 | [`frontend/docs/FRONTEND_CONVENTIONS.md`](./frontend/docs/FRONTEND_CONVENTIONS.md) | 设计令牌、组件清单、数据层约定与验收要求 |

## 质量门禁

在 `frontend/` 目录下执行：

```bash
pnpm verify           # typecheck + lint + test（140 项）+ build
pnpm coverage         # 覆盖率报告（阈值未达标即失败）
pnpm verify:browser   # 浏览器端到端验收 30 项（需先 pnpm dev）
pnpm verify:upload -- /path/to/video.mp4   # 上传链路验收 11 项
```

验收入口与 Mock 边界等实现细节见 [`frontend/README.md`](./frontend/README.md)。
