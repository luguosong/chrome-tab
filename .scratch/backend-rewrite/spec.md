# Spec: 后端重造(Java + MySQL → Node + SQLite)

Status: ready-for-agent
Created: 2026-08-21
Sources: 本 effort 9 张 wayfinding 票全部 resolved(见 [map.md](map.md));资产:[api-contract.md](api-contract.md)(22 端点契约+修正白名单)、[ai-platform.md](ai-platform.md)(AI 底座)、[test-align-map.md](test-align-map.md)(测试语义底稿)、[research/](research/) 三篇调研。

## Problem Statement

chrome-tab 部署在一台仅 1.6 GiB RAM 的小服务器上,现状 Java(Tomcat/Spring)+ MySQL 两容器合计约 204 MiB,swap 已有历史压力。作为个人自用系统,用户想要「彻底改造」:换用轻量运行时与内嵌存储,把后端内存压到 ~100 MiB 档,并顺带清掉 MySQL 的维护负担。同时,用户后续要往「扩展类型」图标方向添加新功能(含未来可能的 AI 能力),希望新后端为这些预留一个可生长的底座。约束:前端(`frontend/`)是产品主体且已稳定,**不能动**;线上数据(账号、页面、图标、布局设置)是唯一不可再生物,必须无缝迁移。

## Solution

后端在 feature branch 上全量重写为 **Node.js(Hono 4)+ better-sqlite3(WAL)+ Kysely**,单容器替代原 backend + mysql 两个容器,实测整机 RSS 87~101 MiB。**API 契约对前端逐字冻结**(22 端点,以 api-contract.md 为准),仅实施已批准的 7 项「修正白名单」语义(Node 直接实现修正后语义,Java 不回修);bcrypt 密码哈希原样迁移零重置,切换日用户重登一次,此后重启不再掉线(sessions 落 SQLite)。切换采用 **big bang**:停旧 → 终版 mysqldump 存档(唯一保留物)→ 秒级全量 ETL 重跑 → 起新容器 → 冒烟;成功即彻底清除 MySQL 全家与 Java 代码,失败向前修复、无回滚。附带交付:AI 底座最小骨架(tool 注册表 + agent loop,纸面架构见 ai-platform.md)与滴答清单图标(纯传统扩展类型)规格落档,均为切换后生长点。

## User Stories

