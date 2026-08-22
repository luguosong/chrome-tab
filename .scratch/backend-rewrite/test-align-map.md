# Node 测试对齐:Java→语义映射图(09 的资产)

- 对应票据:`issues/09-test-alignment.md`
- 日期:2026-08-21 · 状态:已定(用户 Q1–Q5 全按推荐批)
- 用途:阶段 B(08)测试工作,把 Java 14 套件「重写」为 vitest 契约测试时的语义搬运底稿——只搬行为语义,不搬框架装配(答案详见票 09)。

## 决策线(用户 2026-08-21 定)

| 决策 | 选择 | 要点 |
|---|---|---|
| Q1 测试框架 | **vitest**(与前端同款,同 workspace) | node:test 零依赖但工具链缺口;vitest 零新增成本、与前端同 config 直觉 |
| Q2 契约测试探测层 | **HTTP 层 `app.request()`** | 免起端口;wire 形状(状态码/headers/省略规则/`{status,message}`)只有 HTTP 层可验 |
| Q3 契约粒度 | **B:每端点 happy 形态 + 401 + 关键错误分支** | 修正白名单 7 项单独 positive+negative 双断言 |
| Q4 移植策略 | **语义全量重译,砍纯礼仪断言** | 砍「旧 JSON 形状字段的 exists 断言」(锁旧 Java 影子);401 由契约测试统一覆盖,不逐端点 wrapper |
| Q5 切换日验证 | **本机全量 vitest=门槛;服务器 `pnpm smoke` 冒烟子集** | 无 CI、生产镜像不带测试依赖;冒烟秒级,失败即转 08「向前修复」 |

## 复刻的 fixture 基线(Node 测试基建)

- seed 基线:3 页 / 12 NAV / 1 CHANGELOG / 13 STOCK,每图标占 1 格,页容量 64(ADR-0016/0002)
- 排序不变量:删除/移动后顶层 sortOrder 必 0..n-1 且无空洞
- 容量结算:顶层行数上限 64;组成员计入顶层、非顶层不计(组行占 1 格)

## 各目录语义映射

### changelog(4 件套)—— Node 重写重点
- 畸形响应(choices 缺失/空、content 非字符串)→ 返回 null 触发降级英文,不抛异常
- 增量去重:原文未变 → 再次 refresh **零 LLM 调用**(块哈希去重);快照进库启动秒级恢复
- releasedAt 于 npm 拉失败为 null 且 markdown 正常 200,前端日期行降级「—」
- 切片器:h3 标题归属当前版本块;块边界精确到行 —— 与前端 parseChangelog 契约一致、边界错位即哈希错位

### weather(4 件)
- **Gzip**:解压后依次摘除 **Content-Encoding / Content-Length** 头部(不摘 → 下游二次解压乱码);非 gzip 明文透传
- **URL 裸主机**:无 scheme 一律前置 `https://`、已有 scheme 不动(Node fetch URL 构造前防御)
- **location 逗号守护**:`?location=39.9,116.4` 作整串 key 不拆,重复参数各存;Node 不仿 Spring 拆分 bug
- **解析降级**:parseAir 取 `qaqi` 优先、缺失时回退首项、空→null;解析失败明确 fallback 不抛错

### icon(2 文件,容量数学高密度)
- 组行占 1 格、成员入组只增顶层、空组自清理(删成员致空组自动消失)
- dissolve 在满格让出 1 格 → 净 0 可移出;组行不入组(嵌套 409);入/出/重排 各容量结算一致
- merge 判定:2+ 成员、必须有序、成员全顶层 NAV、首尾 id 语义(嵌套/组行/已入组违例)

### page(1)
- 非空页删除 **409**;新页 sortOrder 末尾追加 +1;reorder 后连续 0..n-1 无玄洞

### configaggregate(2 件套)(契约最重)
- 校验矩阵:`PUT /api/config` → 容量/单例/孤儿 parentId/组嵌套/非 NAV 成员/跨页/每页顶层 >64 全 409,结构缺 400;id 全量重映射(服务端分配,blob 内 id 仅客户端键)
- config_version.updatedAt 与每次配置写同挂事务(回滚不前进)
- GET /api/config:pages/icons 排序显式化;旧端点 `/api/nav-links`、`/api/stock-watches` 404;无 `setting` 字段;ADR-0016 已删 size 字段,缺省应省略输出(见修正白名单清单)
- 宽松 PUT:只带旧字段成功,缺省补默认(双向兼容)

## 随 Java 下线(不搬、不重写)

1. 全框架装配:`@SpringBootTest`/MockMvc/Jackson jsonPath/`@WithUserDetails`/H2内存库基线——Node 无对应,不模拟
2. 契约各端点的 **401 wrapper 断言** 由契约测试顶部统一覆盖,不复逐端点 wrapper
3. 旧 Java 模型的影子字段(如已删的 `layout_settings.size` 不存在断言)——非新契约,反正契约测试有字段外观校验

## 切换日冒烟(`pnpm smoke` 结构,现场验证)

- POST /api/login 200(admin 凭证)+ 错误凭据 401
- GET /api/config 200 含 3 页 26 图标 seed 基线(或空库 seed)
- GET /api/changelog 200(releasedAt 可 null);GET /api/weather 或 /api/wallpaper 200
- 受保护端点未登录 401 空体