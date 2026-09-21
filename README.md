# 光影 · 视频分享平台

全栈视频分享平台，包含 React 前端、Spring Boot 后端、Flyway 数据库迁移、Redis 会话、对象存储和实时通信。

后端运行在 **Java 21 (LTS) + Spring Boot 4.1.1** 上，启用虚拟线程、SQL 级分页与批量视图装配，
本地开发只需要 JDK 21，无需任何外部服务。

## 快速开始

开发环境可以直接运行 H2 + 本地文件存储。JWT RS256 密钥在所有环境（含本地开发）都必须显式配置，
先在仓库根目录生成一次并设置环境变量：

```powershell
node scripts/generate-jwt-keys.mjs   # 输出两个环境变量
# PowerShell：
$env:JWT_PRIVATE_KEY_BASE64="<脚本输出的私钥行>"
$env:JWT_PUBLIC_KEY_BASE64="<脚本输出的公钥行>"
```

```powershell
cd backend
# 默认 profile 是 prod（忘记配置时应当启动失败，而不是静默跑在开发配置上），
# 因此本地开发必须显式指定 dev：
mvn spring-boot:run "-Dspring-boot.run.profiles=dev"
```

另开终端启动前端（默认连接真实后端）：

```powershell
cd frontend
npm exec --yes pnpm@11.21.0 -- install --frozen-lockfile
Copy-Item .env.example .env
npm exec --yes pnpm@11.21.0 -- dev
```

访问 `http://localhost:5173`。演示账号密码统一为 `123456`：`admin`、`moderator`、`laowang`、`newbie`。
如果只想离线体验，可将 `frontend/.env` 中的 `VITE_USE_MOCK` 显式改为 `true`。

> 演示账号快捷登录面板**只在 `VITE_USE_MOCK=true` 时渲染**，生产构建（`VITE_USE_MOCK=false`）
> 既不会显示入口，也不会把口令打进产物；`pnpm verify` 末尾的 `verify:secrets` 会扫描产物断言这一点。
>
> 生产构建时 Vite 自动加载 `frontend/.env.production`（已提交到仓库，内容 `VITE_USE_MOCK=false`），
> 优先级高于本地 `.env`，因此无需担心本地开发配置意外泄漏到产物。

### 运行 profile

| profile | 用途 | 数据源 / 存储 | 安全姿态 |
| --- | --- | --- | --- |
| `prod`（**默认**） | 生产 | MySQL / Redis / MinIO | 安全开关全部关闭；缺密钥即启动失败 |
| `dev` | 纯本地，零外部服务 | H2 文件库 / 本地目录 | 允许固定短信验证码 `123456`、Swagger 开启 |
| `dev-infra` | 本地 + Docker 基础设施 | MySQL(13306) / Redis / MinIO | 同 prod 的安全姿态，仅数据源不同 |

未显式指定 profile 时落在 `prod`：因为缺少 MySQL / Redis / MinIO / 密钥等环境变量而**启动失败**，
这是刻意的 fail-fast —— 宁可起不来，也不要静默跑在开发配置上（固定短信验证码、H2、Swagger）。
本地开发请用 `scripts/start-backend.ps1`（默认注入 `dev-infra`），或显式传 `-Dspring-boot.run.profiles=dev`。
非 prod profile 启动时会在日志中打印醒目横幅提醒。

`dev` 的固定短信验证码由 `app.auth.allow-fixed-sms-code` 控制（默认 `false`，仅 `application-dev.yml`
打开）；任何对外可达的环境都必须保持关闭。

## 本地开发 + 真实基础设施（推荐）

上面的 H2 模式不需要任何外部服务；如果要调试 MySQL / Redis / MinIO 这条真实链路，
可以用 Docker 只起基础设施，后端仍然在宿主机用 Maven 运行：

```powershell
# 1. 起基础设施（MySQL 8.4 / Redis 7.4 / MinIO）
docker compose -f docker-compose.yml -f docker-compose.dev-infra.yml up -d mysql redis minio

# 2. 用 dev-infra profile 启动后端
powershell -File scripts/start-backend.ps1            # 等价于 -Profile dev-infra
```

要点：

- MySQL 容器发布在 **13306**，因为本机可能已有原生 MySQL 占用 3306；可用 `.env` 中的 `MYSQL_PORT` 覆盖。
- Redis 在 6379，MinIO 在 9000（控制台 9001）；后端启动时会自动创建 `video-platform` 桶。
- 连接参数全部取自根目录 `.env`，与 `docker compose` 共用同一份来源。
- 演示数据（4 个账号、4 个示例视频）在库为空时自动写入，dev 与 dev-infra 两个 profile 行为一致。
- 想回到纯 H2 模式：`powershell -File scripts/start-backend.ps1 -Profile dev`。
- RocketMQ 目前没有被后端代码使用（`pom.xml` 无相关依赖），默认不启动；需要时加 `--profile mq`。

### 头像存储

头像走 `POST /api/v1/users/me/avatar`（multipart，固定字段名 `file`）：图片本体落到对象存储，
`users.avatar_url` 只保存一条 URL，因此 2MB 以内的图片都不再受数据库列宽限制。