1. As a 用户(新标签页使用者), I want 切换日后所有现有功能零回归(登录、页面走马灯、图标编排、分组、布局设置、离线镜像与和解、更新日志、天气、壁纸), so that 我对切换完全无感、不需要重新学习任何操作。
2. As a 用户, I want 现有账号密码原样可登(bcrypt 哈希零重置), so that 切换不需要我重设密码。
3. As a 用户, I want 切换日后重新登录一次、之后服务器重启或发布不再使我掉线, so that 部署不再打断我的浏览会话。
4. As a 用户, I want 我的页面、图标(含组内成员与组内排序)、分组、布局设置分毫不动地迁到新库, so that 打开新标签页看到的一切与切换前一致。
5. As a 用户, I want 本地镜像与和解机制(整体-blob LWW、config_version 判据)照常工作, so that 弱网/离线/双端互保行为不变。
6. As a 用户, I want 更新日志图标照常显示已译版本、npm 发布日期与按需补译旧版, so that 切换前后该图标行为一致(ADR-0005/0017 语义照搬)。
7. As a 用户, I want 天气图标(批量实况/空气/预警、城市搜索)与壁纸照常工作, so that 外部数据代理与缓存行为不变。
8. As a 用户, I want 图标移入分组时落点尊重我提交的目标位置, so that 乐观更新与服务端结果一致(修正白名单第 4 项)。
9. As a 用户, I want 页面重排后返回列表按新序排列, so that 前端拿到的顺序与我刚提交的一致(修正白名单第 5 项)。
10. As a 用户, I want 图标配置更新端点与其他写端点一样有参数校验, so that 畸形请求得到可读的 400 而非静默通过(修正白名单第 6 项)。
11. As a 用户, I want 壁纸按天换新(enddate 变化才重拉), so that 不再是「重启才换壁纸」(修正白名单第 3 项)。
12. As a 用户, I want 过期会话下登出返回 200 而非 401, so that 登出永远不报错(修正白名单第 7 项)。
13. As a 维护者, I want 后端整机内存 ≤ ~100 MiB 且只剩一个后端容器, so that 1.6 GiB 小服务器腾出余量、swap 压力缓解。
14. As a 维护者, I want MySQL 容器/镜像/卷与 Java 代码在切换成功后彻底清除, so that 不留双份运维面与死代码。
15. As a 维护者, I want 备份简化为每日 `VACUUM INTO` 单文件、恢复 = 拷回文件, so that 备份/恢复比 mysqldump 更省心。
16. As a 维护者, I want 切换日流程是一张可照做的清单(停旧 → dump 存档 → 全量 ETL → 起新 → 冒烟 → 清除), so that 一个 session 内完成、无需临场决策。
17. As a 维护者, I want 清毁 MySQL 数据卷之前留一份终版 mysqldump 纯文件存档, so that 数据(唯一不可再生物)有最后一道安全网。
18. As a 维护者, I want caddy 容器与根 Dockerfile 的 TLS/反代层零改动, so that 切换风险被限制在后端容器内。
19. As a 维护者, I want deploy skill 在切换日同 session 更新为 Node 形态, so that 之后的发布流程不再走旧路。
20. As a 执行 agent, I want 22 端点的逐字契约与 7 项修正白名单作为唯一事实源, so that 重写期间不需要做任何契约决策。
21. As a 执行 agent, I want A→D 阶段化执行顺序清单(每步可独立验证), so that 可以按步推进并在任意步收在可检查的结果上。
22. As a 执行 agent, I want Java 14 套件测试的语义映射底稿, so that 契约测试的重译有据可依、不靠考古。
23. As a 未来 AI 图标的开发者, I want tool 注册表(handler 带 userId 上下文)与 agent loop 骨架就位且有单测, so that 首个 AI 图标立项时直接长全、不动既有签名。
24. As a 未来 AI 图标的开发者, I want MCP client 设计预留(统一注册表抽象、stdio 默认禁用), so that 接外部 MCP server 时业务代码零改动。
25. As a 未来滴答清单图标的开发者, I want 其规格(单例、`DIDA_API_TOKEN`、摘要/详情容器行为)已随决策包落档, so that 切换后作为第一个新扩展类型实现时无需新票。

## Implementation Decisions

### 运行时与栈(票 01,实测定版)

- 组合:**Hono 4 + @hono/node-server + better-sqlite3(WAL)+ Kysely + bcryptjs + node-cron v4**。实测(强制 GC 后 RSS):全栈 101 MiB、esbuild 打包 87 MiB,达标 ≤ ~100 MiB。
- 实测否决:drizzle-orm(ESM 入口 import 即 +150 MiB)、Prisma 7(125 MiB)、LangChain.js(25 包/88 MB/+137 MiB RSS 且网关有坑)。
- 不引入 JWT:现状本就是 Tomcat 内存 session,迁移载体改 SQLite sessions 表(票 04),jose/jsonwebtoken 选型消解。
- **类型共享**:pnpm workspace(frontend + shared + backend),`shared/` 纯 TS 类型/常量双端直引 TS 源、零构建。
- 部署形态:单后端容器,沿用 `backend/` 路径(compose build context 零改动);caddy 不动;前端仍由根 Dockerfile 两阶段构建(caddy 托管 dist + 反代 `/api`)。需验证 workspace 化后根 Dockerfile 构建路径不破。
- 单测/契约测试依赖不进生产镜像。

### 存储与 schema(票 03)

- SQLite 8 张表:现有 7 张(users、pages、icons、layout_settings、config_version、changelog_snapshot、changelog_translations)平移 + Node 新增 sessions。建表脚本以 SQLite 适配 research 的脚本骨架为底。
- 方言要点:json 列本就是 TEXT 存 JSON;时间戳全由代码赋值、字符串原样拷贝;连接显式 `foreign_keys = ON`;库文件不可在 NFS。
- **Node 容器保持 UTC**,以保 config_version LWW 排序语义。
- 备份:每日 `VACUUM INTO`(live 库安全;禁止直接 cp),复用既有 cron;恢复 = 拷回文件。

### auth(票 04,语义冻结)

