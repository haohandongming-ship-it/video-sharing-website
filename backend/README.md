# Video Platform Backend

Spring Boot 3.3 / Java 17 后端基线，已实现统一响应与错误码、Flyway 初始数据模型、RS256 Access Token、Refresh Token Cookie 轮换/复用检测，以及视频详情、检索与属主编辑/软删除接口。

默认 profile 使用内存 H2，便于首次启动；生产环境使用 `SPRING_PROFILES_ACTIVE=prod` 并提供 `MYSQL_URL`、`MYSQL_USER`、`MYSQL_PASSWORD`、`REDIS_HOST`、`REDIS_PASSWORD`。Redis 是认证会话的必要依赖。

```powershell
cd backend
mvn spring-boot:run
```

健康检查：`GET /actuator/health`。API 根路径为 `/api/v1`。
