# pnpm workspace 三包化:shared 直引 TS 源、零构建契约通道

仓库改为 pnpm workspace 三包布局(frontend / shared / backend),`shared/` 为纯 TS 类型/常量契约包,消费方直接 import 其 TS 源码,不经任何构建环节。这是 Node 后端重写(2026-08 立项)的 prefactor:先立类型共享通道,再动后端,使契约漂移在前端与后端重写期间始终可被编译器捕获。Next.js 全栈方案已于 2026-08-21 评估否决(Caddy 必留做 TLS、运行时更重、SPA 无 SSR 价值),其类型共享诉求由本 ADR 轻替代。

**零构建的实现机制**:`shared/package.json` 的 `exports` 直指 `./src/index.ts`。前端 tsc(`moduleResolution: "bundler"`、noEmit)会把 `frontend/node_modules/chrome-tab-shared`(pnpm symlink → `shared/`)下的 TS 源当作普通输入拉进编译,vite 打包同理;shared 因此不需要 tsc project references、不需要产出 `.d.ts`、没有 build 脚本。代价是 shared 源码被各消费方以各自的编译选项检查——shared 自带 `tsconfig.json`(strict、noEmit)供编辑器语言服务,语义正确性仍由消费方编译兜底。首个入驻契约:`SearchEngineId` 与 `LayoutSettings`(自 `frontend/src/lib/types.ts` 原文提升,JSDoc 随迁),`types.ts` 留 import+re-export shim 使 22 个既有引用方零改动;后端重写完成、前端引用可切到 `chrome-tab-shared` 直连时再评估拆除 shim。

**backend 包是空壳 manifest**:Java/Maven 不读 package.json,但 workspace 依赖清单必须三包齐在场——根 Dockerfile 的 `pnpm install --frozen-lockfile` 阶段先只 COPY 各包 manifest,缺 backend 的会导致 frozen 校验失败。`"type": "module"` 为 Node 后端重写(下一工单)预留。部署形态不变:根 Dockerfile 两阶段构建,前端产物路径随之从 `/app/dist` 变为 `/app/frontend/dist`(`--filter` 在包目录内执行),Caddyfile 托管路径 `/srv/frontend` 不变。锁文件与 esbuild 构建脚本审批(allowBuilds)随 workspace 定义上移至根 `pnpm-workspace.yaml`;根 `package.json` 以 `packageManager` 固定 pnpm 版本供容器内 corepack 使用。历史上的根 `node_modules -> frontend/node_modules` 符号链接一并移除。

## 备选方案(已否决)

- **shared 构建产物(.d.ts + js)或 tsc project references**:为纯类型包引入构建链是负资产;两消费方(TS 前端、未来 TS 后端)都能吃 TS 源,零构建即最短路径。
- **monorepo 编排工具(turborepo / nx)**:三包无任务编排与缓存收益,不值得背工具链。
- **契约双份手写(前端 types.ts + 后端各自定义)**:即改造前现状,`SearchEngineId` 白名单靠 JSDoc 提醒人肉同步——正是本 ADR 消灭的漂移源。
