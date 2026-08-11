# Caddy 镜像：内含前端构建产物 + 反代 /api。
# build context 为项目根（compose 指定 dockerfile: Dockerfile）。
# 第一阶段 node 构建前端，第二阶段 caddy 托管 dist 并反代后端。

FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv/frontend
EXPOSE 80 443
