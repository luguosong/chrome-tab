# 01 — 后端:Icon/Page 领域模型 + 数据迁移 + 聚合接口(expand)+ 测试隔离基建

**What to build:** 在后端建立图标网格系统的数据地基。新增 `pages` 与 `icons` 表(多态:用 `type` 区分 nav/stock/changelog,`data TEXT` + JPA `AttributeConverter` 存 JSON),建对应实体与 repository。执行一次性迁移:为现有 admin 用户创建三个默认页面(快速导航 / 日志更新 / 行情),把现有 `nav_links` 的链接、`stock_watches` 的股票、以及一条更新日志流写成图标实例归入对应页面,链接默认小图标、股票默认中图标、日志默认大图标;13 只中股票若超过单页容量则溢出到追加的"行情(续)"页。`GET /api/config` 进入 expand 阶段:在原有 `navLinks`/`stockWatches` 之外,**额外**返回 `pages` 与 `icons` 字段,使旧前端继续可用、新前端可读取新模型。同时建立后端测试隔离基建,确保测试绝不触碰开发库。

遵循 `CONTEXT.md` 术语与 ADR-0001(多态表)、ADR-0002(页面容量)。

**Blocked by:** 无 — 可立即开始

**Status:** done

- [x] Flyway 新迁移建 `pages` 表(`id, user_id, name, sort_order, created_at`)与 `icons` 表(`id, user_id, page_id, type, size, sort_order, data TEXT, created_at`),外键 `ON DELETE CASCADE` 指向 users/pages
- [x] JPA 实体 `Page`、`Icon`(含 `data` 的 `AttributeConverter` JSON 序列化),对应 repository
- [x] 一次性迁移逻辑:为 admin 创建三个默认页,把现有链接/股票/日志转换为图标实例,链接=small、股票=medium、日志=large;股票超容量时溢出到追加页
- [x] `GET /api/config` 同时返回旧字段(`navLinks`, `stockWatches`)与新字段(`pages`, `icons`)——expand 阶段,旧字段保留不删
- [x] 新增 `com.h2database:h2`(test scope)依赖
- [x] 新增 `src/test/resources/application-test.yml`:H2 内存库(`jdbc:h2:mem:newtab;MODE=MySQL`)、关 Flyway、`ddl-auto=create-drop`
- [x] 迁移正确性测试:在干净 H2 上执行迁移,断言三个默认页、链接/股票/日志图标数量与归属正确(此测试不连任何外部库,不用 `@Transactional` 以便 `create-drop` 重建 schema)
- [x] 新表读取测试:`@SpringBootTest` + `@ActiveProfiles("test")` + `@Transactional`(回滚),通过 MockMvc 验证 `GET /config` 返回的新字段结构正确
- [x] 开发库(`localhost:19002/newtab`)在任何测试中都不被连接

## Comments

- **实现时决策 — 容量来源**:后端迁移与校验先采用固定默认容量(6 列 × 4 行 = 24 格)兜底;前端按实际视口即时反馈。若迁移时发现中股票溢出单页,按"装满一页再开续页"处理。
- `icons.data` 用 `TEXT` + `AttributeConverter`,**不用** MySQL 原生 `JSON` 类型——为 H2 方言一致性(见测试决策)。
- 旧 `nav_links`/`stock_watches` 表与端点在本 ticket **保留**,删除在 03。
