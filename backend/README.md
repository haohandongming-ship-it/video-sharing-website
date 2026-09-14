# 光影 · 视频分享平台后端

**Java 21 (LTS) + Spring Boot 4.1.1**，构建在 Spring Framework 7、Spring Security 7、
Hibernate 7、Jackson 3、Flyway 12、Tomcat 11 之上。功能覆盖认证与刷新令牌、视频与上传、
互动、动态/社交、通知、管理审核、账号注销、幂等写入、SSE、STOMP 和对象存储适配。

## 本地开发

默认 profile 使用 H2、本地文件存储，首次启动无需外部服务：

```bash
cd backend
mvn spring-boot:run
```

API 根路径为 `/api/v1`，健康检查 `/actuator/health`，OpenAPI 页面 `/swagger-ui.html`。
开发种子账号密码均为 `123456`：`admin`、`moderator`、`laowang`、`newbie`。

要求 JDK 21（`mvn -version` 中的 Java 版本需为 21）。

## Java 21 与性能设计

| 手段 | 说明 |
| --- | --- |
| 虚拟线程 | `spring.threads.virtual.enabled=true`，请求处理不再受平台线程池排队限制；对 JDBC/MinIO 阻塞 IO 和视频流式响应收益明显。 |
| SQL 级分页 | 目录、榜单、相关推荐、短视频、收藏、历史、创作者内容、后台队列全部下推到 SQL 排序分页，不再 `findAll()` 全表加载后在内存里过滤排序。 |
| 批量视图装配 | `ViewFactory.videoSummaries` 先收集整页主键，再用固定条数的 `IN` 批量查询取回作者/分区/点赞/收藏/订阅；单页查询数与页大小无关（见 `QueryCountGuardTest`）。 |
| 有界缓存 | 播放去重、短信限流、刷新令牌降级存储全部换为 Caffeine 有界缓存，替代只增不减的 `ConcurrentHashMap`；分类与推荐创作者走 Spring Cache（10 分钟 / 60 秒 TTL）。 |
| 聚合查询 | 用户主页 9 条 SQL 合并为 1 条标量子查询；管理概览 14 天趋势由 42 条 count 收敛为 3 条分组聚合。 |
| 写放大控制 | `Video` 实体启用 `@DynamicUpdate`，热点计数器表只更新真正变化的列。 |
| 连接与 JPA | HikariCP 池大小/超时、Hibernate 批处理与 `in_clause_parameter_padding`、Tomcat 连接数与响应压缩均在 `application.yml` 中显式配置。 |
| 现代语法 | record / sealed interface + switch 模式匹配（HTTP Range 解析）、text block（SQL）、`Math.clamp`、`List.getFirst()`、`instanceof` 模式等。 |

## 数据库与生产配置

Flyway 迁移位于 `src/main/resources/db/migration`：`V1` 基础模型、`V2` 平台业务表、
`V3` 上传元数据与索引、`V4` 注销/幂等/字幕/弹幕/投币扩展表、`V5` 上传媒体元数据。

生产环境设置 `SPRING_PROFILES_ACTIVE=prod`，并提供 MySQL、Redis、MinIO、JWT RS256 密钥、
`DATA_ENCRYPTION_KEY_BASE64` 和 `STORAGE_SIGNING_SECRET` 等变量；生产 Redis 认证会话不可用时
fail-closed。可通过 `DB_POOL_MAX_SIZE` / `DB_POOL_MIN_IDLE` 调整连接池。

## Docker 构建（国内源）

基础镜像与构建期依赖默认全部走国内源，国内网络无需额外配置：

| 用途 | 默认源 | 覆盖方式 |
| --- | --- | --- |
| 运行时/构建基础镜像 | `docker.m.daocloud.io`（DaoCloud 公共镜像代理） | `.env` 中 `DOCKER_REGISTRY`、`MAVEN_IMAGE`、`JRE_IMAGE` |
| Maven 依赖 | `https://maven.aliyun.com/repository/public` | `MAVEN_MIRROR_URL`（留空回退 Maven Central） |

```bash
# 仓库根目录
docker compose --env-file .env up --build

# 只构建后端，并回退到官方镜像源
docker build --build-arg MAVEN_IMAGE=maven:3.9.11-eclipse-temurin-21-alpine \
             --build-arg JRE_IMAGE=eclipse-temurin:21-jre-alpine ./backend
```

运行镜像默认使用 Alpine（musl）。若在高并发下希望使用 glibc，把 `JRE_IMAGE` 换成
`docker.m.daocloud.io/library/eclipse-temurin:21-jre-jammy`。

## 测试

```bash
cd backend
mvn test
```

- `PlatformIntegrationTest`：13 项接口与权限集成测试。
- `QueryCountGuardTest`：性能护栏 —— 统计 JDBC 语句条数，断言列表接口的查询数与页大小无关，
  并覆盖重写后的榜单/短视频/关注流/后台队列读取路径。
