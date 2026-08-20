# 06 — 后端:分组模型落库 + merge/dissolve/move 扩展 + 备份 v2

Type: task
Status: resolved
Blocked by: 无 — 可立即开始

**What to build:** 分组数据轴的全部后端工作 + 前端类型/备份兼容。Flyway `V7__icons_parent_id.sql`:`icons` 加 `parent_id BIGINT NULL` + 自引用 FK `ON DELETE RESTRICT`(有意偏离项目惯用 CASCADE,防删组连带吞子图标;纯加列、无数据迁移)。`IconType` 加 `GROUP`;`Icon` 实体 / `IconResponse` 增 `parentId`;repository 查询按需带 `parent_id` 过滤。两个专用复合端点:`POST /api/icons/merge`(body `{pageId, memberIds[]}`,memberIds 有序——首位 = 被拖图标 A、末位 = 悬停目标 B;事务内建组(type=group / size=small / data={"name":"新建分组"},组行**继承 B 的 sort_order**)+ 成员挂 `parent_id` + 页面序列补洞重排;校验违者 409:成员 ≥2、全 NAV、全在该页顶层)、`POST /api/icons/{id}/dissolve`(成员按各自保留 `size` 自组 `sort_order` 位置起洒回本页;容量不足 409,错误信息提示"先移出部分图标")。`PATCH /api/icons/move` 的 `MoveRequest` 增可空 `parentId`:null = 落页面序列(移出分组时按保留 `size` 计入目标页容量;源组因此变空则事务内自动删组行;组行自身移动为普通 1 格图标,**组跨页移动时事务内同步成员行 `page_id`**);组 id = 入组 / 组内重排(入组恒落组内序列末尾、忽略 toIndex;组内重排按 toIndex 夹紧;校验目标是组行且成员是 NAV)。`cellsUsed` 改为只计 `parent_id IS NULL` 行。`PATCH /api/icons/{id}` 拒绝 GROUP 改 `size`(409)。`DELETE /api/icons/{id}` 对含成员的组行前置校验 409「请先解散分组」(防 FK RESTRICT 异常裸露为 500);**空组不存活**——任何路径(move 移出、DELETE 子图标)使组变空都在事务内自动删组行。`PUT /api/config`(`ConfigReplaceService`):现用单条 `deleteAllInBatch` 清空,加 RESTRICT 后必须改为**先删 `parent_id` 非空行、再删顶层行**两段有序删除;wire 图标行增 `id`(客户端键,照 pages 先例——**现 wire 图标无 id**)+ `parentId`,替换与「导入(合并)」两条路径都建 iconIdMap 重映射 `parentId`(照 pageIdMap 先例);校验(409)——parent 是组行且同页、成员是 NAV、无嵌套、组至少 1 成员、每页容量只计顶层行。前端侧:`BACKUP_SCHEMA_VERSION` 1→2(`frontend/src/lib/mirror/backup.ts`),`WireConfig.icons` 增 `id` 与 `parentId|null`;**导出恒 v2、导入双接受 v1/v2**(v1 无 parentId 按 null——现 `parseBackupPayload` 是严格不等即拒,必须放宽);`frontend/src/lib/types.ts` 与 `api/config.ts` 图标类型贯穿 `parentId`。

遵循 `CONTEXT.md`(分组、页面容量修订稿)与 ADR-0011(分组模型)、ADR-0006(镜像同步不加新机制)。

- [x] `V7__icons_parent_id.sql`:parent_id + 自引用 FK RESTRICT
- [x] `Icon` / `IconResponse` / `IconType(GROUP)` / repository 顶层过滤查询
- [x] `POST /api/icons/merge`:建组继承末位成员 sort_order、成员脱离页面序列、空位流式补上
- [x] merge 校验 409:成员 <2 / 含非 NAV / 含组行或已入组图标 / 跨页
- [x] `POST /api/icons/{id}/dissolve`:洒回顺序 = 组位置起按成员序;容量不足 409
- [x] `PATCH /api/icons/move` parentId 三态:入组末尾、组内重排夹紧、移出计容量 + 空组自动删;组跨页移动同步成员 page_id
- [x] `DELETE` 含成员组行 409;DELETE 子图标致组变空 → 自动删组行(空组不存活)
- [x] `cellsUsed` 只计顶层行(组 = 1 格);`PATCH` 拒绝 GROUP 改 size
- [x] `PUT /api/config`:全删改两段有序(先子后父);wire `id`+`parentId` 经 iconIdMap 重映射(替换与合并导入);孤儿 parent / 非 NAV 成员 / 嵌套 / 空组 / 容量超限 → 409
- [x] 前端 `BACKUP_SCHEMA_VERSION=2` + wire `id`/`parentId` + 导入兼容 v1(backup.ts / backup.test.ts);types / config API 贯穿 parentId
- [x] 测试:上述每一分支的 `@SpringBootTest` 契约测试(沿用 `IconControllerWriteApiTest` 风格)
- [x] 验证:`mvn -f backend test` 全绿 + `pnpm test` 全绿;手工 curl 一遍 merge → move 入组 → 拖出 → dissolve 序列
