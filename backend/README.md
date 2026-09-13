# 光影 · 视频分享平台后端

Spring Boot 3.3 / Java 17。后端已覆盖认证与刷新令牌、视频与上传、互动、动态/社交、通知、管理审核、账号注销、幂等写入、SSE、STOMP 和对象存储适配。

## 本地开发

默认 profile 使用 H2、内存缓存和 `backend/data` 本地文件存储，首次启动无需外部服务：

```powershell
cd backend
mvn spring-boot:run
```

API 根路径为 `/api/v1`，健康检查为 `/actuator/health`，OpenAPI 页面为 `/swagger-ui.html`。开发种子账号密码均为 `123456`：`admin`、`moderator`、`laowang`、`newbie`。

## 数据库与生产配置

Flyway 迁移位于 `src/main/resources/db/migration`：`V1` 基础模型、`V2` 平台业务表、`V3` 上传元数据与索引、`V4` 注销/幂等/字幕/弹幕/投币扩展表。生产环境设置 `SPRING_PROFILES_ACTIVE=prod`，并提供 MySQL、Redis、MinIO、JWT RS256 密钥、`DATA_ENCRYPTION_KEY_BASE64` 和 `STORAGE_SIGNING_SECRET` 等变量；生产 Redis 认证会话不可用时会 fail-closed。

完整依赖可由仓库根目录的 `docker compose --env-file .env up --build` 启动。测试：

```powershell
mvn test
```
