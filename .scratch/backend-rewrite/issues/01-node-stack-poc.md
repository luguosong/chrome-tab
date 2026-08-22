# 01 Node 栈选型与内存 PoC

Type: research
Status: resolved

## Question

Node 后端栈的具体组合与实测内存:Web 框架(Fastify vs Hono vs Express)、DB 层(better-sqlite3 + Drizzle vs Kysely vs Prisma)、JWT/bcrypt 鉴权件、定时任务件(替代 Spring Scheduler,node-cron 一类)。选出一组推荐组合,并用**最小 CRUD + JWT auth + 一条定时任务**的 PoC 实测 RSS——目标:后端(内嵌 SQLite)整机 ≤ ~100 MiB,替代现状 Java 136 MiB + MySQL 68 MiB = 204 MiB。产出对比表 + 推荐 + 实测数据(实测失败则文档数据并标注未实测)。

## Answer

- **推荐组合**:Hono 4 + @hono/node-server + better-sqlite3(WAL)+ **Kysely** + jose + bcryptjs + node-cron v4。实测(强制 GC 后 VmRSS,两趟):Kysely 全栈 **101 MiB**,部署时 esbuild 打包可到 **87 MiB**,裸 better-sqlite3 同栈 90 MiB —— 均达标「≤ ~100 MiB」,替代现状 204 MiB。重大实测发现:**drizzle-orm ESM 入口 import 即 +150 MiB**(CJS/打包可规避),Prisma 7 即便无 Rust 引擎也 125 MiB 爆预算,双双否决;Express/Fastify 内存与生态均无优势于 Hono。
- **单镜像变体**:Hono `serveStatic` + SPA fallback 托管前端 dist,与纯 API 形态 RSS 差 ≈ 0(实测噪声内);推荐组合 prod 依赖 34 MB,估镜像 ~90-110 MB(未实际 build,估算)。caddy 留做 TLS 不动。
- **类型共享布局**:pnpm workspace + `shared/` 包(仅 TS 类型/常量,双端直引 TS 源零构建),frontend 本就 pnpm,详见 findings。

Findings(含完整对比表、实测矩阵、风险注记、引用):[../research/01-node-stack-poc.md](../research/01-node-stack-poc.md)
