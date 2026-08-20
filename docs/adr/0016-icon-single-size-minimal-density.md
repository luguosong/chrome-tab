# 图标单档化:全部 1×1,富信息归详情容器

> **注记(2026-08-20)**:行轨道几何修订——原实现 `repeat(8, 1fr)` 把固定画布强切 8 行,图标本体被「画布高/8 − 名称行」钳死,矮视口(约 768px 高)下钳制值低于一切标称边长,iconScale 拉满也不动(稀疏页尤其冤:占 2 行也要平分 8 行的画布)。修订:行高由图标几何推导(`iconCellGeometry`,仅实际占用行存在、簇 `align-content:center` 居中),边长 = min(标称, 轨道宽 − 分组余量, 行可用高)——满 8 行的矮视口才压缩,且横向钳制保证「整体宽度最小 + 大间距」极端组合下块不侵入相邻画格(用户要求:图标不重叠)。网格区域仍占满画布(空页与满页同尺寸的 ADR-0002 语义不变);回归回路为本地诊断脚本 `frontend/scripts/scale-repro.mjs`(未入库,同 clip-repro.mjs 先例)。

删除图标三档尺寸(small/medium/large),所有类型一律 1×1 小图标,网格层只留极简内容——nav = favicon 块 + 外置名称;stock = 名称 + 当前价(价格带涨跌色,不加字);weather = 状况图标 + 温度;changelog = 最新版本号 + 发布日期两行(容器查询自适应,防遮蔽防溢出);group = 3×2 迷你预览。其余信息(sparkline、市值/PE/行业、湿度/风向/预警、版本列表)全部收进详情容器(stock/weather = Modal,changelog = Drawer)。「尺寸 = 信息密度」的档位模型(ADR-0007/0009)就此废止,动机是用户明确的「布局干净统一」。

**彻底删除而非锁死**:`IconSize` 类型、`icons.size` 列(Flyway drop)、PATCH 尺寸与编辑模式尺寸菜单、注册表 `sizes`/`defaultSize`(ADR-0001 契约缩减)、`SIZE_CELLS`/`faviconPx` 自相似推导/三档 `ICON_PAD_PX` 全部移除;单档 favicon = `FAV_BASE_PX`(32)×iconScale,gridGap 不再参与推导(ADR-0014 失效主体)。存量 medium/large 图标随迁移收缩为 1 格——只释放格子、无容量溢出风险;页面重排变稀疏由用户自行整理(否决自动聚拢:网格摆放本就是用户手工职责)。公司概述随 large 消亡,恢复 ADR-0004 的 Modal 独占。

**changelog 发布日期源 = npm registry**:CHANGELOG.md 原文标题只有纯版本号、全文无日期,日期只能外取。后端拉 `registry.npmjs.org/@anthropic-ai/claude-code` 的 `time` 字段(版本 → 发布时间),与 changelog 译文缓存同模式。否决 GitHub commits API(CHANGELOG.md 最后提交时间只是版本日期的间接代理);否决逐版本补日期(网格只展示最新版,一次调用够)。

**iconScale 默认 1.5、上限 2.0、下限 0.75 不变**:用户要求默认整体放大以方便读信息。iconScale 成为图标整体大小(favicon 基准、块内边距、小组件字号)的唯一调节;Flyway 迁移把存量未调整行(`icon_scale = 1.0`)提升到新默认,用户调过的不动。`FAV_BASE_PX` 度量衡不动——默认值是展示偏好,不该混进基准。

## 备选方案(已否决)

- **保留字段锁死 small**(类型/列/查表留着,只去 UI 入口):一枚单值枚举与永真查表是死代码;恢复三档走 git 历史,不必为可逆性留尸。
- **逐类型自定义块尺寸**:用户诉求恰是「统一」,统一 1×1 是目的而非代价。
