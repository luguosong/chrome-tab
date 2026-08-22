# 05 — pages/icons/layout CRUD + config aggregate

**What to build:** 实现配置域全部端点(约 13 个:pages 增删改查与重排、config 读与全量替换、icons 增改删、merge/dissolve/move),以 api-contract.md 逐字为准。含:统一错误体 `{status, message}`;`@JsonInclude(NON_NULL)` 语义——字段省略输出而非置 null;icon type 大写枚举 wire;config 排序承诺显式化(pages 按 sortOrder,id;icons 按 pageId,sortOrder,id);修正白名单 ②(建成类端点 201,DELETE 204,dissolve 200)④(move 入组尊重 toIndex 并夹紧)⑤(pages reorder 按新序返回,静默跳过不存在 id)⑥(PATCH icons 补参数校验)。config_version 镜像(ADR-0006):任意配置写在写事务末尾原子 bump,GET config 下发 updatedAt 供前端整体-blob LWW 和解。业务不变量照搬:页面容量 = 每页顶层 64 格(组行占 1 格、成员不计);单例类型仅 CHANGELOG;组只能经 merge 创建、空组不存活;排序无空洞;PUT config 全量替换 + 服务端重分配全部 id。

**Blocked by:** 04 — auth。

**Status:** done(2026-08-22)

- [x] 全部端点 happy + 401 + 关键错误分支契约测试绿,响应形状(含字段省略规则)逐字对 api-contract
- [x] 修正白名单 ②④⑤⑥ 各 positive+negative 双断言
- [x] 容量超限、非法 type、畸形参数等返回可读 400 而非静默通过
- [x] 任意配置写后 config_version 在同事务内 bump,GET config 下发 updatedAt
- [x] merge/dissolve/move 后排序无空洞,组语义不变量保持(空组不存活)
- [x] PUT config 全量替换并重分配 id,前端镜像 LWW 和解链路语义可用

实现注记(评审后定案):
- 401 断言按 test-align-map 决策「契约测试顶部统一覆盖,不逐端点 wrapper」,每文件一个探针。
- 两处有意修 Java 的洞(代码内 `ponytail:` 注释标注):move 分支 removeFromGroup 删空组行后 renumber 页面序列(Java 留洞)——直接满足本票「排序无空洞」验收。
- 对齐 Java 的两处细节(评审发现):reorder 重复 id 首个生效(findFirst 语义);`toIndex: null` 落 0(Jackson int 原始类型默认)。
- updatedAt 格式:Node `toISOString()`(带 Z)vs Java LocalDateTime(无时区)。前端 `tsValue` 截前 19 字符按本地解析,两后端行为同构,LWW 稳定序不受影响。
- 类型校验严于 Java(非整数 sortOrder、data 非对象等 → 400 而非 Java 的 500 兜底):白名单⑥「补参数校验」的自然延伸,保留。
