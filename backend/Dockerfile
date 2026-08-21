# Node 后端(票 02:Hono + better-sqlite3 WAL + Kysely;Java 版由本分支替换,清除归票 13)。
# build context = 仓库根(compose 以 dockerfile: backend/Dockerfile 指定)——
# pnpm workspace 的 lockfile 与全部包清单必须在 context 内,frozen-lockfile 才能通过。
# base 阶段共享工具链与 workspace 清单;build 阶段装全量依赖(dev 含 esbuild)并打包,
# prod-deps 阶段只装生产依赖;运行阶段仅 node + 打包产物 + 生产 node_modules——
# 单测/契约测试依赖不进镜像(票 02 验收项)。

FROM node:24-alpine AS base
WORKDIR /app
# python3/make/g++:better-sqlite3 无匹配 musl 预编译时兜底 node-gyp 编译(research/01 风险注记)
RUN corepack enable && apk add --no-cache python3 make g++
# workspace 清单与根 lockfile 必须先进来(frozen-lockfile 要求全部在场,同根 Dockerfile)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY frontend/package.json ./frontend/
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/

FROM base AS build
RUN pnpm --filter chrome-tab-backend... install --frozen-lockfile
COPY backend/ ./backend/
COPY shared/ ./shared/
RUN pnpm --filter chrome-tab-backend run build

FROM base AS prod-deps
RUN pnpm --filter chrome-tab-backend... install --frozen-lockfile --prod

FROM node:24-alpine
WORKDIR /app/backend
# TZ=UTC:spec 定版不变量——config_version LWW 排序依赖容器保持 UTC(alpine 默认即 UTC,显式钉死)
ENV NODE_ENV=production TZ=UTC
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
EXPOSE 8080
# --expose-gc:容器内可复现 RSS 实测(/debug/gc,票 12 服务器验收用)
CMD ["node", "--expose-gc", "dist/index.js"]
