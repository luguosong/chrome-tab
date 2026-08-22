# 01 — pnpm workspace 化(frontend + shared + backend)

**What to build:** 把仓库改为 pnpm workspace 三包布局:frontend、shared、backend。`shared/` 为纯 TS 类型/常量包,双端直接引用 TS 源、零构建。这是后续 Node 后端重写的 prefactor——让类型共享通道先于后端落地。前端与 Java 后端行为零变化。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] workspace 根一次 `pnpm install` 装齐三包,frontend 构建/测试照常通过
- [x] `shared/` 至少含一个双端可用的类型/常量并可直接 import(通道打通的验证载体)
- [x] 根 Dockerfile 前端两阶段构建在新布局下成功,产出镜像行为与改造前一致
- [x] Java 后端不受影响,照常构建运行

## Comments

- 2026-08-21 实现完成。`SearchEngineId` + `LayoutSettings`(含 JSDoc)从 `frontend/src/lib/types.ts` 提升到 `shared/src/index.ts`,types.ts 改 import+re-export,22 个引用方零改动。shared 经 `exports: "./src/index.ts"` 直引 TS 源,tsc(bundler resolution)与 vite 均直接消费,零构建。
- 迁移细节:lockfile 上移根目录重生成;esbuild allowBuilds 审批随 `pnpm-workspace.yaml` 上移;根 `node_modules -> frontend/node_modules` 符号链接(历史 hack)已删除;根 package.json 以 `packageManager: pnpm@11.22.0` 固定版本供 Dockerfile corepack 使用。
- 验证:根 install 一次装齐;frontend build(tsc+vite)与 197 测试全绿;docker build 成功,caddy 容器冒烟(index.html/JS/CSS 全 200);`mvn compile` 通过。容器与本地 WSL 构建的 JS chunk hash 有漂移(环境差异,CSS hash 一致),行为验证无差异。
