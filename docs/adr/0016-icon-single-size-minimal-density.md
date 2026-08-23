# 图标单档化:全部 1×1,富信息归详情容器

> **注记(2026-08-20)**:行轨道几何修订——原实现 `repeat(8, 1fr)` 把固定画布强切 8 行,图标本体被「画布高/8 − 名称行」钳死,矮视口(约 768px 高)下钳制值低于一切标称边长,iconScale 拉满也不动(稀疏页尤其冤:占 2 行也要平分 8 行的画布)。修订:行高由图标几何推导(`iconCellGeometry`,仅实际占用行存在、簇 `align-content:center` 居中),边长 = min(标称, 轨道宽 − 分组余量, 行可用高)——满 8 行的矮视口才压缩,且横向钳制保证「整体宽度最小 + 大间距」极端组合下块不侵入相邻画格(用户要求:图标不重叠)。网格区域仍占满画布(空页与满页同尺寸的 ADR-0002 语义不变);回归回路为本地诊断脚本 `frontend/scripts/scale-repro.mjs`(未入库,同 clip-repro.mjs 先例)。

> **注记(2026-08-23)**:图标簇对齐由 `align-content:center`(垂直居中)改为 `start`(自上向下排列,稀疏页空隙沉底)——应用户要求,行为类似桌面图标的顶格排布;行高几何模型不变。

> **注记(2026-08-23b)**:①基准上调 `FAV_BASE_PX` 32 → 48——用户在 1x 觉得图标小;48 使 1x 即标准桌面图标尺寸,且恰等于旧默认视觉(1.5×32),默认观感不变、已调过 scale 的行不动。②全类型统一「上块下字」结构(用户要求:所有图标视觉尺寸一致 + 上图标下文字):stock/weather/changelog 弃用铺满画格的玻璃卡(WIDGET_PAD_PX、外壳容器查询、cl-date 规则随之退场),改与 nav/group 共享 TileFrame 块(同一 `faviconPx` 边长)+ IconLabel 行(同一 `labelSize` 行高,数据行可覆盖颜色)——一致性由共享几何保证而非目测调参。块内主体:stock = ticker 符号(mono,18cqw 防长代码溢出),weather = 和风状况图标,changelog = 循环箭头 SVG;名称行的信息取舍:stock 名称、changelog 发布日期让位(归详情容器),下方文字行一律为最关键动态信息(价格/温度/版本号)。

> **注记(2026-08-23c)**:①基准再抬 48 → 56——用户在默认档仍觉小。**纠错**:iconScale 默认前后端均为 1.5(LayoutLimits 未随 23b 下调),故 23b「48 恰等于旧默认视觉、观感不变」不实,实际默认视觉 48×1.5=72px;本次 56×1.5=84px,且上调对全体 scale 档同比生效(「已调过的行不动」的巧合不再成立,用户本人要求,接受)。②信息取舍反转(用户要求):stock 下方行 价格 → **名称**(价格与涨跌色归 StockModal);changelog 块内 循环箭头 → **「最新版本号 + npm 发布日期」两行**(版本 mono/accent 主体,日期小号次级,取 ISO 月-日,年份归 Drawer),下方名称行「Claude Code」。全类型语义就此统一:块内 = 当前状态(动态数据),下方行 = 这是什么(名称)。数据源不变:changelog 本就是 @anthropic-ai/claude-code 的 CHANGELOG.md(后端代理)。

> **注记(2026-08-23d)**:stock 块内再入股价——ticker(主体,白)+ 股价(次级行,涨跌色 mono)两行,与 changelog「版本号+日期」结构对称(用户要求;23c 把价格撤归 Modal 后当轮即回调)。无行情时块内只渲染 ticker 行。

> **注记(2026-08-23e)**:「上块下字」脚手架收拢为深 module `components/Tile.tsx`(Tile + TilePrimary/TileSecondary)——此前 TileFrame/IconLabel 组装、`px()` 缩放、`min(px, cqw)` 钳制公式在各类型 body 各写一遍,调一次字号横跨 3 文件。字号档全类型统一:**主行 14px/24cqw、次行 12px/20cqw**(`lib/iconLayout.ts` 的 `TILE_FONT_TIERS` 唯一来源;px 随 iconScale 同比缩放,cqw 钳块宽占比)。统一即微调:weather 温度 20→24cqw、stock 股价 13→12px、changelog 版本 13→14px(用户拍板「统一两档,顺势对齐」)。名称行行高(1.5)与「块↔行」gap(4px)以 `LABEL_LINE_HEIGHT`/`LABEL_GAP_PX` 单源导出,`labelBlockPx` 与画格同引——改 gap 不再静默错位。changelog 网格取数改走 IconDataContext 下发(删直调 useChangelog 的跨文件缓存键耦合,`releasedAt` 随之下发)。

删除图标三档尺寸(small/medium/large),所有类型一律 1×1 小图标,网格层只留极简内容——nav = favicon 块 + 外置名称;stock = 名称 + 当前价(价格带涨跌色,不加字);weather = 状况图标 + 温度;changelog = 最新版本号 + 发布日期两行(容器查询自适应,防遮蔽防溢出);group = 3×2 迷你预览。其余信息(sparkline、市值/PE/行业、湿度/风向/预警、版本列表)全部收进详情容器(stock/weather = Modal,changelog = Drawer)。「尺寸 = 信息密度」的档位模型(ADR-0007/0009)就此废止,动机是用户明确的「布局干净统一」。

**彻底删除而非锁死**:`IconSize` 类型、`icons.size` 列(Flyway drop)、PATCH 尺寸与编辑模式尺寸菜单、注册表 `sizes`/`defaultSize`(ADR-0001 契约缩减)、`SIZE_CELLS`/`faviconPx` 自相似推导/三档 `ICON_PAD_PX` 全部移除;单档 favicon = `FAV_BASE_PX`(32)×iconScale,gridGap 不再参与推导(ADR-0014 失效主体)。存量 medium/large 图标随迁移收缩为 1 格——只释放格子、无容量溢出风险;页面重排变稀疏由用户自行整理(否决自动聚拢:网格摆放本就是用户手工职责)。公司概述随 large 消亡,恢复 ADR-0004 的 Modal 独占。

**changelog 发布日期源 = npm registry**:CHANGELOG.md 原文标题只有纯版本号、全文无日期,日期只能外取。后端拉 `registry.npmjs.org/@anthropic-ai/claude-code` 的 `time` 字段(版本 → 发布时间),与 changelog 译文缓存同模式。否决 GitHub commits API(CHANGELOG.md 最后提交时间只是版本日期的间接代理);否决逐版本补日期(网格只展示最新版,一次调用够)。

**iconScale 默认 1.5、上限 2.0、下限 0.75 不变**:用户要求默认整体放大以方便读信息。iconScale 成为图标整体大小(favicon 基准、块内边距、小组件字号)的唯一调节;Flyway 迁移把存量未调整行(`icon_scale = 1.0`)提升到新默认,用户调过的不动。`FAV_BASE_PX` 度量衡不动——默认值是展示偏好,不该混进基准。

## 备选方案(已否决)

- **保留字段锁死 small**(类型/列/查表留着,只去 UI 入口):一枚单值枚举与永真查表是死代码;恢复三档走 git 历史,不必为可逆性留尸。
- **逐类型自定义块尺寸**:用户诉求恰是「统一」,统一 1×1 是目的而非代价。
