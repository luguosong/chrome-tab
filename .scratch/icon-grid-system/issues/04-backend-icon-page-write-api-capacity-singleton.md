# 04 — 后端:Icon/Page 写操作 API + 容量校验 + 单例校验

**What to build:** 实现图标与页面的写操作端点,使前端的新增/删除/移动/尺寸切换/页面管理有后端支撑。覆盖图标的增删改与跨页移动、页面的增删改名与重排。服务端强制执行两个核心约束:页面容量(目标页格子占用之和达容量上限时拒绝,返回 409 并带剩余格数)与单例类型(已存在的单例类型再添加时拒绝,返回 409)。

遵循 ADR-0001(多态表)、ADR-0002(容量上限)、`CONTEXT.md`(单例类型)。

**Blocked by:** 01 — 后端领域模型(01)(写操作只碰新表,不依赖旧表清理 03)

**Status:** done(提交 `0c46631`;本会话核查:IconController/PageController + 写 API 测试 + 后端 BUILD SUCCESS 全绿)

- [x] `POST /api/icons`:新建图标,body=`{pageId, type, size, data}`;校验单例(type 在注册表声明 singleton 且该 user 已有该 type 实例 → 409);校验容量(目标页 `sum(sizeCell[size]) + 新增格子 > capacity` → 409,带剩余格数)
- [x] `PATCH /api/icons/{id}`:改 `size` 或 `data`(部分字段);改 size 时重新校验容量
- [x] `DELETE /api/icons/{id}`:删图标
- [x] `PATCH /api/icons/move`:移动/重排,body=`{id, toPageId, toIndex}`(同页排序与跨页移动统一);跨页时重新校验目标页容量
- [x] `POST /api/pages`:新建页,body=`{name}`
- [x] `PUT /api/pages/{id}`:改名,body=`{name}`
- [x] `DELETE /api/pages/{id}`:删页;非空页返回 409(暂定阻止策略,见 Comments)
- [x] `PATCH /api/pages/reorder`:批量重排,body=`[{id, sortOrder}]`
- [x] 后端 `@SpringBootTest` 测试覆盖:新增/删除/移动/改尺寸的成功路径、容量超限 409、单例重复 409、跨页移动、页面增删改名、非空页删除 409
- [x] 容量计算纯逻辑可被前端复用(抽取为共享的格子映射 `small=1, medium=4, large=6` 常量约定)

## Comments

- **实现时决策 — 非空页删除**:spec 暂定阻止非空页删除(返回 409),UI 提示用户先清空或移动图标。更安全的默认,后续可改为级联删图标(只需调服务端逻辑,不动 schema)。
- **实现时决策 — 容量数值**:后端先采用固定默认容量(6 列 × 4 行 = 24 格)兜底;前端按视口即时反馈,服务端校验作为最终防线。若默认容量需要调整,集中在常量处改。
- 本 ticket 与 03 可并行:写 API 只操作新表 `icons`/`pages`,不依赖旧表是否已被删除。
