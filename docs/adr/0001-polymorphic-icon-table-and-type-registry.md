# 多态 Icon 表 + 图标类型注册表

> **注记(2026-08-20)**:注册表契约中的 `sizes`/`defaultSize` 已随 [ADR-0016](0016-icon-single-size-minimal-density.md) 删除(图标不再有尺寸概念),`icons.size` 列同批 drop;其余字段不变。

> **注记(2026-08-28)**:契约字段 `detail`(及后续增补的 `detailEntry`)已退役——图标块/详情组件与详情入口策略改由静态全覆盖 UI adapter(前端 `components/iconTypeUi.tsx`)持有,有无详情由可选详情 renderer 表达,缺 renderer 即无详情;`Record<IconTypeId, …>` 使已知类型缺 adapter 时类型检查失败。

引入单一多态表 `icons(id, user_id, page_id, type, size, sort_order, data)` 承载所有图标实例,并删除现有的 `nav_links` 与 `stock_watches` 表(数据迁移进 `icons.data`)。`data` 列以 `TEXT` + JPA `AttributeConverter` 存储 JSON,不使用 MySQL 原生 `JSON` 类型——以换取 MySQL/H2 的方言一致性(测试用 H2 内存库)。

前端配套一个图标类型注册表(`IconTypeRegistry`):每个类型(nav/stock/changelog 及未来扩展)登记 `{ kind, singleton, sizes, defaultSize, refresh, summarize, detail, editor }`。新增一种图标 = 注册一个类型,不改 schema、不改持久化、不改 `DashboardPage`。

这是用"扩展点架构"换取"关系纯度"的刻意取舍。备选方案——每类一张领域表 + 布局引用表——会要求每加一种图标就改 schema/加表/加 join,直接违背"后续会增加各种图标扩展功能"的目标。单用户个人应用没有跨团队共享库的约束,丢失外键纯度的代价可接受。
