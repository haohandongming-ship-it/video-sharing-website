# 项目测试与修复记录

## 2026-09-14 · Java 21 + Spring Boot 4.1.1 升级

环境：Linux、JDK 21.0.12、Maven 3.9.16、Spring Boot 4.1.1（Spring Framework 7.0.9、Spring Security 7.1.1、Hibernate 7.4.5、Jackson 3.1.5、Flyway 12.4.0、Tomcat 11.0.24）、H2 内存库、dev profile。

### 框架与工具链

| 项 | 升级前 | 升级后 |
| --- | --- | --- |
| Java | 17（release 17） | 21 LTS（release 21） |
| Spring Boot | 3.3.4 | 4.1.1 |
| springdoc-openapi | 2.6.0 | 3.1.1 |
| jjwt | 0.12.6 | 0.13.0 |
| JSON 实现 | Jackson 2 | Jackson 3（`tools.jackson`） |

迁移点：MockMvc 测试注解迁到 `org.springframework.boot.webmvc.test.autoconfigure` 并补 `spring-boot-starter-webmvc-test` 依赖；`UserDetailsServiceAutoConfiguration` 排除项迁到 `org.springframework.boot.security.autoconfigure`；`ObjectMapper`/`TypeReference` 换 Jackson 3 包名（不再有受检异常）；测试里 `JsonNode.asText()` 换成 `asString()`。

### 性能与代码质量

- **虚拟线程**：`spring.threads.virtual.enabled=true`，阻塞式 JDBC/MinIO 调用不再占用平台线程。
- **消除 N+1**：列表渲染改为先收集整页主键、再用固定条数批量查询取回作者/认证/粉丝数/分区/点赞/收藏/订阅。改造前 20 条一页约 120 次往返，现在固定约 7~10 次。
- **SQL 级分页**：目录、榜单、相关推荐、短视频、收藏、历史、创作者内容、后台队列由 `findAll()` + 内存排序改为 SQL 过滤/排序/分页（榜单分数用 H2 与 MySQL 都支持的 `LN`/`EXP`/`TIMESTAMPDIFF` 表达）。
- **聚合替代循环**：用户主页 9 条 SQL → 1 条标量子查询；管理概览 14 天趋势 42 条 count → 3 条分组聚合；创作中心趋势里重复 30 次的粉丝数查询 → 1 次。
- **有界缓存**：播放去重、短信限流、刷新令牌降级存储换成 Caffeine 有界缓存；分类与推荐创作者接入 Spring Cache。
- **写放大**：`Video` 加 `@DynamicUpdate`；HikariCP/Hibernate 批处理/响应压缩/Tomcat 连接数在配置中显式化。
- **语法现代化**：record、sealed interface + switch 模式匹配（HTTP Range 解析）、text block SQL、`Math.clamp`、`List.getFirst()`、`instanceof` 模式、统一分页 `PageResult` 取代 5 份重复实现。

### 发现并修复的真实缺陷

1. `AdminService.overview` 用 `DATEDIFF('SECOND', started_at, completed_at)`，该写法只在 H2 成立，MySQL 会直接报错 —— 改为两者通用的 `TIMESTAMPDIFF(SECOND, …)`。
2. 趋势聚合的列别名 `day` 被 H2 解析为 INTERVAL 限定符（`Data conversion error converting "DATE to INTERVAL DAY"`）—— 别名改为 `stat_day` 并按序号取值。
3. 播放去重、短信限流、刷新令牌的降级 Map 只增不减，属于长期运行的内存泄漏 —— 改为带容量与 TTL 的 Caffeine 缓存。
4. 计数器回写在托管实体上触发整行 UPDATE，会覆盖并发事务刚写入的列 —— 加 `@DynamicUpdate` 收敛为只写变化列。

### 性能与开销实测

升级前后的 A/B 压测数据（SQL 条数、RPS、p95、每请求 CPU、内存与线程、端到端传输字节、
前端产物体积）见 **[性能与开销测试报告](./PERFORMANCE_REPORT.md)**。核心结论：19 个端点单请求
SQL 合计 842 → 103（−87.8%），榜单吞吐 +52%~+65%，列表接口下行流量 −81%~−89%，
200 并发下 OS 线程数 −65%。

### 基于压测的第二轮优化

按性能报告结论做了一轮优化并复测（2 万视频数据集）：补齐 13 个缺失索引、排序键去 `COALESCE`
以走索引、个人内容库改 `EXISTS` 半连接、14 处分页补稳定并列键、压缩阈值降到 512B、
JWT 黑名单查询加 Redis 失败熔断、前端把 Mock 层移出生产产物。详见
**[性能与开销测试报告](./PERFORMANCE_REPORT.md) 第 12 节**。

### Docker 国内源

基础镜像与所有运行时镜像默认走 `docker.m.daocloud.io`，Maven 依赖走阿里云公共仓库，npm 走 npmmirror；全部可通过 `.env` 变量覆盖回官方源。镜像标签已在镜像代理上逐个校验存在（maven/temurin/node/nginx/mysql/redis/minio/rocketmq）。

### 验证方式

- `backend`：`mvn clean package` 通过，`Tests run: 18, Failures: 0, Errors: 0`。
  - `PlatformIntegrationTest`：13 项，原有断言全部保留并通过。
  - `QueryCountGuardTest`：2 项。其中 `videoListQueryCountIsIndependentOfPageSize` 通过包装 DataSource 统计 JDBC 语句条数，断言页大小 5 与 40 的查询条数完全相等且落在 5~15 区间；一旦重新引入 N+1 会立即失败。
  - `EndpointCostReportTest`：3 项。逐端点输出 SQL 条数与页大小缩放曲线到 `target/perf/*.tsv`，并冒烟覆盖重写后的读取路径。
