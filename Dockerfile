# Caddy 镜像：内含前端构建产物 + 反代 /api。
# build context 为项目根（compose 指定 dockerfile: Dockerfile）。
# 第一阶段 node 构建前端，第二阶段 caddy 托管 dist 并反代后端。

FROM node:24-alpine AS build
WORKDIR /app
ENV CI=true
RUN corepack enable
# pnpm-workspace.yaml 必须先进来：内含 esbuild 构建脚本审批（allowBuilds），
# frozen-lockfile 下缺它 pnpm 会以 ERR_PNPM_IGNORED_BUILDS 拒绝安装。
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm run build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv/frontend
EXPOSE 80 443
