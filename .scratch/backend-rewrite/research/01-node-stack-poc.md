# 01 Node 栈选型与内存 PoC — findings

Date: 2026-08-21 · Node v24.19.0 / npm 11.17.0(WSL2 x64,32 核)
PoC 目录:`/tmp/poc-node-stack`(主变体)、`/tmp/poc-prisma`(Prisma)、`/tmp/poc-prod`(推荐组合 prod 依赖体积)——均未触碰主工作区。
方法:每变体启动 → register/login(bcrypt cost 10 + JWT)+ 5×CRUD + 未授权探测 → `--expose-gc` 下强制双 GC(`/debug/gc`)→ 稳定 5s 后读 `/proc/<pid>/status` VmRSS。每变体 2 趟,方差 < 2%。

## 结论(TL;DR)

**推荐:Hono 4 + @hono/node-server + better-sqlite3(WAL)+ Kysely + jose + bcryptjs + node-cron v4,部署时 esbuild 打包。**
- 打包形态实测 **87 MiB**(hono+drizzle 打包变体,同栈最低);Kysely 源码直跑 **101 MiB**;裸 better-sqlite3 同栈 **90 MiB**。均远低于现状 Java 136 + MySQL 68 = 204 MiB,达标「整机 ≤ ~100 MiB」。
- **重大实测发现:drizzle-orm 的 ESM 入口有内存爆炸**(import 即 +150 MiB,GC 后仍驻留);CJS 解析或 esbuild 打包可完全规避。Kysely ESM 无此问题。

## 实测数据(VmRSS 稳态,两趟)

全部为完整栈:SQLite(WAL)+ bcrypt 注册/登录 + JWT 签发/校验 + node-cron 每分钟任务 + CRUD 流量。

| 变体 | pass1 | pass2 | 备注 |
|---|---|---|---|
| 裸 Node(setInterval) | 47.2 MB | — | 底座 |
| Express 5.2.1 + drizzle(ESM)全栈 | 288.6 MB | 287.3 MB | 被下面 drizzle ESM 问题拖爆 |
| Fastify 5.12.1 + drizzle(ESM)全栈 | 294.0 MB | 293.9 MB | 同上 |
| Hono 4.13.3 + drizzle(ESM)全栈 | 237.3 MB | 237.7 MB | 同上 |
| **Hono + drizzle(ESM)+ esbuild 打包** | **86.7 MB** | **87.4 MB** | 最低;`--external:better-sqlite3` |
| Hono + drizzle(CJS require 解析) | 95.8 MB | 96.6 MB | createRequire 即可规避 |
| Hono + 裸 better-sqlite3(预编译语句) | 91.1 MB | 89.8 MB | 无 ORM 下限 |
| Hono + Kysely 0.29.5 全栈 | 101.6 MB | 101.1 MB | ESM 直跑,无坑 |
| Hono + Prisma 7.9.1(driver adapter,无 Rust 引擎) | 125.1 MB | 125.7 MB | 单独即爆 100 MiB 预算 |
| Hono + drizzle(ESM)+ serveStatic 静态托管前端 | 237.7 MB | 237.2 MB | 与不托管静态差 ≈ 0(噪声内) |

单包 import 探针(GC 后 RSS):hono 50.3 · bcryptjs 48.7 · better-sqlite3 48.2 · node-cron 52.6 · jsonwebtoken 60.2 · jose 60.7 · express 66.4 · kysely 68.2 · fastify 69.9 · drizzle(CJS)61.2 · **drizzle(ESM `drizzle-orm/better-sqlite3`)200~208 · drizzle(ESM 根包)137**。

bcryptjs cost 10 登录(含 HTTP 往返):**138~165 ms**,个位数用户无感。未授权请求全部正确 401。

## 关键发现:drizzle-orm ESM 入口内存爆炸