- 会话载体:SQLite sessions 表(`session_id, user_id, expires_at`,TTL 30d,多 session 并存);~15 行 Hono 中间件 + hono/cookie。切换日本身需登录一次;收益是今后重启不掉线。过期清理惰式 + 复用既有 cron。
- 密码:bcrypt `$2a$` 哈希原样迁移、零重置;bcryptjs 兼容验证;新哈希仅产生于空库 seed(默认 `$2a$`/10 rounds)。
- 空库首启 seed 照搬 DataBootstrap 语义:users 空 → 用 `ADMIN_PASSWORD` 建 admin(缺失则启动报错);pages 空 → seed 3 页 26 图标 + config_version touch;非空全跳过。ADMIN_* 仅首启生效。
- cookie 名 `JSESSIONID`、httpOnly、SameSite=Strict、max-age 30d、prod 加 secure——全照搬。
- 拦截面:`/api/login` + `/api/logout` 放行(logout 幂等化,修正白名单第 7 项);其余 `/api/**` 未认证 401 空体;非 `/api` 放行;无 CORS(同源)。
- 单管理员、无角色分支、无改密端点;改密/lockout/rate-limit 等新能力一概不混入(现状无,照搬)。

### API 契约(票 05,冻结)

- 基准 = api-contract.md 全文:横切约定(统一错误体 `{status, message}`、未认证 401 空体、`@JsonInclude(NON_NULL)` 字段省略输出而非置 null)、22 端点逐端点行为、前端消费方一览。
- **修正白名单 7 项**为目标契约,Node 直接实现:① 删 `GET /api/ping`(放行面随之修订);② 建成类端点(`POST /api/pages`、`POST /api/icons`、`POST /api/icons/merge`)→ 201,DELETE 维持 204,dissolve 维持 200;③ 壁纸缓存按 enddate 天失效(失败沿用旧值);④ move 入组分支尊重 toIndex 并夹紧;⑤ pages reorder 按新序返回(静默跳过不存在 id 保留);⑥ `PATCH /api/icons/{id}` 补参数校验;⑦ logout 幂等化。
- 其余一切逐字照搬,含:icon type 大写枚举 wire、多返回的响应体、weather 原始串键与规范化键并存、401 双形态、config 排序承诺显式化(pages 按 sortOrder,id;icons 按 pageId,sortOrder,id)、stock 前端直连 eastmoney 格局。
- config_version 镜像(ADR-0006):任意配置写在写事务末尾 bump、与配置写原子;GET /api/config 下发 updatedAt 供前端镜像 LWW 和解。
- 业务不变量照搬:页面容量 = 每页顶层 64 格(组行占 1 格、成员不计);单例类型仅 CHANGELOG;组只能经 merge 创建、空组不存活;排序无空洞(0..n-1);PUT /api/config 全量替换 + 服务端重分配全部 id。

### changelog(ADR-0017 语义照搬)

- 请求路径纯读内存快照(volatile 原子换新,零外呼零 LLM);node-cron 每 6h 预取刷新;启动先从快照表恢复(秒级可服务)再异步预热,失败沿用旧快照(最多旧 6h);内存空则同步兜底刷新一次,仍失败 500。
- 译文按版本块原文 SHA-256 主键持久化,一版终身只译一次;增量检测纯算法零 token;译制失败记 warn 保持英文、下轮重试;refresh 与 translateVersions 互斥防并发重复译制。
- npm releasedAt 拉失败为 null,前端日期行降级「—」。

### weather / wallpaper(ADR-0009 语义照搬)

- weather 批量端点:重复 `location` 参数整串为键(不拆逗号)、非法静默跳过;内存 TTL 缓存(实况 10min/空气 30min/预警 5min)仅缓存成功结果;降级:实况失败整 bundle null、空气/预警各自降级不影响实况。
- 外呼防御:gzip 解压后摘除 Content-Encoding/Content-Length 头;URL 裸主机前置 `https://`;解析失败明确 fallback 不抛错。
- wallpaper:代理必应 HPImageArchive,拼完整图 URL;缓存按 enddate 天失效(修正白名单第 3 项)。
- Key 未配置 → 500「服务器错误」。

### AI 底座骨架(票 06/07,档位 B:设计落档 + 最小骨架)

