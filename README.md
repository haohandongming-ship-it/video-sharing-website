# 光影 · 视频分享平台

全栈视频分享平台，包含 React 前端、Spring Boot 后端、Flyway 数据库迁移、Redis 会话、对象存储和实时通信。

## 快速开始

开发环境可以直接运行 H2 + 本地文件存储：

```powershell
cd backend
mvn spring-boot:run
```

另开终端启动前端（默认连接真实后端）：

```powershell
cd frontend
npm exec --yes pnpm@10.18.3 -- install --frozen-lockfile
Copy-Item .env.example .env
npm exec --yes pnpm@10.18.3 -- dev
```

访问 `http://localhost:5173`。演示账号密码统一为 `123456`：`admin`、`moderator`、`laowang`、`newbie`。
如果只想离线体验，可将 `frontend/.env` 中的 `VITE_USE_MOCK` 显式改为 `true`。

## 生产依赖

```powershell
docker compose --env-file .env up --build
```

复制 `.env.example` 为根目录 `.env`，并为 MySQL、Redis、MinIO、JWT RS256 密钥、数据加密密钥和本地上传签名密钥设置强随机值。后端生产 profile 会执行 Flyway 迁移 `V1`–`V4`，提供 REST、Swagger、SSE 榜单和 STOMP WebSocket 通道。

## 质量门禁

```powershell
cd backend; mvn test
cd frontend; npm exec --yes pnpm@10.18.3 -- verify
node scripts/cdp-check.mjs http://localhost:5173
```

## 文档

- [项目开发文档](./video-website.md)
- [后端说明](./backend/README.md)
- [前端说明](./frontend/README.md)
- [前端开发规范](./frontend/docs/FRONTEND_CONVENTIONS.md)
