# 光影 · 视频分享平台后端镜像（Java 21 / Spring Boot 4）
#
# 基础镜像默认走国内镜像代理，国内网络无需额外配置即可构建；
# 需要回退官方镜像时传入：--build-arg MAVEN_IMAGE=maven:3.9.11-eclipse-temurin-21-alpine
ARG MAVEN_IMAGE=docker.m.daocloud.io/library/maven:3.9.11-eclipse-temurin-21-alpine
# 运行镜像。若追求 glibc 而非 musl（超高并发下线程调度更可控），可改为
# docker.m.daocloud.io/library/eclipse-temurin:21-jre-jammy
ARG JRE_IMAGE=docker.m.daocloud.io/library/eclipse-temurin:21-jre-alpine

# ---------------------------------------------------------------- 构建阶段
FROM ${MAVEN_IMAGE} AS build
WORKDIR /build

# Maven 依赖同样走国内源；传空值回退 Maven Central。
ARG MAVEN_MIRROR_URL=https://maven.aliyun.com/repository/public
COPY docker/settings.xml ./docker/settings.xml
RUN if [ -n "$MAVEN_MIRROR_URL" ]; then \
        mkdir -p /root/.m2 && \
        sed "s|@MAVEN_MIRROR_URL@|$MAVEN_MIRROR_URL|" docker/settings.xml > /root/.m2/settings.xml; \
    fi

# pom 单独成层：源码变动时依赖缓存依然命中。
COPY pom.xml .
RUN mvn -B -q -DskipTests dependency:go-offline

COPY src ./src
RUN mvn -B -q -DskipTests package

# ---------------------------------------------------------------- 运行阶段
FROM ${JRE_IMAGE}
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /build/target/video-platform-*.jar app.jar
RUN mkdir -p /app/data && chown -R app:app /app
USER app
EXPOSE 8080

# 健康检查覆盖 /actuator/health（compose 的 depends_on 可直接使用）。
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD wget -q -O - http://127.0.0.1:8080/actuator/health || exit 1

# -XX:MaxRAMPercentage      容器内按内存上限的 75% 设置堆
# -XX:+ExitOnOutOfMemoryError  OOM 时快速失败，交给编排层重启
# -XX:+AutoCreateSharedArchive JDK 19+ 的 CDS 自动归档：首次启动生成，后续启动加速类加载
ENTRYPOINT ["java", \
    "-XX:MaxRAMPercentage=75", \
    "-XX:+ExitOnOutOfMemoryError", \
    "-XX:+AutoCreateSharedArchive", \
    "-XX:SharedArchiveFile=/app/app.jsa", \
    "-jar", "/app/app.jar"]
