# 多态 Icon 表 + 图标类型注册表

引入单一多态表 `icons(id, user_id, page_id, type, size, sort_order, data)` 承载所有图标实例,并删除现有的 `nav_links` 与 `stock_watches` 表(数据迁移进 `icons.data`)。`data` 列以 `TEXT` + JPA `AttributeConverter` 存储 JSON,不使用 MySQL 原生 `JSON` 类型——以换取 MySQL/H2 的方言一致性(测试用 H2 内存库)。

前端配套一个图标类型注册表(`IconTypeRegistry`):每个类型(nav/stock/changelog 及未来扩展)登记 `{ kind, singleton, sizes, defaultSize, refresh, summarize, detail, editor }`。新增一种图标 = 注册一个类型,不改 schema、不改持久化、不改 `DashboardPage`。

这是用"扩展点架构"换取"关系纯度"的刻意取舍。备选方案——每类一张领域表 + 布局引用表——会要求每加一种图标就改 schema/加表/加 join,直接违背"后续会增加各种图标扩展功能"的目标。单用户个人应用没有跨团队共享库的约束,丢失外键纯度的代价可接受。