- 当前无任何 AI 消费者:系统(新标签页逻辑)零 AI 入口;AI 只可能存在于未来「扩展类型」图标内部。底座止于骨架,全套实装推迟到首个 AI 图标立项(届时另立 effort)。
- 骨架交付:tool 注册表(集中单文件注册,handler 签名带 `userId` 上下文,zod 4 schema 序列化给网关)+ `runAgent` async 函数(非流式,默认 gpt-5-nano,可覆盖)。**无 HTTP 端点**。
- 防失控常量:步数上限 8;同一 tool 连续失败 2 次中止;超时 connect 10s / read 5min。
- MCP 仅 interface 预留:统一注册表抽象(`mcp:<server>:` 前缀防撞名),不装 client 包;stdio transport 默认禁用(每常驻 30~80 MiB),仅允许远程 StreamableHTTP/SSE。
- 降级语义(只写设计):读侧透传原文永不空白(ADR-0005 先例);写侧宁可不动不可错写;步数打满报错上抛不返半成品;tool 失败错误文本回喂一轮即止。
- Key 沿用 `AIHUBMIX_API_KEY`,不新建管理面。

### 滴答清单图标规格(票 06,切换后实现、规格已定版)

- 定性:纯传统扩展类型,零 AI——直调滴答 Open API,复刻天气的后端代理模式(倾向直连 API,不 spawn CLI 子进程)。
- 单例(同更新日志);`DIDA_API_TOKEN` 走 `.env`(追加式维护),不做前端配置 UI。
- 摘要 = 今日到期未完成数,打开页面按需拉 + 短 TTL 缓存(天气档先例),不做定时预取;详情容器 = 任务列表 + 勾选完成 + 表单建任务;取数失败 → 容器错误态。
- 落地时进 CONTEXT.md 的是普通扩展类型词条(非「AI 扩展类型」);实现归阶段 D,不阻塞切换。

### 迁移与切换(票 08,big bang 定版)

- feature branch 全量重写,期间 Java(master)冻结非紧急改动(紧急 bug 在 master 修 Java 照旧发布,branch rebase 跟进)。
- 无回滚、切换成功即彻底清除:服务器删 mysql 容器/镜像/卷 + compose mysql 段 + 旧 backend 镜像 + `.env` 清 `DB_*`;代码侧同 PR 删 Java(`backend/` 路径由 Node 沿用,不打 tag,git 历史即后路)。失败处理 = 向前修复。
- 唯一保留物:清卷前终版 mysqldump 纯文件存档。
- 切换日流程:停旧 backend → 终版 mysqldump 存档 → 重跑一次全量 ETL(mysql2 → better-sqlite3,1 MB 级秒级;提前跑的 ETL 属演练,不写任何增量同步代码)→ 起新容器 → 冒烟。无切换窗口,停机几分钟。
- ETL 脚本附对账报告(数据迁移验证载体);CONTEXT.md 技术栈表述顺手更新;(可选)落迁移 ADR;deploy skill 同 session 更新。

### 执行顺序(后续执行 session 直接照做)

- **阶段 A 重写**(feature branch,每步可独立验证):A1 pnpm workspace 化(根 Dockerfile 前端构建路径验证)→ A2 Node 骨架(Hono + better-sqlite3 WAL + Kysely + 新 Dockerfile)→ A3 SQLite schema → A4 auth 三端点 + sessions + 空库 seed → A5 pages/icons/layout CRUD + config aggregate(修正白名单 7 项)→ A6 changelog(快照表 + 译制持久化 + 6h 定时)→ A7 weather/wallpaper 透传与缓存 → A8 AI 骨架 B 档 + 单测 → A9 ETL 脚本 + 每日 VACUUM INTO 备份。
- **阶段 B 测试**(切换硬前置):B1 契约测试以 api-contract.md 逐端点断言。
- **阶段 C 切换日**(一 session):C1(提前数日)服务器 ETL 演练 + 对账 → C2 停旧 → dump → ETL → 新 compose(无 mysql)up → 冒烟 → C3 清除(服务器 + 代码 + `.env` + CONTEXT.md 表述 + 可选 ADR)→ C4 deploy skill 更新。
- **阶段 D 切换后**(非阻塞、另立项):D1 滴答清单图标。

## Testing Decisions

