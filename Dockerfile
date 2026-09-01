# Caddy 镜像：内含前端构建产物 + 反代 /api。
# build context 为项目根（compose 指定 dockerfile: Dockerfile）。
# 第一阶段 node 构建前端，第二阶段 caddy 托管 dist 并反代后端。

FROM node:24-alpine AS build
WORKDIR /app
ENV CI=true
RUN corepack enable
# workspace 清单与根 lockfile 必须先进来（frozen-lockfile 要求全部在场）；
# pnpm-workspace.yaml 内含 esbuild 构建脚本审批（allowBuilds），
# frozen-lockfile 下缺它 pnpm 会以 ERR_PNPM_IGNORED_BUILDS 拒绝安装。
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY frontend/package.json ./frontend/
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
# 只装 frontend(+shared)依赖:backend 的 better-sqlite3 是原生模块且 musl 无预编译,
# caddy 镜像用不到它,全量 install 会在无编译工具的本阶段失败(票 02)。
# npmmirror:corepack 下 pnpm 与包安装全走国内镜像——registry.npmjs.org 在构建网络内
# 被 SNI 掐(TLS 握手前 ECONNRESET,bridge/host 栈皆断,2026-09-01);npmmirror 是 npmjs
# 全量镜像,tarball 同源,frozen-lockfile 的 integrity 校验不受影响。install 侧用
# --registry 旗标:NPM_CONFIG_REGISTRY 环境变量对 pnpm 11 不生效(实测 590 请求仍打
# npmjs),CLI 旗标才是 pnpm 确定吃到的路径。
RUN COREPACK_NPM_REGISTRY=https://registry.npmmirror.com \
    pnpm --filter chrome-tab-frontend... install --frozen-lockfile --registry=https://registry.npmmirror.com
COPY frontend/ ./frontend/
COPY shared/ ./shared/
RUN pnpm --filter chrome-tab-frontend run build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/dist /srv/frontend
EXPOSE 80 443
