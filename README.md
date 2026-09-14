# 光影 · 视频分享平台

全栈视频分享平台，包含 React 前端、Spring Boot 后端、Flyway 数据库迁移、Redis 会话、对象存储和实时通信。

后端运行在 **Java 21 (LTS) + Spring Boot 4.1.1** 上，启用虚拟线程、SQL 级分页与批量视图装配，
本地开发只需要 JDK 21，无需任何外部服务。

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

复制 `.env.example` 为根目录 `.env`，并为 MySQL、Redis、MinIO、JWT RS256 密钥、数据加密密钥和本地上传签名密钥设置强随机值。后端生产 profile 会执行 Flyway 迁移 `V1`–`V5`，提供 REST、Swagger、SSE 榜单和 STOMP WebSocket 通道。

### Docker 国内镜像源

所有镜像与构建期依赖默认走国内源，国内网络无需配置 Docker daemon 加速即可 `up --build`：

| 用途 | 默认值 | 覆盖变量 |
| --- | --- | --- |
| MySQL / Redis / MinIO / RocketMQ 等运行时镜像 | `docker.m.daocloud.io` | `DOCKER_REGISTRY`（设为 `docker.io` 回退官方源） |
| 后端构建/运行基础镜像 | `docker.m.daocloud.io/library/maven:3.9.11-eclipse-temurin-21-alpine`、`…/eclipse-temurin:21-jre-alpine` | `MAVEN_IMAGE`、`JRE_IMAGE` |
| 前端构建/运行基础镜像 | `docker.m.daocloud.io/library/node:22-alpine`、`…/nginx:1.27-alpine` | `NODE_IMAGE`、`NGINX_IMAGE` |
| Maven 依赖 | `https://maven.aliyun.com/repository/public` | `MAVEN_MIRROR_URL`（留空回退 Maven Central） |
| npm 依赖 | `https://registry.npmmirror.com` | `NPM_REGISTRY`（留空回退 registry.npmjs.org） |

上述变量都写在 `.env.example` 中，复制为 `.env` 后按需调整。

## 质量门禁

```powershell
cd backend; mvn test          # 需要 JDK 21：15 项测试（含 N+1 查询次数护栏）
cd frontend; npm exec --yes pnpm@10.18.3 -- verify
node scripts/cdp-check.mjs http://localhost:5173
```

浏览器脚本应从 `frontend` 目录运行；Windows 需要通过 `CHROME_BIN` 指定浏览器可执行文件。
默认开发数据库是内存 H2，后端重启会重建演示数据，不适合保存正式内容。
已完成的检查和已知功能缺口见 [测试报告](./TEST_REPORT.md)。

## 文档

- [性能与开销测试报告](./PERFORMANCE_REPORT.md)
- [前端 GUI 测试报告](./FRONTEND_UI_TEST_REPORT.md)
- [项目开发文档](./video-website.md)
- [后端说明](./backend/README.md)
- [前端说明](./frontend/README.md)
- [前端开发规范](./frontend/docs/FRONTEND_CONVENTIONS.md)
