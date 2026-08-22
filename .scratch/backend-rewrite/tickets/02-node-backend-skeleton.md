# 02 — Node 后端骨架(Hono + better-sqlite3 WAL + Kysely)

**What to build:** 在 feature branch 上,`backend/` 路径下竖起 Node 后端骨架:Hono 4 + @hono/node-server + better-sqlite3(开启 WAL)+ Kysely + bcryptjs + node-cron v4(组合以 spec 引用的栈实测票定版为准)。沿用 `backend/` 路径使 compose build context 零改动;新 Dockerfile,单测/契约测试依赖不进生产镜像。caddy 与根 Dockerfile 的 TLS/反代层零改动。

**Blocked by:** 01 — pnpm workspace 化。

**Status:** done

- [x] Node 应用可本地启动并响应任一探针路由(仅证明骨架活着,无业务端点)
- [x] 生产镜像构建成功,镜像内不含测试依赖
- [x] 强制 GC 后全栈或打包路径 RSS 实测在 ~100 MiB 档(spec 引用的实测复现)
- [x] compose 用新镜像可起容器,caddy 反代链路不破

## Comments

- 2026-08-21 实现完成(branch `backend-rewrite`)。六件套落地:`backend/src/{app,db,index,password}.ts` + colocated vitest(`app.request()` 免端口 seam,内存 SQLite fixture)。端点仅 `/healthz`(含 `select 1` 连通探测)与 `/debug/gc`(RSS 实测辅佐,需 `--expose-gc`);无任何 `/api` 业务端点。`password.ts`(bcryptjs cost 10)为票 04 的种子,测试覆盖 roundtrip。
- **RSS 实测**(强制双 GC 后 VmRSS,`scripts/measure-rss.mjs` 复现 research/01 方法):esbuild 打包(部署路径)宿主 77.5 MiB、容器内 80.4 MiB,达标;tsx 源码直跑 121.4 MiB——含 tsx 装载器自身开销,仅 dev 形态不进部署。bcryptjs 因尚无消费方不在 bundle 图内(research 单包探针 +1.5 MiB,票 04 有登录流量后复测)。
- **两处与票面表述的偏差**(均为票 01 workspace 化的必然物理结果,非决策变更):① Node Dockerfile 的 build context 须为仓库根(workspace lockfile 与全部包清单在场才能 frozen-lockfile),新设 `docker-compose.node.yml`(caddy+backend 无 mysql,caddy 服务定义与 prod 零差异,端口映射 8081/8443 避冲突)供票 02/11 复用,`docker-compose.prod.yml` 本票未动、切换日(票 12)按此形态改写;② 根 Dockerfile install 行加 `--filter chrome-tab-frontend...`——caddy 镜像用不到 backend 依赖,且 musl 无 better-sqlite3 预编译(research/01 风险注记实测应验),全量 install 会在无编译工具的 node 阶段失败;TLS/反代层零改动。
- 镜像内 `node_modules` 仅六件套,vitest/esbuild/typescript/tsx 零残留;镜像 284 MB(node:24-alpine 基镜像即 ~248 MB,应用内容 ~35 MB,其中 better-sqlite3 26 MB 含多平台 prebuild 残留,可后续 prune,非验收项)。
- `@hono/node-server` 装到 v2.1(研究实测为 v1 线;`serve` API 同形,组合 RSS 已复验)。node-cron 骨架期挂每日 WAL checkpoint 占位(防 WAL 增长),票 06/09 真实任务落位后归并。`backend/.dockerignore` 因 context 移根已失活,清除归票 13。
- 验证:本地起服 curl 双路由 200;`docker compose -f docker-compose.node.yml up` 后——容器网络内 `wget backend:8080/healthz` 200、经 caddy TLS `/api/*` 回 Hono 404 文本(证明反代打到 Node 而非静态兜底)、`/` 静态 200;frontend 197 + backend 2 测试全绿,双端 typecheck 通过。prod-deps 阶段构建首跑曾因 registry 网络抖动失败一次,重试即过(未复现)。
- code-review 双轴(Standards/Spec)后修两处:Dockerfile 提共享 base 阶段消两阶段重复;运行阶段显式 `ENV TZ=UTC` 钉死 spec「Node 容器保持 UTC」不变量。跟踪项:bundled RSS 未含 bcryptjs(票 04 有登录流量后复测);spec L51「context 零改动」为滞后文本,票 12 改写 prod compose 时收口。
