# 更新日志多源化:拆单例,每实例绑一个枚举外源

背景:更新日志类型自诞生起是单例,且「Claude Code」这个源**隐式写死**在前后端(`data=null`、URL 常量、名称行硬编码)。2026-08-23 出现第二个真实需求:跟踪 mattpocock/skills 的版本流。单例约束挡路,必须先做模型反转再谈加源。

**决策:更新日志改非单例,每实例在 `data.source` 里绑定一个「外源」;外源是前后端共享的枚举(shared/changelogSources.ts,代码即配置)。**

1. **外源定义单源于 shared 包**(ADR-0018 机制首次被 backend 消费):`{ id, label, npm 包名, CHANGELOG.md raw 地址 }`。后端按它取数,前端按它取显示名与新增表单下拉。**枚举两源(Claude Code / Matt Skills),不做自由输入**——任意 npm 包/repo 输入要为不可预测的源设计解析与降级,当前只有两个真实源;第三个真实源出现时再通用化。
2. **每源一个 `ChangelogService` 实例**,快照表改为 `changelog_snapshots`(`source` TEXT 主键,每源一行);旧单行表 `changelog_snapshot`(带 `CHECK (id=1)`)废弃——SQLite 改不了已存表的 CHECK,旧库中原地留存为孤儿缓存,不迁移(快照可重建,丢了只多一次冷启动)。API 加 `?source=` 选源,缺省/未知回落默认源。
3. **三处单例约束同步拆除**:前端注册表 `singleton: true`、`POST /api/icons` 的已存在 409、config 全量替换的「出现多次」409。
4. **译文表不动,这是本 ADR 最重要的「不决策」**:译文主键是版本块原文的 SHA-256(ADR-0017),与源无关。两源各有 1.2.3 但原文不同 → 哈希天然不同,**不串台**;原文恰好全同则共用一份译文——那正是想要的行为。曾预判「译制 key 必须加源维度」,读代码后发现内容哈希已免费给了源区分度,零改动。
5. **存量兼容走读侧兜底,不写迁移**:旧图标 `data=null` → 前端 `changelogSourceOf` 与路由缺省双双回落 `claude-code`。单用户自用、合法值只能来自枚举表单,后端不校验 `data.source`。

**代价与取舍。** 新增第二个源 = shared 表加一项 + 零其它代码(取数/译制/快照/表单全参数化)。代价是每源一套 6h 定时刷新与快照行——外呼从 4 次/天变 8 次/天,可忽略。前端 `IconDataContext` 的 changelog 集中下发**取消**:多源无批量红利(每源一请求),`useChangelog(source)` 的 queryKey 缓存天然去重,还免掉无更新日志图标时的恒空请求——净删除。

**已知的双源固有错位**:npm registry 可先于 repo 的 CHANGELOG.md 出现新版本(mattpocock-skills 1.3.0 发布时 CHANGELOG 最新条目还是 1.2.3),此时图标显示的版本号在 Drawer 原文里找不到对应块。Claude Code 源一直有此现象,沿用其既有对齐行为(版本列表与原文都来自同一次快照拼装,不做特殊处理)。
