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

## 局域网访问

前端开发服务器已监听局域网地址。先在运行项目的电脑上执行 `ipconfig`，找到当前 Wi-Fi/以太网网卡的 IPv4 地址，然后让同一局域网内的设备访问：

```text
http://<运行项目电脑的IPv4>:5173
```

例如本机当前地址是 `172.20.10.3`，访问 `http://172.20.10.3:5173`。登录和注册接口已经允许私有 IPv4 网段的前端来源；如果页面完全无法打开，需要在 Windows 防火墙中允许 Node.js/Vite 的 TCP 5173 端口，并确认设备连接的是同一个局域网。

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

浏览器脚本应从 `frontend` 目录运行；Windows 需要通过 `CHROME_BIN` 指定浏览器可执行文件。
默认开发数据库是内存 H2，后端重启会重建演示数据，不适合保存正式内容。
已完成的检查和已知功能缺口见 [测试报告](./TEST_REPORT.md)。

## 文档

- [项目开发文档](./video-website.md)
- [后端说明](./backend/README.md)
- [前端说明](./frontend/README.md)
- [前端开发规范](./frontend/docs/FRONTEND_CONVENTIONS.md)
