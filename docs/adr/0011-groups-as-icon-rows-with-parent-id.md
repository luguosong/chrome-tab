# 分组 = 图标行 + parent_id 自引用

分组(group)不建新表:它是 `icons` 表里 `type='group'` 的一行(固定 `small` 占 1 格,组名存 `data`),成员是普通 nav 图标行加上可空 `parent_id` 指向组行。页面序列 = `parent_id IS NULL` 的行;组内序列 = 同 `parent_id` 行的 `sort_order`,每组独立 0..n、无上限(组内分页是弹层的纯展示切片,9 个/页,不引入「组内页」实体)。分组经类型注册表(ADR-0001)注册渲染,复用既有 CRUD 与 @dnd-kit 拖拽(ADR-0003)——分组弹层只是拖拽体系里"又一个容器",单一根 `DndContext` 不变。

**容量语义**:组占 1 格;子图标**不计**「页面容量」(`cellsUsed` 只计顶层行),自身 `size` 保留,移出后按原尺寸落回。只有 nav 类型可入组(服务端校验);无嵌套(`parent_id` 只能指向组行)。

Flyway `V7`:`icons` 加 `parent_id BIGINT NULL` + 自引用 FK `ON DELETE RESTRICT`——有意偏离项目惯用的 CASCADE:删组行前必须先解散,DB 层防「误删组连带吞子图标」。两条配套:RESTRICT 逐行即时检查,`PUT /api/config` 现用的单条全删语句(`deleteAllInBatch`)必须改为先删子行再删顶层行的两段有序删除;直接 `DELETE` 含成员的组行由服务层前置校验为 409「请先解散」(防 FK 异常裸露为 500)。纯加列,无数据迁移。备份 `BACKUP_SCHEMA_VERSION` 1→2,wire 图标行增 `id`(客户端键,照 pages 先例——**现 wire 图标无 id**)+ `parentId`;全删重建与「导入(合并)」都建 iconIdMap 重映射 `parentId`(照 pages 的 pageIdMap 先例);旧版(v1)备份导入按 `parentId=null` 兼容(导入双接受 v1/v2,不写转换器)。

建组 / 解散走专用复合端点(`POST /icons/merge`、`POST /icons/{id}/dissolve`,事务内完成建组、挂成员、序列重排;解散容量不足 409);入组 / 组内重排 / 移出复用 `PATCH /icons/move` 扩展可空 `parentId`(移出计容量)。**空组不存活**:任何路径(move 移出、DELETE 子图标)使组变空都在事务内自动删组行,导入校验拒绝空组。这是用"一行两义(组与成员同为图标行)"换取零新表、零新渲染管线、镜像机制(ADR-0006 的 LWW / 和解)零改动的刻意取舍;代价是容量与序列查询都要带 `parent_id IS NULL` 过滤,wire 格式扩展 id + parentId,`PUT /api/config` 的校验多一组组关系规则。

## 备选方案(已否决)

- **独立 `groups` + `group_members` 两表**:关系更"纯",但新增一套 CRUD / 聚合 / 备份 wire / 同步面,收益仅概念洁癖。
- **组 = 组行 `data` 内嵌成员 id 数组**:免加列,但成员仍是图标行、序列双写两处,`PUT /api/config` 校验复杂化。
- **FK `ON DELETE CASCADE`**:省一步解散,但"删组连子图标一起没"违背收纳可逆的产品语义。