- `import 'drizzle-orm/better-sqlite3'`(ESM)单次 import 即 ~200 MB RSS,强制双 GC 后仍驻留(retained);无 `--expose-gc` 时同样(275 MB),非 GC 惰性假象。
- 同包 **CJS 解析(require)仅 61 MB**,kysely(同为 ESM 纯 TS)68 MB 正常 → 问题锁定在 drizzle 的 `dist/esm` 构建产物/模块图,机制未根因(疑似其 ESM barrel re-export 图在 V8 的编译驻留)。
- 影响面:任何按 ESM 方式加载 drizzle 的路径(直接 ESM import、tsx 直跑源码若走 ESM 解析)都会中招。规避:① 全程 CJS(`createRequire`/`.cjs`);② esbuild 打包(实测 87 MB,最优);③ 换 Kysely。
- 结论:**要么打包部署 drizzle,要么直接选 Kysely**。本仓建议后者,少一个「谁忘了打包谁爆内存」的暗雷。

## 对比表(实测 + 文档数据)

### Web 框架(RSS 为 import 探针,含 47 MB 底座)

| | Express 5.2.1 | Fastify 5.12.1 | Hono 4.13.3 |
|---|---|---|---|
| 实测 import RSS | 66.4 MB | 69.9 MB | **50.3 MB** |
| 直接依赖 | 27 个 | 16 个 | **0 个**(core 零依赖) |
| 内置校验 | 无(JSON Schema 需自配) | Ajv + fast-json-stringify | hono/validator(Standard Schema/Zod/Valibot/ArkType) |
| TS | DefinitelyTyped(非第一方) | 第一方 | 第一方,RPC 类型共享 |
| Node 要求 | ≥18 | ≥20(docs 口径,registry 无 engines) | core ≥16.9 / node-server ≥20 |

来源:Express v5.0.0 release、Fastify Validation docs、Hono validation guide(见文末引用);依赖数为 npm registry 实查。三方均无官方 RSS 声明,以上为实测。

### DB 层

| | better-sqlite3 13.0.3 | + Drizzle 0.45.2 | Kysely 0.29.5 | Prisma 7.9.1 |
|---|---|---|---|---|
| 形态 | native addon(预编译二进制) | 纯 TS ORM,零运行时依赖 | 纯 TS query builder,零运行时依赖 | v7 默认无 Rust 引擎,需 driver adapter(`@prisma/adapter-better-sqlite3`,内钉 better-sqlite3 ^12) |
| 实测全栈 RSS(Hono) | 90 MB | ESM 237 MB / CJS 96 MB / 打包 87 MB | **101 MB** | **125 MB** |
| 安装体积 | —(27 MB,含各平台 prebuild) | —(17 MB) | 3.4 MB | prisma CLI 43.8 MB + @prisma/client 78 MB(unpacked) |
| 迁移 | —(手写 SQL) | drizzle-kit 生成 SQL(dev-only) | 内置 Migration 类 API | prisma migrate |

### 鉴权 / 定时(文档数据 + fork 调研)

| 件 | 选择 | 依据 |
|---|---|---|
| JWT | **jose 6.2.9**(实测 import 60.7 MB ≈ jsonwebtoken 60.2 MB) | 零依赖、tree-shakeable ESM、2026-08 仍活跃发布;jsonwebtoken 9.0.3 10 个直接依赖但 HS256 两者皆可,内存无差 |
| bcrypt | **bcryptjs 3.0.3**(纯 JS,实测登录 138~165 ms @ cost 10) | 零依赖免编译;native `bcrypt` 6.0.0 走 node-gyp-build prebuilds,Node 24 ABI 预编译可用性未验证(风险项) |
| 定时 | **node-cron 4.6.0** | 2026-07 活跃;v4 为 TS 重写;支持时区/Quartz 扩展;不持久化状态——进程不在即跳过不补跑,与 Spring @Scheduled 语义一致。备选:`cron` 4.4.0(依赖 luxon);BullMQ 需 Redis 排除;Bree worker 线程对几条 cron 属杀鸡用牛刀 |

## 单镜像变体(静态托管 + API 同进程)