| 关注点 | 说明 |
| --- | --- |
| 大小上限 | 2MB（`AvatarService.MAX_BYTES`）；容器层 `max-file-size` 设 3MB 留余量，超限返回业务中文提示而非框架异常 |
| 格式校验 | 只认文件头魔数（PNG/JPEG/GIF），不信任扩展名与 Content-Type；另限制单边 ≤ 4096 像素 |
| MinIO 模式 | 启动时下发仅含 `s3:GetObject` 的桶策略，浏览器直连 `publicEndpoint` 读取。预签名 URL 有 7 天上限，不适用于长期展示的头像，因此用公开读策略而不是签名 |
| 本地模式 | `publicUrl` 返回 `/api/v1/media/**`，由 `MediaController` 同源输出，且只允许图片扩展名 |
| 旧图清理 | 保存新头像后删除上一张，且仅删除本存储管理的对象（不会误删外链） |
| 遗留数据 | `node scripts/migrate-base64-avatars.mjs` 把历史上以 base64 存储的头像迁到对象存储 |

## 多码率清晰度（转码）

播放器的清晰度菜单依赖服务端提供多档 HLS。项目本身没有内置编码器，因此分两种情况：

| 来源 | 清晰度来源 |
| --- | --- |
| 随包演示视频 | 已内置 360p/540p/720p 演示流，`DemoSegmentController` 直接输出 |
| 真实上传视频 | 需要用 ffmpeg 离线转码（见下），否则菜单只显示「原画」 |

转码（用 Docker 里的 ffmpeg，无需在宿主机安装）：

```powershell
powershell -File scripts/transcode-hls.ps1                  # 转所有已发布视频
powershell -File scripts/transcode-hls.ps1 -VideoIds "5,7"  # 只转指定视频
powershell -File scripts/transcode-hls.ps1 -Force           # 强制重转
```

脚本通过后端 `/source` 取源文件，产出到 `data/hls/<videoId>/`（三档 360p/540p/720p，
不超过源分辨率，关键帧对齐以便切换）。产物由 `TranscodeHlsController` 以
`/api/v1/videos/<id>/hls/master.m3u8` 提供；后端启动时 `TranscodedHlsLinker`（仅 dev/dev-infra）
会把存在产物的视频的 `hls_url` 自动指向该清单，因此**转码完重启后端即可生效**，无需手工改库。

```powershell
docker build -t videoshare-ffmpeg:local - <<'EOF'   # 脚本会自动构建，此处仅示意
FROM docker.m.daocloud.io/library/debian:bookworm-slim
RUN apt-get update -qq && apt-get install -y -qq ffmpeg
ENTRYPOINT ["ffmpeg"]
EOF
```

> 注意：`data/hls` 相对 `backend/` 的上一级解析（启动脚本会 `Push-Location backend`），
> 可用 `HLS_ROOT` 覆盖。转码是派生产物，已在 `.gitignore` 中忽略。

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

复制 `.env.example` 为根目录 `.env`，并为 MySQL、Redis、MinIO、JWT RS256 密钥、数据加密密钥和本地上传签名密钥设置强随机值。后端生产 profile 会执行 Flyway 迁移 `V1`–`V7`，提供 REST、Swagger、SSE 榜单和 STOMP WebSocket 通道。反向代理是唯一入口时保持 `AUTH_TRUST_PROXY_HEADERS=true`（`.env.example` 默认值），登录限流才能按真实客户端地址计数；直接在公网暴露 8080 时应设为 `false`。

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
cd backend; mvn test          # 需要 JDK 21：29 项测试（含 N+1 查询次数护栏与测试报告回归）
cd frontend; npm exec --yes pnpm@11.21.0 -- verify
```

前后端都启动后，可再跑两个端到端门禁（结果即验收证据）：

```powershell
node scripts/report-regression-e2e.mjs http://localhost:5173   # 报告缺陷回归 63 项，含真实分片上传→审核→播放→续播闭环
cd frontend; node scripts/cdp-check.mjs http://localhost:5173  # 真实浏览器 30 项：路由、交互、控制台错误与横向溢出
```

浏览器脚本应从 `frontend` 目录运行；Windows 需要通过 `CHROME_BIN` 指定浏览器可执行文件。
开发 profile 使用文件 H2（`./data/video_platform.mv.db`）与本地对象存储，演示数据只在库为空时写入，
重启不会覆盖已注册账号与上传内容；正式内容请使用「生产依赖」一节部署。
已完成的检查和已知功能缺口见 [测试报告](./TEST_REPORT.md) 与 [全面测试报告](./COMPREHENSIVE_TEST_REPORT.md)。

## 文档

- [性能与开销测试报告](./PERFORMANCE_REPORT.md)
- [前端 GUI 测试报告](./FRONTEND_UI_TEST_REPORT.md)
- [项目开发文档](./video-website.md)
- [后端说明](./backend/README.md)
- [前端说明](./frontend/README.md)
- [前端开发规范](./frontend/docs/FRONTEND_CONVENTIONS.md)
