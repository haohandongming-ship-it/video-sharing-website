# 光影 · 视频分享平台前端镜像
#
# 基础镜像与包源默认走国内源，可用构建参数覆盖：
#   --build-arg NODE_IMAGE=node:22-alpine --build-arg NPM_REGISTRY=https://registry.npmjs.org
ARG NODE_IMAGE=docker.m.daocloud.io/library/node:22-alpine
ARG NGINX_IMAGE=docker.m.daocloud.io/library/nginx:1.27-alpine

# ---------------------------------------------------------------- 构建阶段
FROM ${NODE_IMAGE} AS build
WORKDIR /build

# pnpm 自身的下载与依赖安装都指向国内 registry，避免构建期长时间卡在公网。
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY} \
    npm_config_registry=${NPM_REGISTRY}

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm config set registry "$NPM_REGISTRY" && pnpm install --frozen-lockfile
COPY . .

ARG VITE_USE_MOCK=false
ENV VITE_USE_MOCK=${VITE_USE_MOCK}
RUN pnpm build

# ---------------------------------------------------------------- 运行阶段
FROM ${NGINX_IMAGE}
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/dist /usr/share/nginx/html
EXPOSE 80