- **内存增量 ≈ 0**:hono + drizzle 栈加 `serveStatic` + SPA fallback 前后 237.7 vs 237.3/237.6 MB,差值在噪声内。`@hono/node-server/serve-static` 流式读盘不缓冲,文件大小不进 RSS。
- **镜像体积**:推荐组合 prod 依赖实测 **34 MB**(其中 better-sqlite3 27 MB 含各平台 prebuild,可 prune)+ `node:24-alpine` 底 ≈ 50 MB + 前端 dist(现构建约 1~2 MB)→ 估 **~90-110 MB 单镜像**(未实际构建镜像,标注:估算)。
- 结论:Next.js 被否决后,「单部署单元 + 前后端同容器」用 Hono serveStatic 即得,内存零代价;caddy 仍留做 TLS 反代不动。

## shared types 布局建议(前后端类型共享)

frontend 已用 pnpm(实测见 `frontend/node_modules/.pnpm`),直接上 pnpm workspace,shared 包只放 TS 类型/常量、双端直接引 TS 源(两端本来就有 TS 编译链,shared 包零构建):

```
chrome-tab/
  pnpm-workspace.yaml          # packages: [frontend, backend, shared]
  shared/
    package.json               # { "name": "@tab/shared", "type": "module" }
    src/index.ts               # 冻结契约的 DTO:PageDto、IconDto、ChangelogEntry…(export type)
  frontend/                    # package.json 加 "@tab/shared": "workspace:*"
  backend/                     # 同上;dev 用 tsx 直跑 TS 源,build 用 esbuild(顺带吃掉打包优化)
```

双端 `import type { PageDto } from '@tab/shared'`。type-only 导入零运行时成本;将来若需运行时常量同样放 shared,双端各自的编译链天然覆盖,不需要 tsc build 步骤或 monorepo 大件(Nx/Turborepo 均不需要)。

## 风险注记

1. **better-sqlite3 原生编译**:依赖 prebuilt 二进制;Node 大版本升级需等新版 prebuild 或触发 node-gyp 编译(需 python3+make+g++ 镜像层)。建议镜像锁 Node 版本 + 多阶段构建在容器内 `npm rebuild`。
2. **drizzle ESM 爆炸**:机制未根因、仅在 Node 24.19(WSL2)验证;若选 drizzle 必须打包/CJS,并防 dev 链路(tsx/vitest)走 ESM 解析中招。选 Kysely 则无此雷。
3. **Prisma**:即便 v7 无 Rust 引擎,实测 125 MB 仍爆预算,安装体积最大,且 v7 schema/配置分裂(url 移入 prisma.config.ts、client 必须传 adapter)迁移面大。否决。
4. **bcrypt native prebuild 未验证**:选 bcryptjs 则无关;若未来要 native,需在目标镜像实测 `npm i bcrypt`。
5. **测量环境**:WSL2 与 docker 容器 RSS 有少量差异(线程栈/页面缓存口径);Node 底座 47 MB 为本机值,docker 内通常略低。两趟方差 <2%,结论方向(数量级、相对排序)稳。
6. node-cron tick 是否真实触发未直接观测(任务静默);API 正确性以官方 docs 为准,启动无错。

## 引用

- Express v5.0.0 release:https://github.com/expressjs/express/releases/tag/v5.0.0
- Fastify Validation:https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- Hono validation:https://hono.dev/docs/guides/validation
- better-sqlite3 README(WAL/预编译):https://github.com/WiseLibs/better-sqlite3
- Prisma 7.0.0 release(engine-free):https://github.com/prisma/prisma/releases/tag/7.0.0
- Prisma SQLite:https://www.prisma.io/docs/orm/overview/databases/sqlite
- jose:https://github.com/panva/jose
- jsonwebtoken:https://github.com/auth0/node-jsonwebtoken
- bcryptjs v3.0.0 release:https://github.com/dcodeIO/bcrypt.js/releases/tag/v3.0.0
- node-cron:https://github.com/node-cron/node-cron
- 版本/依赖数/unpacked 体积:npm registry(`npm view`,2026-08-21 实查)