- 两个测试类共用同一份上下文配置（`CountingDataSourceConfiguration`），Spring 测试上下文只启动一次：测试耗时从约 29 秒降到约 13 秒，并消除了多个上下文各自创建 Lettuce 客户端带来的关闭期日志噪音。
- 打包产物 `target/video-platform-0.1.0-SNAPSHOT.jar` 可直接启动；`/actuator/health` 返回 `UP`（含 liveness/readiness 探针），分类、推荐、登录、榜单、短视频接口返回与升级前一致的 JSON 契约。
- **未验证**：Docker 镜像构建与 compose 启动（当前环境没有 docker daemon，镜像标签仅做了远程校验）；MySQL/Redis/MinIO 生产链路；前端构建与浏览器验收。

---

## 2026-09-13 · 前后端联调修复记录

日期：2026-09-13。环境：Windows、Node 22、Java 24（编译目标 Java 17）、Spring Boot dev profile、内存 H2、本地文件存储。

## 已修复

| 模块 | 问题与处理 |
| --- | --- |
| HTTP 客户端 | 空响应、HTML 网关响应和无业务错误码的 HTTP 失败不再被当作成功；刷新后仍失败会抛错并触发会话过期；重试和响应读取保留超时控制。 |
| 上传直传 | 独立 PUT 请求不再向对象存储发送平台 Bearer Token 或 Cookie，读取真实 ETag，检查失败状态。 |
| 播放器 | 真实模式下停止自动替换为演示视频；补上原生媒体错误提示；识别带查询参数的 MP4/WebM/MOV/M4V 地址。 |
| 视频访问 | 私密、待审核、已删除视频不能通过播放、评论及互动接口绕过访问限制；支持不公开列出视频凭链接访问；保留作者和管理员/审核员权限。 |
| 游客互动 | 开放游客播放计数和公开评论回复读取，写入接口仍要求来源请求头。 |
| 收藏 | 校验收藏夹归属；公开用户收藏排除私密视频；批量移出收藏调用真实接口并刷新缓存，失败项目保留选择以便重试。 |
| 评论 | 删除同步视频评论数和楼层回复数；删除的评论不可继续点赞或回复；回复校验视频归属，过滤后为空的内容会拒绝。 |
| 动态 | 关注流按实际关注关系筛选；转发返回原动态并更新转发数；个人动态分页返回正确总数。 |
| 搜索 | 支持标签命中、时长筛选和发布时间筛选；视频标签更新去除空白和重复值。 |
| 分页与参数 | 修复多个列表的负数分页、负数游标及游标溢出；参数类型错误与损坏 JSON 返回 400。 |
| 上传状态 | 已取消或已完成任务不再允许再次完成/上传；检查分片编号、标题和分区；统一 SHA 大小写；秒传视频进入审核队列。 |
| 管理设置 | 默认上传大小和允许扩展名与实际上传规则对齐。 |

## 验证方式

- `backend`: `mvn test -q`，12 项集成测试，包含原有 3 项及新增 9 项。
- `frontend`: `npm run verify`，类型检查、ESLint、Vitest（7 个测试文件、147 个测试）和生产构建均通过。新增 HTTP/直传回归与收藏持久化回归。
- 真实浏览器连接本地后端：检查首页目录、演示视频播放、内置创作者账号登录、刷新后会话恢复、收藏数据、私信会话读取、创作者中心加载。抽查浏览器错误日志为空。
- `git diff --check`。

浏览器检查是上述路径的冒烟验证，不代表所有按钮、移动端、所有浏览器或上传全流程已经验收。后端测试使用 H2，没有替代 MySQL/Redis/MinIO 的生产集成测试。测试仍有少量 React `act(...)` 警告；构建仍提示 Mock 模块同时被静态和动态导入，但不影响构建结果。

## 仍存在的功能缺口（未完成）

以下是源码中明确存在的模拟或缺失实现，不能因测试通过而视为可上线：

1. **真实媒体处理**：`UploadService.progress` 根据轮询增加进度，最后设置统一演示 HLS，未实际转码上传源文件；本机也没有发现 FFmpeg/FFprobe。源文件播放、封面生成、多清晰度、真实下载仍需要完整媒体流水线。
2. **生产登录集成**：短信接口只生成并缓存验证码，没有短信供应商发送调用；OAuth 地址为占位实现；图形验证码也非完整校验链路。需要真实供应商配置及回调实现。
3. **观看历史管理**：页面清空、单条移除和暂停记录仍以本地页面状态实现，未完成服务端操作；按观看时间分组缺少后端观看时间字段。
4. **播放列表与消息附件**：加入播放列表仍只显示提示，缺少写入接口；消息附件未实现。个人私信入口还需验证新会话创建闭环。
5. **统计与榜单**：创作者趋势/完播率和管理看板部分为演示计算，榜单类型/周期还没有完整统计语义。
6. **生产及负载验证**：MySQL、Redis、MinIO、真实大文件上传、并发写入、长时间会话、移动端响应式和生产部署未执行验收。MinIO 合并的完整 SHA 校验、大文件前端哈希内存占用也需继续处理。

默认 dev profile 为内存数据库，重启后会重建数据；前端显示的“持久化保存”不能理解为开发环境重启后仍保存。当前结果是已列问题的修复与回归，**不是“所有 bug 和所有功能已完成”的结论**。