- **好测试的定义**:只测外部行为(wire 形状:状态码、headers、body 形状、省略规则、错误体),不测实现细节;不模拟 Java 框架装配。
- **主 seam(唯一业务逻辑 seam)= HTTP 层 `app.request()` 契约测试**(Hono 免端口;2026-08-21 与用户确认定版)。auth 中间件、LWW 镜像、容量数学、分组语义、changelog 降级、weather 解析全部经此层下网。DB fixture = 内存 SQLite + 复刻 seed 基线(3 页 / 12 NAV / 1 CHANGELOG / 13 STOCK,页容量 64);外部上游(和风/必应/npm/LLM 网关)以注入的假 fetch/固定 fixture 替身,只验本端行为。
- **粒度 B**:每端点 happy 形态 + 401 + 关键错误分支;修正白名单 7 项各 positive+negative 双断言。
- **辅助 seam 1 = AI 骨架函数级单测**:骨架无 HTTP 端点,注册表单测 + agent loop smoke(喂假响应跑通 tool-call 回灌与中止语义)。
- **辅助 seam 2 = 切换日验证**:本机全量 vitest 全绿 = 切换硬条件(无 CI);服务器 `pnpm smoke`(登录链路 + config/changelog/weather/wallpaper 各一探 + 401 探针);数据对账走 ETL 报告。
- **框架 = vitest**(与前端同 workspace,零新增)。
- **Java 测试移植策略**:语义全量重译,不搬框架。保留重译:changelog 切片与增量零 LLM 去重、weather gzip 摘头与解析降级、page/icon 排序不变量、config 校验矩阵与孤儿 parentId 重映射。砍掉:Spring 装配类断言、旧 JSON 形状字段 exists 影子断言、逐端点 401 wrapper(由契约测试顶部统一覆盖)。底稿 = test-align-map.md。
- **Prior art**:Java 侧 14 套 MockMvc 测试是语义来源(非形态来源);前端 vitest 配置是工具链先例。

## Out of Scope

- **`frontend/` 的任何改动**——契约冻结,前端零改动。
- **Next.js 全栈重构**(2026-08-21 评估否决:Caddy 必留做 TLS、Next.js 运行时更重、SPA 无 SSR 价值;其诉求已由 workspace 类型共享轻替代)。
- **重定向扩展(Chrome extension)的任何改动**。
- **后端作为 MCP server 对外暴露**(若未来要做,另开 effort)。
- **为框架成熟而引框架**(LangChain.js 已实测否决;Vercel AI SDK 仅作流式 UI 需求出现时的升级路径)。
- **AI 底座全套实装**(agent 常驻、tool 注册表运行时、MCP client 实装、agent 会话载体与状态存储)——首个 AI 图标立项时另立 effort 长全。
- **auth 新能力**(改密端点、lockout、rate-limit)——现状无,照搬。
- **增量数据同步代码**——全量重跑秒级,不写。
- **滴答清单图标的实现**(阶段 D 另立项;规格已落档在本 spec)。

## Further Notes

- 领域词汇以根 `CONTEXT.md` 为准:图标/页面/格子/页面容量/布局设置/分组/编辑模式/单例类型/更新日志/天气/本地镜像/和解。相关 ADR:0002(固定画布容量)、0005/0017(changelog 译制)、0006(双镜像 blob-LWW)、0009(weather 代理)、0011(分组即图标行)、0016(图标单格)。
- 服务器事实(2026-08-21 实测):1.6 GiB RAM、available ~987 MiB;chrome-tab-backend 136 MiB、mysql 68 MiB、caddy 13 MiB。SSH 别名 `tab`,密钥登录;线上 `.env` 追加式维护。
- 历史教训(map Notes):ADMIN_* 仅首启生效,改线上密码须直接 UPDATE users 表;Flyway 崩溃循环重放迁移的教训随 Java 下线自然消解。
- 深度细节不在本 spec 重复,按需查资产:端点逐条行为 → api-contract.md;AI 底座 → ai-platform.md;测试语义 → test-align-map.md;栈/内存实测、SQLite 方言、AI 执行层选型 → research/01、03、02。
- 切换验收一句话:前端对后端行为不可区分(auth 冻结清单 + 契约测试全绿 + 冒烟通过),数据对账零差异,内存实测 ≤ ~100 MiB 档。
